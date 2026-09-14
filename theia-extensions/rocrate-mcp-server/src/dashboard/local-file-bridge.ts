// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

const DEFAULT_AROMA_BASE_URL = 'https://repo.researchdata.hu/aroma'
const DEFAULT_ALLOWED_ORIGINS =
  'https://repo.researchdata.hu,http://localhost:3000,http://127.0.0.1:3000'
const DEFAULT_TTL_MINUTES = 480
const WATCH_INTERVAL_MS = 1000
const HEARTBEAT_INTERVAL_MS = 25000

type LocalFileSession = {
  id: string
  path: string
  createdAt: number
  expiresAt: number
  lastEtag: string
  subscribers: Set<http.ServerResponse>
  heartbeatTimers: Map<http.ServerResponse, NodeJS.Timeout>
  watching: boolean
}

export type LocalFileBridgeRegistration = {
  aromaUrl: string
  localFileUrl: string
  eventsUrl: string
  path: string
  expiresAt: string
}

type LocalFilePayload = {
  id: string
  path: string
  name: string
  contentType: 'application/json'
  etag: string
  mtime: string
  content: Record<string, unknown>
}

const sessions = new Map<string, LocalFileSession>()

function bridgeEnabled(): boolean {
  return process.env.ROCRATE_LOCAL_FILE_BRIDGE_ENABLED !== 'false'
}

function dashboardEnabled(): boolean {
  return process.env.ROCRATE_DASHBOARD_ENABLED !== 'false'
}

function allowedOriginForRequest(req: http.IncomingMessage): string {
  const configured =
    process.env.ROCRATE_LOCAL_FILE_BRIDGE_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS
  const origin = req.headers.origin
  if (!origin) {
    return configured.split(',')[0].trim()
  }
  const allowed = configured
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return allowed.includes(origin) ? origin : allowed[0] || '*'
}

function sessionTtlMs(): number {
  const parsed = Number(process.env.ROCRATE_LOCAL_FILE_BRIDGE_SESSION_TTL_MINUTES)
  const minutes =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MINUTES
  return minutes * 60 * 1000
}

function getDashboardPublicBaseUrl(): string {
  const configuredHost = process.env.ROCRATE_DASHBOARD_HOST || '127.0.0.1'
  const host =
    configuredHost === '0.0.0.0' || configuredHost === '::'
      ? '127.0.0.1'
      : configuredHost
  const port = process.env.ROCRATE_DASHBOARD_PORT || '9393'
  return `http://${host}:${port}`
}

function sendBridgeJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  data: unknown,
  status = 200,
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOriginForRequest(req),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
    'Access-Control-Allow-Private-Network': 'true',
  })
  res.end(JSON.stringify(data))
}

function sendBridgeOptions(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': allowedOriginForRequest(req),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
    'Access-Control-Allow-Private-Network': 'true',
  })
  res.end()
}

function normalizeAromaBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_AROMA_BASE_URL
  return raw.replace(/\/+$/, '')
}

function calculateEtagFromBytes(bytes: Buffer): string {
  return `"sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}"`
}

function readJsonFile(filePath: string): {
  content: Record<string, unknown>
  etag: string
  mtime: string
} {
  const bytes = fs.readFileSync(filePath)
  const parsed = JSON.parse(bytes.toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Local file must contain a JSON object.')
  }
  const stat = fs.statSync(filePath)
  return {
    content: parsed as Record<string, unknown>,
    etag: calculateEtagFromBytes(bytes),
    mtime: stat.mtime.toISOString(),
  }
}

function assertRoCrateShape(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be a JSON object.')
  }
  const record = value as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(record, '@context')) {
    throw new Error('RO-Crate JSON must include @context.')
  }
  if (!Array.isArray(record['@graph'])) {
    throw new Error('RO-Crate JSON must include @graph array.')
  }
}

async function readRequestJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) {
    body += chunk.toString('utf8')
  }
  const parsed = JSON.parse(body || '{}') as unknown
  assertRoCrateShape(parsed)
  return parsed
}

