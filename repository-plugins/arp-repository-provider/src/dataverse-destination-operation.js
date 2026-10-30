// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

class DataverseDestinationOperation {
  constructor({ clientFactory }) {
    this.clientFactory = clientFactory
  }

  async list(input) {
    const client = this.client(input)
    const parentId = this.text(input?.parentId) || 'root'
    let destinations = await this.immediateChildren(client, parentId)
    destinations = await this.addChildIndicators(client, destinations)

    if (parentId === 'root' && destinations.length === 0) {
      destinations = await this.searchPages(client, '*')
      if (destinations.length === 0) {
        const root = await client.getCollection('root')
        this.requireSuccess(root, 'load the root collection')
        destinations = [this.destination(root.payload?.data, undefined, false)]
      }
    }

    return { destinations }
  }

  async search(input) {
    const client = this.client(input)
    const query = this.text(input?.query)
    if (!query) return { destinations: [] }
    return { destinations: await this.searchPages(client, this.partialQuery(query)) }
  }

  async check(input) {
    const client = this.client(input)
    const destinationId = this.text(input?.destinationId)
    if (!destinationId) throw new Error('A repository destination id is required.')
    const result = await client.getCollectionUserPermissions(destinationId)
    this.requireSuccess(result, `check access to '${destinationId}'`)
    return { selectable: this.canAddDataset(result.payload?.data) }
  }

  client(input) {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The repository configuration is missing.')
    }
    return this.clientFactory(repository)
  }

  async immediateChildren(client, parentId) {
    const result = await client.getCollectionContents(parentId)
    this.requireSuccess(result, `load destinations below '${parentId}'`)
    const items = Array.isArray(result.payload?.data) ? result.payload.data : []
    return items
      .filter(item => String(item?.type || '').toLowerCase() === 'dataverse')
      .map(item => this.destination(item, parentId, false))
  }

  async addChildIndicators(client, destinations) {
    const results = [...destinations]
    let nextIndex = 0
    const workerCount = Math.min(6, results.length)
    const worker = async () => {
      while (nextIndex < results.length) {
        const index = nextIndex++
        const current = results[index]
        try {
          const details = await client.getCollection(current.id)
          this.requireSuccess(details, `load destination '${current.id}'`)
          const childCount = Number(details.payload?.data?.childCount || 0)
          results[index] = {
            ...current,
            label: this.text(details.payload?.data?.name) || current.label,
            hasChildren: childCount > 0
              ? await this.hasChildCollections(client, current.id)
              : false,
          }
        } catch {
          results[index] = current
        }
      }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return results
  }

  async hasChildCollections(client, destinationId) {
    const result = await client.searchCollections({
      query: '*',
      subtree: destinationId,
      perPage: 1,
      start: 0,
    })
    return this.success(result) &&
      Number(result.payload?.data?.total_count || 0) > 0
  }

  async searchPages(client, query) {
    const perPage = 100
    const destinations = []
    for (let page = 0; page < 20; page += 1) {
      const result = await client.searchCollections({
        query,
        perPage,
        start: page * perPage,
      })
      this.requireSuccess(result, 'search repository destinations')
      const items = Array.isArray(result.payload?.data?.items)
        ? result.payload.data.items
        : []
      destinations.push(...items
        .filter(item => String(item?.type || '').toLowerCase() === 'dataverse')
        .map(item => this.destination(item, undefined, false)))
      const total = Number(result.payload?.data?.total_count || destinations.length)
      if (items.length < perPage || destinations.length >= total) break
    }

    const seen = new Set()
    return destinations.filter(destination => {
      if (seen.has(destination.id)) return false
      seen.add(destination.id)
      return true
    })
  }

  destination(value, parentId, hasChildren) {
    const id = this.text(value?.alias) ||
      this.text(value?.identifier) ||
      this.text(value?.global_id) ||
      this.text(value?.id)
    if (!id) throw new Error('The repository returned a destination without an identifier.')
    return {
      id,
      label: this.text(value?.name) || this.text(value?.title) || id,
      ...(parentId ? { parentId } : {}),
      hasChildren,
    }
  }

  partialQuery(value) {
    const parts = value.split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '*'
    const last = parts[parts.length - 1]
    parts[parts.length - 1] = /[*?]$/.test(last) ? last : `${last}*`
    return parts.join(' ')
  }

  canAddDataset(data) {
    if (typeof data?.canAddDataset === 'boolean') return data.canAddDataset
    const permissions = Array.isArray(data)
      ? data
      : Array.isArray(data?.permissions)
        ? data.permissions
        : []
    return permissions.some(permission =>
      String(permission).replace(/[^a-z]/gi, '').toLowerCase() === 'adddataset')
  }

  requireSuccess(result, action) {
    if (!this.success(result)) {
      const message = typeof result?.payload?.message === 'string'
        ? `: ${result.payload.message}`
        : ''
      throw new Error(
        `Could not ${action} (${result?.status ?? 'unknown'})${message}`,
      )
    }
  }

  success(result) {
    return Boolean(result?.ok && result.payload?.status !== 'ERROR')
  }

  text(value) {
    if (typeof value === 'number') return String(value)
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
}

module.exports = { DataverseDestinationOperation }

