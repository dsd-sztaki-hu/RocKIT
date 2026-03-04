/**
 * HTTP server for the RO-Crate MCP Dashboard
 * Provides read-only APIs and static file serving for the dashboard UI
 */

import * as http from 'node:http'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { TelemetryCollector } from './collector'
import type { DashboardConfig } from './types'
import type {
  SchemaRegistryEntry,
  RegisterSchemaInput,
  UpdateSchemaInput,
} from '../server/schema-registry-store'
import {
  calculateSummaryStats,
  calculateToolStats,
  formatDuration,
  formatLatency,
  formatRelativeTime,
  formatPercentage,
  summarizeDependencyUsage,
  filterByTimeWindow,
  computeTimeSeries,
} from './aggregates'

// Get the directory of this module for static file serving
// In CommonJS compiled output, the static files are in lib/dashboard/static
// We use __dirname which is available at runtime in the compiled CommonJS
declare const __dirname: string

const STATIC_DIR = __dirname
type AccessMode = 'local' | 'remote'

type SchemaRegistryStore = {
  list: (mode: AccessMode) => { storage: unknown; schemas: SchemaRegistryEntry[] }
  register: (
    mode: AccessMode,
    input: RegisterSchemaInput,
  ) => { storage: unknown; schemas: SchemaRegistryEntry[] }
  update: (
    mode: AccessMode,
    input: UpdateSchemaInput,
  ) => { storage: unknown; schemas: SchemaRegistryEntry[] }
  remove: (
    mode: AccessMode,
    id: string,
  ) => { storage: unknown; schemas: SchemaRegistryEntry[] }
}

/**
 * Response helper for JSON responses
 */
function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  })
  res.end(JSON.stringify(data))
}

/**
 * Response helper for static files
 */
function sendStatic(
  res: http.ServerResponse,
  filePath: string,
  contentType: string,
): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, { error: 'Not found' }, 404)
      return
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    })
    res.end(data)
  })
}

/**
 * Parses query parameters from a URL
 */
function parseQuery(url: string): Record<string, string> {
  const query: Record<string, string> = {}
  const queryString = url.split('?')[1]

  if (!queryString) {
    return query
  }

  const params = new URLSearchParams(queryString)
  for (const [key, value] of params) {
    query[key] = value
  }

  return query
}

/**
 * Validates the Authorization header if auth token is configured
 */
function validateAuth(
  req: http.IncomingMessage,
  authToken?: string,
): boolean {
  if (!authToken) {
    return true
  }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    return false
  }

  // Support Bearer token
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return false
  }

  return match[1] === authToken
}

/**
 * Parses request JSON body and enforces object payload shape.
 */
async function parseJsonObjectBody(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) {
    body += chunk.toString()
  }

  if (body.trim() === '') {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('Invalid JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid request body')
  }
  return parsed as Record<string, unknown>
}

/**
 * Parses schema-registry mode from request query/body.
 */
function parseMode(value: unknown): AccessMode {
  return value === 'remote' ? 'remote' : 'local'
}

/**
 * API response handlers
 */
class DashboardApiHandlers {
  constructor(
    private readonly collector: TelemetryCollector,
    private readonly config: DashboardConfig,
    private readonly schemaRegistry: SchemaRegistryStore,
  ) {}

