// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

function appendExportLogEvent(entries, entry) {
  return normalizeExportLogEntries([...entries, entry])
}

function normalizeExportLogEntries(value) {
  if (!Array.isArray(value)) return []
  const grouped = new Map()
  for (const candidate of value) {
    if (!record(candidate)) continue
    const target = text(candidate.target)
    const repository = text(candidate.repository)
    const mappingFile = text(candidate.mappingFile)
    if (!target || !repository || !mappingFile) continue
    const events = readEvents(candidate)
    if (!events.length) continue
    const { syncedAt: _syncedAt, ...normalized } = candidate
    const key = `${normalizeUrl(repository)}\n${mappingFile}`
    const previous = grouped.get(key)
    const latest = events.at(-1)
    const lastSuccessfulActionAt =
      latest.status === 'success' ? latest.timestamp : previous?.lastSuccessfulActionAt
    grouped.set(key, {
      ...previous,
      ...normalized,
      target,
      repository,
      mappingFile,
      crosswalkFile:
        latest.crosswalkFile || text(candidate.crosswalkFile) || previous?.crosswalkFile,
      datasetName: text(candidate.datasetName) || previous?.datasetName,
      status: latest.status,
      errorMessage: latest.status === 'failed' ? text(candidate.errorMessage) : '',
      syncType: latest.action,
      ...(lastSuccessfulActionAt ? { lastSuccessfulActionAt } : {}),
    })
  }
  return Array.from(grouped.values())
}

function serializeExportLogEntries(entries) {
  return normalizeExportLogEntries(entries).map((entry) => {
    const {
      syncType,
      log: _log,
      lastSuccessfulActionAt: _lastSuccessfulActionAt,
      syncedAt: _syncedAt,
      ...recordValue
    } = entry
    return {
      ...recordValue,
      syncType,
      ...(entry.lastSuccessfulActionAt
        ? { lastSuccessfulActionAt: entry.lastSuccessfulActionAt }
        : {}),
    }
  })
}

function readEvents(value) {
  const events = []
  if (Array.isArray(value.log)) {
    for (const candidate of value.log) {
      if (!record(candidate)) continue
      const action = candidate.action
      const timestamp = text(candidate.timestamp)
      if (validAction(action) && timestamp) {
        events.push({
          action,
          timestamp,
          status: validStatus(candidate.status) || validStatus(value.status) || 'success',
          crosswalkFile: text(candidate.crosswalkFile) || text(value.crosswalkFile),
        })
      }
    }
  }
  const action = value.syncType
  const timestamp = text(value.lastSuccessfulActionAt) || text(value.syncedAt)
  const status = validStatus(value.status) || 'success'
  if (validAction(action) && (timestamp || status !== 'success')) {
    events.push({ action, timestamp, status, crosswalkFile: text(value.crosswalkFile) })
  }
  return Array.from(
    new Map(
      events.map((event) => [
        `${event.timestamp}\n${event.action}\n${event.crosswalkFile || ''}\n${event.status}`,
        event,
      ]),
    ).values(),
  ).sort((left, right) => (left.timestamp || '').localeCompare(right.timestamp || ''))
}

function validAction(value) {
  return value === 'create' || value === 'update' || value === 'sync'
}

function validStatus(value) {
  return value === 'success' || value === 'failed' || value === 'cancelled'
    ? value
    : undefined
}

function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

module.exports = {
  appendExportLogEvent,
  normalizeExportLogEntries,
  serializeExportLogEntries,
}
