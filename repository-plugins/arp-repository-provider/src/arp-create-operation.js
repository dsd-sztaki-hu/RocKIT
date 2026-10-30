// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

/**
 * Performs the remote half of ARP creation. RocKIT prepares the crate, file
 * manifest, and dataset metadata before this operation. It checkpoints remote
 * progress through RocKIT while leaving all local persistence in the app.
 */
const CHECKPOINT_COMMAND = 'rockit.repositories.checkpointCreateExport'

class ArpCreateOperation {
  constructor({ vscode, clientFactory }) {
    this.vscode = vscode
    this.clientFactory = clientFactory
  }

  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    const plan = this.object(input?.plan)
    const crate = this.object(plan?.uploadCrate)
    const files = plan?.fileSources
    const payload = this.object(input?.datasetCreationPayload)
    const collectionId = input?.collectionId
    const operationId = input?.operationId
    if (!repository?.baseUrl || !crate || !Array.isArray(crate['@graph']) ||
        !Array.isArray(files) || !payload || typeof collectionId !== 'string' || !collectionId.trim() ||
        typeof operationId !== 'string' || !operationId.trim()) {
      throw new Error('ARP creation requires a repository, prepared crate, file manifest, collection, dataset payload, and operation ID.')
    }
    const client = this.clientFactory(repository)
    const uploadCrate = JSON.parse(JSON.stringify(crate))
    const originalToUploadIds = this.object(plan.originalToUploadIds) || {}

    progress.report({ message: 'Validating RO-Crate metadata with ARP...' })
    const validation = await client.validateRoCrate(uploadCrate)
    const validationErrors = this.validationIssues(validation.payload)
    if (validationErrors.length) {
      return {
        providerId: 'arp',
        validationFailure: {
          status: validation.status,
          url: validation.url,
          validationErrors,
          payload: validation.payload,
        },
      }
    }
    this.requireSuccess(validation, 'ARP RO-Crate validation', true)

    progress.report({ message: 'Creating Dataverse dataset...' })
    const creation = await client.createDataset(collectionId, payload)
    this.requireSuccess(creation, 'Dataverse dataset creation')
    const pid = this.findPid(creation.payload)
    if (!pid) {
      throw new Error('Dataverse created the dataset but did not return its persistent ID.')
    }