  /**
   * GET /health - Health check endpoint
   */
  health(req: http.IncomingMessage, res: http.ServerResponse): void {
    sendJson(res, {
      status: 'ok',
      uptime: this.collector.getUptimeSeconds(),
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * GET /metrics/summary - Summary statistics
   */
  metricsSummary(req: http.IncomingMessage, res: http.ServerResponse): void {
    const query = parseQuery(req.url || '')
    const minutesAgo = query.minutes ? parseInt(query.minutes, 10) : undefined

    let toolCalls = this.collector.getToolCalls()
    if (minutesAgo) {
      toolCalls = filterByTimeWindow(toolCalls, minutesAgo)
    }

    const sessions = this.collector.getSessions()
    const stats = calculateSummaryStats(
      toolCalls,
      sessions,
      this.collector.getUptimeSeconds(),
    )

    sendJson(res, {
      ...stats,
      uptimeFormatted: formatDuration(stats.uptimeSeconds),
      timeWindow: minutesAgo ? `${minutesAgo}m` : 'all',
    })
  }

  /**
   * GET /metrics/tools - Tool-specific statistics
   */
  metricsTools(req: http.IncomingMessage, res: http.ServerResponse): void {
    const query = parseQuery(req.url || '')
    const minutesAgo = query.minutes ? parseInt(query.minutes, 10) : undefined

    let toolCalls = this.collector.getToolCalls()
    if (minutesAgo) {
      toolCalls = filterByTimeWindow(toolCalls, minutesAgo)
    }

    const toolStatsMap = calculateToolStats(toolCalls)
    const toolStats = Array.from(toolStatsMap.values()).sort(
      (a, b) => b.callCount - a.callCount,
    )

    sendJson(res, {
      tools: toolStats.map((stat) => ({
        ...stat,
        avgLatencyFormatted: formatLatency(stat.avgLatencyMs),
        p95LatencyFormatted: formatLatency(stat.p95LatencyMs),
        lastCallFormatted: formatRelativeTime(stat.lastCallAt),
        failureRateFormatted: formatPercentage(stat.failureRate),
      })),
      timeWindow: minutesAgo ? `${minutesAgo}m` : 'all',
    })
  }

  /**
   * GET /sessions - List all sessions
   */
  sessions(req: http.IncomingMessage, res: http.ServerResponse): void {
    const sessions = this.collector.getSessions().sort(
      (a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt),
    )

    sendJson(res, {
      sessions: sessions.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        lastActivityAt: s.lastActivityAt,
        lastActivityFormatted: formatRelativeTime(s.lastActivityAt),
        transportMode: s.transportMode,
        requestCount: s.requestCount,
        errorCount: s.errorCount,
        active: s.active,
      })),
      count: sessions.length,
    })
  }

