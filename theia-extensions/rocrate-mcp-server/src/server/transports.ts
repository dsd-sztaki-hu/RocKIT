import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { Readable, Writable } from 'node:stream'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { handleSocketLifecycleArgs } from '../bootstrap/socket-lifecycle'
import type { McpToolTextResult, ToolDefinition, TransportMode } from './types'

type TelemetryCollector = {
  deactivateSession: (sessionKey: string) => void
}

type StartServerOptions = {
  tools: ToolDefinition[]
  instructions: string
  startDashboardIfNeeded: () => void
  asRecord: (value: unknown) => Record<string, unknown>
  handleToolCall: (
    toolName: string,
    params: Record<string, unknown>,
    telemetryContext?: {
      sessionKey: string
      transportMode: TransportMode
    },
  ) => Promise<McpToolTextResult>
  getTelemetryCollector: () => TelemetryCollector | null
}

/**
 * Handles create sdk input stream.
 */
function createSdkInputStream(input: Readable): Readable {
  const normalized = new PassThrough()
  let buffer = Buffer.alloc(0)

  input.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      while (buffer.length > 0 && (buffer[0] === 0x0a || buffer[0] === 0x0d)) {
        buffer = buffer.subarray(1)
      }
      if (buffer.length === 0) {
        break
      }

      const preview = buffer.toString('utf8', 0, Math.min(buffer.length, 64))
      if (/^content-length:/i.test(preview)) {
        let headerTerminator = buffer.indexOf('\r\n\r\n')
        let delimiterSize = 4
        if (headerTerminator < 0) {
          headerTerminator = buffer.indexOf('\n\n')
          delimiterSize = 2
        }
        if (headerTerminator < 0) {
          break
        }
        const headerText = buffer.subarray(0, headerTerminator).toString('utf8')
        const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i)
        const bodyStart = headerTerminator + delimiterSize
        if (!contentLengthMatch) {
          buffer = buffer.subarray(bodyStart)
          continue
        }
        const contentLength = Number(contentLengthMatch[1])
        const totalLength = bodyStart + contentLength
        if (buffer.length < totalLength) {
          break
        }
        const payload = buffer.subarray(bodyStart, totalLength)
        normalized.write(payload)
        normalized.write('\n')
        buffer = buffer.subarray(totalLength)
        continue
      }

      const newlineIndex = buffer.indexOf(0x0a)
      if (newlineIndex < 0) {
        break
      }
      const line = buffer.subarray(0, newlineIndex).toString('utf8').trim()
      buffer = buffer.subarray(newlineIndex + 1)
      if (line === '') {
        continue
      }
      normalized.write(line)
      normalized.write('\n')
    }
  })

  input.on('end', () => {
    const trailing = buffer.toString('utf8').trim()
    if (trailing !== '') {
      normalized.write(trailing)
      normalized.write('\n')
    }
    normalized.end()
  })
  input.on('error', (error) => {
    normalized.emit('error', error)
  })

  return normalized
}

/**
 * Handles start server with transports.
 */
export async function startServerWithTransports(options: StartServerOptions): Promise<void> {
  let dashboardStartAttempted = false

  const startTransportServer = async (
    input: Readable,
    output: Writable,
    transportLabel: string,
  ): Promise<void> => {
    const sessionKey = `${transportLabel}:${randomUUID()}`
    input.resume()
    process.stderr.write(`rocrate-mcp-server: started (${transportLabel})\n`)

    if (!dashboardStartAttempted) {
      dashboardStartAttempted = true
      options.startDashboardIfNeeded()
    }

    const mcpServer = new McpServer(
      {
        name: 'rocrate-mcp-server',
        version: '0.0.0',
      },
      {
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        instructions: options.instructions,
      },
    )
    mcpServer.server.onerror = (error) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`rocrate-mcp-server: sdk error: ${message}\n`)
    }

    mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: options.tools,
    }))
    mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = options.asRecord(request.params.arguments)
      return options.handleToolCall(toolName, args, {
        sessionKey,
        transportMode: 'content-length',
      })
    })

    const collector = options.getTelemetryCollector()
    const closeSession = () => {
      if (collector) {
        collector.deactivateSession(sessionKey)
      }
    }
    input.on('end', closeSession)
    input.on('close', closeSession)
    input.on('error', closeSession)

    const normalizedInput = createSdkInputStream(input)
    const transport = new StdioServerTransport(normalizedInput, output)
    await mcpServer.connect(transport)
  }

  const handledSocketMode = await handleSocketLifecycleArgs(process.argv.slice(2), {
    execPath: process.execPath,
    serverScriptPath: process.argv[1],
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    onSocketConnection: (socket, socketPath) => {
      void startTransportServer(socket, socket, `socket:${socketPath}`).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`rocrate-mcp-server: session failed: ${message}\n`)
        socket.destroy()
      })
    },
  })
  if (handledSocketMode) {
    return
  }

  await startTransportServer(process.stdin, process.stdout, 'stdio')
}
