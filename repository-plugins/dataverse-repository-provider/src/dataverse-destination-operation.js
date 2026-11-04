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
    const requestedParentId = this.text(input?.parentId)
    let parentId = requestedParentId
    let root
    if (!parentId) {
      const result = await client.getCollection(':root')
      this.requireSuccess(result, 'load the root collection')
      root = result.payload?.data
      parentId = this.text(root?.alias)
      if (!parentId) {
        throw new Error('The repository root collection does not have an alias.')
      }
    }
    // Match the immediate parent, rather than the whole subtree. The Search
    // API bounds the response to 1,000 collections without loading descendants.
    let destinations = await this.searchPages(
      client, this.parentQuery(parentId), parentId,
    )
    destinations = await this.addChildIndicators(client, destinations)

    if (!requestedParentId && destinations.length === 0) {
      destinations = [this.destination(root, undefined, false)]
    }

    return { destinations }
  }

  async search(input) {
    const client = this.client(input)
    const query = this.text(input?.query)
    if (!query) return { destinations: [] }
    const destinations = await this.searchPages(client, this.partialQuery(query))
    return { destinations: await this.addChildIndicators(client, destinations) }
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

  async addChildIndicators(client, destinations) {
    const results = [...destinations]
    let nextIndex = 0
    const workerCount = Math.min(6, results.length)
    const worker = async () => {
      while (nextIndex < results.length) {
        const index = nextIndex++
        const current = results[index]
        // Probe the search index for an immediate Dataverse child only. The
        // generic childCount also includes datasets and cannot drive the arrow.
        const result = await client.searchCollections({
          query: `dvParentAlias:"${this.escapeQuery(current.id)}"`,
          perPage: 1,
          start: 0,
          queryEntities: false,
        })
        this.requireSuccess(result, `check child collections of '${current.id}'`)
        results[index] = {
          ...current,
          hasChildren: Number(result.payload?.data?.total_count || 0) > 0,
        }
      }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return results
  }

  async searchPages(client, query, parentId) {
    const result = await client.searchCollections({ query, perPage: 1000, start: 0 })
    this.requireSuccess(result, 'search repository destinations')
    const items = Array.isArray(result.payload?.data?.items)
      ? result.payload.data.items
      : []
    const seen = new Set()
    return items
      .filter(item => String(item?.type || '').toLowerCase() === 'dataverse')
      .filter(item => !parentId || this.text(item?.parentDataverseIdentifier) === parentId)
      .slice(0, 1000)
      .map(item => this.destination(item, parentId, true))
      .filter(destination => {
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

  escapeQuery(value) {
    // Treat the filter as text, including punctuation in collection names.
    return value.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, '\\$&')
  }

  partialQuery(value) {
    const parts = value.split(/\s+/).filter(Boolean).map(part => this.escapeQuery(part))
    // Restrict every term to the collection's own name, rather than affiliation,
    // description or parent metadata. Prefix matching supports typing ahead.
    return `dvName:(${parts.map(part => `${part}*`).join(' AND ')})`
  }

  parentQuery(parentId) {
    return `parentDataverseIdentifier:"${this.escapeQuery(parentId)}"`
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