  /**
   * GET /sessions/:id - Get session details
   */
  sessionDetail(req: http.IncomingMessage, res: http.ServerResponse): void {
    const urlPath = req.url || ''
    const match = urlPath.match(/^\/sessions\/([^/]+)$/)
    if (!match) {
      sendJson(res, { error: 'Invalid session ID' }, 400)
      return
    }

    const sessionId = match[1]
    const session = this.collector.getSession(sessionId)

    if (!session) {
      sendJson(res, { error: 'Session not found' }, 404)
      return
    }

    const toolCalls = this.collector.getToolCallsForSession(sessionId)
    const errors = this.collector.getErrors().filter((e) => e.sessionId === sessionId)

    sendJson(res, {
      session: {
        ...session,
        startedAtFormatted: formatRelativeTime(session.startedAt),
        lastActivityFormatted: formatRelativeTime(session.lastActivityAt),
        uptimeSeconds: Math.floor(
          (new Date(session.lastActivityAt).getTime() -
            new Date(session.startedAt).getTime()) /
            1000,
        ),
      },
      toolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        toolName: tc.toolName,
        startedAt: tc.startedAt,
        finishedAt: tc.finishedAt,
        durationMs: tc.durationMs,
        status: tc.status,
        argsSizeBytes: tc.argsSizeBytes,
        errorCode: tc.errorCode,
        errorMessage: tc.errorMessageShort,
      })),
      errors: errors.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        timestampFormatted: formatRelativeTime(e.timestamp),
        toolName: e.toolName,
        errorCode: e.errorCode,
        message: e.messageShort,
      })),
      stats: {
        toolCallCount: toolCalls.length,
        errorCount: errors.length,
        successfulCalls: toolCalls.filter((tc) => tc.status === 'success').length,
        failedCalls: toolCalls.filter((tc) => tc.status === 'error').length,
      },
    })
  }

  /**
   * GET /errors/recent - Get recent errors
   */
  errorsRecent(req: http.IncomingMessage, res: http.ServerResponse): void {
    const query = parseQuery(req.url || '')
    const limit = query.limit ? parseInt(query.limit, 10) : 50

    const errors = this.collector.getErrors(limit)

    sendJson(res, {
      errors: errors.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        timestamp: e.timestamp,
        timestampFormatted: formatRelativeTime(e.timestamp),
        toolName: e.toolName,
        errorCode: e.errorCode,
        message: e.messageShort,
      })),
      count: errors.length,
    })
  }

  /**
   * GET /dependencies - Get dependency usage stats
   */
  dependencies(req: http.IncomingMessage, res: http.ServerResponse): void {
    const usage = this.collector.getDependencyUsage()

    sendJson(res, {
      dependencies: usage.map(summarizeDependencyUsage),
      count: usage.length,
    })
  }

  /**
   * GET /timeseries - Get time-series data
   */
  timeseries(req: http.IncomingMessage, res: http.ServerResponse): void {
    const query = parseQuery(req.url || '')
    const interval = query.interval ? parseInt(query.interval, 10) : 5
    const minutes = query.minutes ? parseInt(query.minutes, 10) : 60

    let toolCalls = this.collector.getToolCalls()
    toolCalls = filterByTimeWindow(toolCalls, minutes)

    const data = computeTimeSeries(toolCalls, interval)

    sendJson(res, {
      interval: `${interval}m`,
      window: `${minutes}m`,
      data,
    })
  }

  /**
   * GET /tool-calls/:id - Get detailed tool call information
   */
  toolCallDetail(req: http.IncomingMessage, res: http.ServerResponse): void {
    const urlPath = req.url || ''
    const match = urlPath.match(/^\/tool-calls\/([^/]+)$/)
    if (!match) {
      sendJson(res, { error: 'Invalid tool call ID' }, 400)
      return
    }

    const toolCallId = match[1]
    const allToolCalls = this.collector.getToolCalls()
    const toolCall = allToolCalls.find((tc) => tc.id === toolCallId)

    if (!toolCall) {
      sendJson(res, { error: 'Tool call not found' }, 404)
      return
    }

    const session = this.collector.getSession(toolCall.sessionId)

    sendJson(res, {
      toolCall: {
        ...toolCall,
        startedAtFormatted: formatRelativeTime(toolCall.startedAt),
        finishedAtFormatted: toolCall.finishedAt
          ? formatRelativeTime(toolCall.finishedAt)
          : null,
        durationFormatted: toolCall.durationMs
          ? formatLatency(toolCall.durationMs)
          : null,
      },
      session: session
        ? {
            id: session.id,
            startedAt: session.startedAt,
            transportMode: session.transportMode,
          }
        : null,
    })
  }

  /**
   * GET /config - Get current dashboard configuration
   */
  getConfig(req: http.IncomingMessage, res: http.ServerResponse): void {
    sendJson(res, {
      detailedToolCallLogging: this.config.detailedToolCallLogging,
      retentionHours: this.config.retentionHours,
      enabled: this.config.enabled,
    })
  }

  /**
   * POST /config - Update dashboard configuration
   */
  async updateConfig(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    let body = ''
    for await (const chunk of req) {
      body += chunk.toString()
    }

    let updates: unknown
    try {
      updates = JSON.parse(body)
    } catch {
      sendJson(res, { error: 'Invalid JSON' }, 400)
      return
    }

    if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) {
      sendJson(res, { error: 'Invalid request body' }, 400)
      return
    }

    const changes: Record<string, unknown> = {}

    // Handle detailedToolCallLogging
    if ('detailedToolCallLogging' in updates) {
      const value = (updates as Record<string, unknown>).detailedToolCallLogging
      if (typeof value === 'boolean') {
        this.config.detailedToolCallLogging = value
        changes.detailedToolCallLogging = value
        // Update the collector
        this.collector.configure({ detailedToolCallLogging: value })
      }
    }

    // Handle retentionHours
    if ('retentionHours' in updates) {
      const value = (updates as Record<string, unknown>).retentionHours
      if (typeof value === 'number' && value > 0) {
        this.config.retentionHours = value
        changes.retentionHours = value
        this.collector.configure({ retentionHours: value })
      }
    }

    sendJson(res, {
      success: true,
      changes,
      config: {
        detailedToolCallLogging: this.config.detailedToolCallLogging,
        retentionHours: this.config.retentionHours,
        enabled: this.config.enabled,
      },
    })
  }

  /**
   * GET /schema-registry - List schema registry entries.
   */
  schemaRegistryList(req: http.IncomingMessage, res: http.ServerResponse): void {
    const query = parseQuery(req.url || '')
    const mode = parseMode(query.mode)
    const listing = this.schemaRegistry.list(mode)
    sendJson(res, {
      mode,
      storage: listing.storage,
      count: listing.schemas.length,
      schemas: listing.schemas,
    })
  }

  /**
   * POST /schema-registry - Register or replace one schema entry.
   */
  async schemaRegistryRegister(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const body = await parseJsonObjectBody(req)
      const mode = parseMode(body.mode)
      const result = this.schemaRegistry.register(mode, {
        id: typeof body.id === 'string' ? body.id : '',
        displayName: typeof body.displayName === 'string' ? body.displayName : '',
        matchesUrls: Array.isArray(body.matchesUrls) ? body.matchesUrls : [],
        schemaUrl: typeof body.schemaUrl === 'string' ? body.schemaUrl : '',
        activeOnSpec: Array.isArray(body.activeOnSpec) ? body.activeOnSpec : undefined,
      })
      sendJson(res, {
        success: true,
        mode,
        storage: result.storage,
        count: result.schemas.length,
        schemas: result.schemas,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, { error: message }, 400)
    }
  }

  /**
   * PUT /schema-registry/:id - Update one existing schema entry.
   */
  async schemaRegistryUpdate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const urlPath = req.url || ''
    const match = urlPath.match(/^\/schema-registry\/([^/?]+)$/)
    if (!match) {
      sendJson(res, { error: 'Invalid schema ID' }, 400)
      return
    }

    try {
      const body = await parseJsonObjectBody(req)
      const mode = parseMode(body.mode)
      const result = this.schemaRegistry.update(mode, {
        id: decodeURIComponent(match[1]),
        displayName:
          typeof body.displayName === 'string' ? body.displayName : undefined,
        matchesUrls: Array.isArray(body.matchesUrls) ? body.matchesUrls : undefined,
        schemaUrl: typeof body.schemaUrl === 'string' ? body.schemaUrl : undefined,
        activeOnSpec: Array.isArray(body.activeOnSpec) ? body.activeOnSpec : undefined,
      })
      sendJson(res, {
        success: true,
        mode,
        storage: result.storage,
        count: result.schemas.length,
        schemas: result.schemas,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, { error: message }, 400)
    }
  }

  /**
   * DELETE /schema-registry/:id - Remove one schema entry.
   */
  async schemaRegistryRemove(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const urlPath = req.url || ''
    const match = urlPath.match(/^\/schema-registry\/([^/?]+)(?:\?(.*))?$/)
    if (!match) {
      sendJson(res, { error: 'Invalid schema ID' }, 400)
      return
    }

    try {
      const parsed = new URL(req.url || '/', 'http://dashboard.local')
      const mode = parseMode(parsed.searchParams.get('mode') || undefined)
      const result = this.schemaRegistry.remove(mode, decodeURIComponent(match[1]))
      sendJson(res, {
        success: true,
        mode,
        storage: result.storage,
        count: result.schemas.length,
        schemas: result.schemas,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, { error: message }, 400)
    }
  }

  /**
   * GET / - Serve the dashboard HTML
   */
  serveIndex(req: http.IncomingMessage, res: http.ServerResponse): void {
    const indexPath = path.join(STATIC_DIR, 'static', 'index.html')
    sendStatic(res, indexPath, 'text/html')
  }

  /**
   * GET /static/* - Serve static files
   */
  serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
    const urlPath = req.url || ''
    const staticPath = urlPath.replace(/^\/static\//, '')
    const resolvedPath = path.resolve(STATIC_DIR, 'static', staticPath)

    // Security check: ensure path is within static directory
    if (!resolvedPath.startsWith(path.resolve(STATIC_DIR, 'static'))) {
      sendJson(res, { error: 'Forbidden' }, 403)
      return
    }

    const ext = path.extname(staticPath)
    const contentTypes: Record<string, string> = {
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.html': 'text/html',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
    }

    const contentType = contentTypes[ext] || 'application/octet-stream'
    sendStatic(res, resolvedPath, contentType)
  }
}