    const uploadIdMapping = this.initialIdMapping(uploadCrate)
    const fileResults = []
    try {
      await this.checkpoint({
        operationId, providerId: 'arp', stage: 'datasetCreated', pid,
        creationResponse: creation.payload,
      })
      for (const file of files) {
        if (!file || typeof file.entityId !== 'string' || typeof file.entryPath !== 'string' ||
            typeof file.sourceUri !== 'string') {
          throw new Error('ARP export contains an invalid file source.')
        }
        progress.report({ message: `Uploading ${file.entryPath}...` })
        const content = await this.vscode.workspace.fs.readFile(this.vscode.Uri.parse(file.sourceUri))
        const uploaded = await client.uploadFile(pid, file.entryPath, content)
        this.requireSuccess(uploaded, `Dataverse upload of '${file.entryPath}'`)
        const fileId = this.findUploadedFileId(uploaded.payload)
        if (!fileId) {
          throw new Error(`Dataverse uploaded '${file.entryPath}' but did not return a dataFile.id.`)
        }
        const md5 = this.findMd5(uploaded.payload)
        const uploadEntityId = originalToUploadIds[file.entityId] || file.entityId
        const uploadEntity = uploadCrate['@graph'].find(entity => entity?.['@id'] === uploadEntityId)
        if (md5 && uploadEntity) uploadEntity.hash = md5
        const remoteId = this.arpFileEntityId(fileId, uploadIdMapping, repository.baseUrl, pid)
        uploadIdMapping[file.entityId] = remoteId
        if (file.entryPath !== file.entityId) uploadIdMapping[file.entryPath] = remoteId
        const fileResult = {
          entityId: file.entityId,
          entryPath: file.entryPath,
          remoteId,
          ...(md5 ? { md5 } : {}),
          lastModified: file.lastModified,
          sourceSize: file.sourceSize,
        }
        fileResults.push(fileResult)
        await this.checkpoint({
          operationId, providerId: 'arp', stage: 'fileUploaded', pid, fileResult,
        })
      }

      progress.report({ message: 'Uploading ARP RO-Crate metadata...' })
      const metadataUpdateCrate = this.rewriteIds(uploadCrate, uploadIdMapping)
      const update = await client.updateRoCrate(pid, metadataUpdateCrate)
      this.requireSuccess(update, 'ARP RO-Crate metadata update')
      const processedRemoteCrate = this.findCrate(update.payload)
      if (!processedRemoteCrate) {
        throw new Error('ARP updated the metadata but did not return the stored RO-Crate @graph.')
      }

      return {
        providerId: 'arp',
        pid,
        creationResponse: creation.payload,
        processedRemoteCrate,
        uploadCrate,
        uploadIdMapping,
        fileResults,
      }
    } catch (error) {
      // Once the dataset exists, RocKIT must receive its PID and partial file
      // mapping so it can record an interrupted export for recovery.
      return {
        providerId: 'arp', interrupted: true, pid,
        creationResponse: creation.payload, uploadCrate, uploadIdMapping,
        fileResults, errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  }

  checkpoint(value) {
    return this.vscode.commands.executeCommand(CHECKPOINT_COMMAND, value)
  }

  requireSuccess(result, action, checkValidation = false) {
    const errors = checkValidation
      ? this.validationIssues(result?.payload)
      : this.object(result?.payload)?.errors
    if (Array.isArray(errors) && errors.length) {
      throw new Error(`${action} failed: ${JSON.stringify(errors).slice(0, 1000)}`)
    }
    if (!result?.ok || this.object(result.payload)?.status === 'ERROR') {
      const message = this.object(result?.payload)?.message
      throw new Error(`${action} failed (${result?.status ?? 'unknown'}) at ${result?.url ?? 'ARP'}${message ? `: ${message}` : ''}.`)
    }
  }

  validationIssues(payload) {
    const record = this.object(payload)
    if (!record) return []
    const reports = [record, this.object(record.data)?.validation]
    for (const key of ['details', 'message']) {
      const value = record[key]
      if (typeof value === 'string') {
        try { reports.push(JSON.parse(value)) } catch { /* Plain-text message. */ }
      } else {
        reports.push(value)
      }
    }
    return reports.flatMap(report => {
      const errors = this.object(report)?.errors
      return Array.isArray(errors) ? errors : []
    })
  }

  findPid(value) {
    const record = this.object(value)
    if (!record) return undefined
    for (const key of ['persistentId', 'pid', 'global_id', 'globalId']) {
      if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
    }
    return this.findPid(record.data)
  }

  findUploadedFileId(value) {
    const files = this.object(value)?.data?.files
    if (!Array.isArray(files)) return undefined
    for (const file of files) {
      const id = this.object(this.object(file)?.dataFile)?.id
      if (typeof id === 'number' && Number.isFinite(id)) return String(id)
      if (typeof id === 'string' && id.trim()) return id.trim()
    }
    return undefined
  }

  findCrate(value) {
    const record = this.object(value)
    if (!record) return undefined
    if (Array.isArray(record['@graph'])) return record
    const data = this.object(record.data)
    if (Array.isArray(data?.['@graph'])) return data
    const nested = this.object(data?.roCrate)
    return Array.isArray(nested?.['@graph']) ? nested : undefined
  }

  findMd5(value) {
    const visited = new Set()
    const visit = (item, inHash = false) => {
      if (typeof item === 'string') {
        const hash = item.trim().replace(/^md5:/i, '').toLowerCase()
        return inHash && /^[a-f0-9]{32}$/.test(hash) ? hash : undefined
      }
      if (!item || typeof item !== 'object' || visited.has(item)) return undefined
      visited.add(item)
      if (Array.isArray(item)) return item.map(child => visit(child, inHash)).find(Boolean)
      const algorithm = String(item.type || item.algorithm || '').toLowerCase()
      if (algorithm === 'md5') {
        const direct = visit(item.value || item.hash || item.checksum, true)
        if (direct) return direct
      }
      for (const [key, child] of Object.entries(item)) {
        const found = visit(child, inHash || ['md5', 'hash', 'checksum'].includes(key.toLowerCase()))
        if (found) return found
      }
      return undefined
    }
    return visit(value)
  }

  initialIdMapping(crate) {
    const mapping = { './': './' }
    for (const entity of crate['@graph']) {
      if (!this.object(entity) || typeof entity['@id'] !== 'string') continue
      const types = Array.isArray(entity['@type']) ? entity['@type'] : [entity['@type']]
      if (entity['@id'] !== './' && types.includes('Dataset')) mapping[entity['@id']] = entity['@id']
    }
    return mapping
  }

  arpFileEntityId(fileId, mapping, baseUrl, pid) {
    if (!/^\d+$/.test(fileId)) return fileId
    for (const candidate of Object.values(mapping)) {
      const match = candidate.match(/^(.*\/file\/)\d+$/)
      if (match) return `${match[1]}${fileId}`
    }
    const host = new URL(baseUrl).hostname.toLowerCase()
    const arpBase = host === 'dsddev.concorda.sztaki.hu'
      ? 'https://w3id.org/arp/dev/ro-id'
      : 'https://w3id.org/arp/ro-id'
    return `${arpBase}/${pid}/file/${fileId}`
  }

  rewriteIds(crate, mapping) {
    const copy = JSON.parse(JSON.stringify(crate))
    const visit = value => {
      if (Array.isArray(value)) return value.forEach(visit)
      if (!this.object(value)) return
      for (const [key, child] of Object.entries(value)) {
        if (key === '@id' && typeof child === 'string' && mapping[child]) value[key] = mapping[child]
        else visit(child)
      }
    }
    visit(copy)
    return copy
  }

  object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  }
}

module.exports = { ArpCreateOperation, CHECKPOINT_COMMAND }