function writeJsonAtomic(filePath: string, payload: Record<string, unknown>): void {
  const directory = path.dirname(filePath)
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`,
  )
  let serialized = JSON.stringify(payload, null, 2)
  if (!serialized.endsWith('\n')) {
    serialized += '\n'
  }
  fs.writeFileSync(tempPath, serialized, 'utf8')
  fs.renameSync(tempPath, filePath)
}

function refreshSession(session: LocalFileSession): void {
  session.expiresAt = Date.now() + sessionTtlMs()
}

function getSession(id: string | null): LocalFileSession | undefined {
  if (!id) {
    return undefined
  }
  const session = sessions.get(id)
  if (!session) {
    return undefined
  }
  if (Date.now() > session.expiresAt) {
    removeSession(id)
    return undefined
  }
  refreshSession(session)
  return session
}

function removeSession(id: string): void {
  const session = sessions.get(id)
  if (!session) {
    return
  }
  fs.unwatchFile(session.path)
  for (const subscriber of session.subscribers) {
    subscriber.end()
  }
  for (const timer of session.heartbeatTimers.values()) {
    clearInterval(timer)
  }
  sessions.delete(id)
}

function broadcast(session: LocalFileSession, event: string, data: unknown): void {
  for (const subscriber of session.subscribers) {
    subscriber.write(`event: ${event}\n`)
    subscriber.write(`data: ${JSON.stringify(data)}\n\n`)
  }
}

function ensureWatching(session: LocalFileSession): void {
  if (session.watching) {
    return
  }
  session.watching = true
  fs.watchFile(session.path, { interval: WATCH_INTERVAL_MS }, () => {
    try {
      if (!fs.existsSync(session.path)) {
        broadcast(session, 'deleted', { id: session.id })
        return
      }
      const current = readJsonFile(session.path)
      if (current.etag !== session.lastEtag) {
        session.lastEtag = current.etag
        broadcast(session, 'changed', {
          id: session.id,
          etag: current.etag,
          mtime: current.mtime,
        })
      }
    } catch (error) {
      broadcast(session, 'error', {
        id: session.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

function payloadForSession(session: LocalFileSession): LocalFilePayload {
  const current = readJsonFile(session.path)
  session.lastEtag = current.etag
  return {
    id: session.id,
    path: session.path,
    name: path.basename(session.path),
    contentType: 'application/json',
    etag: current.etag,
    mtime: current.mtime,
    content: current.content,
  }
}

export function registerLocalFileForAroma(params: Record<string, unknown>): LocalFileBridgeRegistration {
  if (!bridgeEnabled()) {
    throw new Error('Local file bridge is disabled.')
  }
  if (!dashboardEnabled()) {
    throw new Error(
      'Local file bridge requires the dashboard HTTP server. Set ROCRATE_DASHBOARD_ENABLED=true or leave it unset.',
    )
  }
  const inputPath = typeof params.path === 'string' ? params.path.trim() : ''
  const absolutePath = path.resolve(inputPath || 'ro-crate-metadata.json')
  if (path.basename(absolutePath) !== 'ro-crate-metadata.json') {
    throw new Error('Local file bridge only supports ro-crate-metadata.json files.')
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Local RO-Crate metadata file not found: ${absolutePath}`)
  }

  const current = readJsonFile(absolutePath)
  assertRoCrateShape(current.content)

  const id = crypto.randomUUID()
  const expiresAt = Date.now() + sessionTtlMs()
  const session: LocalFileSession = {
    id,
    path: absolutePath,
    createdAt: Date.now(),
    expiresAt,
    lastEtag: current.etag,
    subscribers: new Set(),
    heartbeatTimers: new Map(),
    watching: false,
  }
  sessions.set(id, session)
  ensureWatching(session)

  const bridgeBaseUrl = getDashboardPublicBaseUrl()
  const localFileUrl = `${bridgeBaseUrl}/local-file?id=${encodeURIComponent(id)}`
  const eventsUrl = `${bridgeBaseUrl}/local-file/events?id=${encodeURIComponent(id)}`
  const aromaBaseUrl = normalizeAromaBaseUrl(params.aromaBaseUrl)
  const aromaUrl = `${aromaBaseUrl}?localFile=${encodeURIComponent(localFileUrl)}`

  return {
    aromaUrl,
    localFileUrl,
    eventsUrl,
    path: absolutePath,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

export async function handleLocalFileBridgeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    sendBridgeOptions(req, res)
    return
  }
  if (!bridgeEnabled()) {
    sendBridgeJson(req, res, { error: 'Local file bridge is disabled.' }, 404)
    return
  }

  const parsed = new URL(req.url || '/', 'http://local-file-bridge.local')
  const id = parsed.searchParams.get('id')
  const session = getSession(id)
  if (!session) {
    sendBridgeJson(req, res, { error: 'Unknown or expired local file session.' }, 404)
    return
  }

  if (parsed.pathname === '/local-file/events') {
    if (req.method !== 'GET') {
      sendBridgeJson(req, res, { error: 'Method not allowed' }, 405)
      return
    }
    const current = payloadForSession(session)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': allowedOriginForRequest(req),
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
      'Access-Control-Allow-Private-Network': 'true',
    })
    session.subscribers.add(res)
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, HEARTBEAT_INTERVAL_MS)
    session.heartbeatTimers.set(res, heartbeat)
    res.write(`event: ready\n`)
    res.write(`data: ${JSON.stringify({ id: session.id, etag: current.etag, mtime: current.mtime })}\n\n`)
    req.on('close', () => {
      session.subscribers.delete(res)
      const timer = session.heartbeatTimers.get(res)
      if (timer) {
        clearInterval(timer)
        session.heartbeatTimers.delete(res)
      }
    })
    return
  }

  if (parsed.pathname !== '/local-file') {
    sendBridgeJson(req, res, { error: 'Not found' }, 404)
    return
  }

  if (req.method === 'GET') {
    try {
      sendBridgeJson(req, res, payloadForSession(session))
    } catch (error) {
      sendBridgeJson(
        req,
        res,
        { error: error instanceof Error ? error.message : String(error) },
        400,
      )
    }
    return
  }

  if (req.method === 'PUT') {
    const ifMatch = req.headers['if-match']
    const expectedEtag = Array.isArray(ifMatch) ? ifMatch[0] : ifMatch
    if (!expectedEtag) {
      sendBridgeJson(req, res, { error: 'If-Match header is required.' }, 428)
      return
    }
    try {
      const current = readJsonFile(session.path)
      if (expectedEtag !== current.etag) {
        sendBridgeJson(
          req,
          res,
          {
            error: 'Local file changed since it was loaded.',
            currentEtag: current.etag,
          },
          412,
        )
        return
      }
      const payload = await readRequestJson(req)
      writeJsonAtomic(session.path, payload)
      const updated = readJsonFile(session.path)
      session.lastEtag = updated.etag
      sendBridgeJson(req, res, {
        ok: true,
        id: session.id,
        path: session.path,
        etag: updated.etag,
        mtime: updated.mtime,
      })
    } catch (error) {
      sendBridgeJson(
        req,
        res,
        { error: error instanceof Error ? error.message : String(error) },
        400,
      )
    }
    return
  }

  sendBridgeJson(req, res, { error: 'Method not allowed' }, 405)
}