/**
 * HTTP server for the dashboard
 */
export class DashboardHttpServer {
  private server: http.Server | null = null
  private readonly config: DashboardConfig
  private readonly apiHandlers: DashboardApiHandlers

  constructor(
    collector: TelemetryCollector,
    config: DashboardConfig,
    schemaRegistry: SchemaRegistryStore,
  ) {
    this.config = config
    this.apiHandlers = new DashboardApiHandlers(collector, config, schemaRegistry)
  }

  /**
   * Starts the HTTP server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          })
          res.end()
          return
        }

        // Check auth for protected endpoints
        if (!validateAuth(req, this.config.authToken)) {
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer',
          })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        // Route the request
        this.route(req, res)
      })

      this.server.on('error', (err) => {
        // Don't crash the MCP server if dashboard fails to start
        // eslint-disable-next-line no-console
        console.error(`Dashboard server error: ${err.message}`)
      })

      this.server.listen(this.config.port, this.config.host, () => {
        // eslint-disable-next-line no-console
        console.log(
          `Dashboard server listening on http://${this.config.host}:${this.config.port}`,
        )
        resolve()
      })
    })
  }

  /**
   * Routes incoming requests to handlers
   */
  private route(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/'
    // Strip query string for routing
    const urlPath = url.split('?')[0]
    const method = req.method || 'GET'

    // Config endpoint allows POST
    if (urlPath === '/config') {
      if (method === 'GET') {
        this.apiHandlers.getConfig(req, res)
        return
      }
      if (method === 'POST') {
        void this.apiHandlers.updateConfig(req, res)
        return
      }
      sendJson(res, { error: 'Method not allowed' }, 405)
      return
    }

    // Schema registry endpoints
    if (urlPath === '/schema-registry') {
      if (method === 'GET') {
        this.apiHandlers.schemaRegistryList(req, res)
        return
      }
      if (method === 'POST') {
        void this.apiHandlers.schemaRegistryRegister(req, res)
        return
      }
      sendJson(res, { error: 'Method not allowed' }, 405)
      return
    }

    if (urlPath.startsWith('/schema-registry/') && urlPath !== '/schema-registry') {
      if (method === 'PUT') {
        void this.apiHandlers.schemaRegistryUpdate(req, res)
        return
      }
      if (method === 'DELETE') {
        void this.apiHandlers.schemaRegistryRemove(req, res)
        return
      }
      sendJson(res, { error: 'Method not allowed' }, 405)
      return
    }

    // All other endpoints are GET only
    if (method !== 'GET') {
      sendJson(res, { error: 'Method not allowed' }, 405)
      return
    }

    // API routes
    if (urlPath === '/health') {
      return this.apiHandlers.health(req, res)
    }

    if (urlPath === '/metrics/summary') {
      return this.apiHandlers.metricsSummary(req, res)
    }

    if (urlPath === '/metrics/tools') {
      return this.apiHandlers.metricsTools(req, res)
    }

    if (urlPath === '/sessions') {
      return this.apiHandlers.sessions(req, res)
    }

    if (urlPath.startsWith('/sessions/') && urlPath !== '/sessions') {
      return this.apiHandlers.sessionDetail(req, res)
    }

    if (urlPath === '/errors/recent') {
      return this.apiHandlers.errorsRecent(req, res)
    }

    if (urlPath === '/dependencies') {
      return this.apiHandlers.dependencies(req, res)
    }

    if (urlPath === '/timeseries') {
      return this.apiHandlers.timeseries(req, res)
    }

    if (urlPath.startsWith('/tool-calls/') && urlPath !== '/tool-calls') {
      return this.apiHandlers.toolCallDetail(req, res)
    }

    // Static routes
    if (urlPath === '/' || url === '/index.html') {
      return this.apiHandlers.serveIndex(req, res)
    }

    if (urlPath.startsWith('/static/')) {
      return this.apiHandlers.serveStatic(req, res)
    }

    // 404
    sendJson(res, { error: 'Not found' }, 404)
  }

  /**
   * Stops the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        // eslint-disable-next-line no-console
        console.log('Dashboard server stopped')
        resolve()
      })
    })
  }
}

/**
 * Parses dashboard configuration from environment variables
 */
export function parseDashboardConfig(): DashboardConfig {
  return {
    enabled: process.env.ROCRATE_DASHBOARD_ENABLED !== 'false',
    host: process.env.ROCRATE_DASHBOARD_HOST || '127.0.0.1',
    port: parseInt(process.env.ROCRATE_DASHBOARD_PORT || '9393', 10),
    authToken: process.env.ROCRATE_DASHBOARD_AUTH_TOKEN,
    retentionHours: parseInt(
      process.env.ROCRATE_DASHBOARD_RETENTION_HOURS || '24',
      10,
    ),
    detailedToolCallLogging:
      process.env.ROCRATE_DASHBOARD_DETAILED_LOGGING !== 'false',
  }
}

/**
 * Creates and starts a dashboard server if enabled
 * Also configures the collector with dashboard settings
 */
export async function startDashboardIfNeeded(
  collector: TelemetryCollector,
  schemaRegistry: SchemaRegistryStore,
): Promise<DashboardHttpServer | null> {
  const config = parseDashboardConfig()

  // Configure the collector with dashboard settings
  collector.configure?.({
    detailedToolCallLogging: config.detailedToolCallLogging,
  })

  if (!config.enabled) {
    return null
  }

  const server = new DashboardHttpServer(collector, config, schemaRegistry)

  try {
    await server.start()
    return server
  } catch (err) {
    // Log but don't fail - dashboard is optional
    // eslint-disable-next-line no-console
    console.error(`Failed to start dashboard server: ${err}`)
    return null
  }
}
