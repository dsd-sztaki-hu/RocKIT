import { EventEmitter } from 'events'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'

export interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

export class JsonRpcChildProcess extends EventEmitter {
  protected child: ChildProcessWithoutNullStreams
  protected nextId = 1
  protected stdoutBuffer = Buffer.alloc(0)
  protected pending = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >()

  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    super()
    this.child = spawn(command, args, { cwd, env, stdio: 'pipe' })
    this.child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk))
    this.child.stderr.on('data', (chunk: Buffer) => this.emit('stderr', chunk.toString()))
    this.child.on('error', (error) => this.emit('error', error))
    this.child.on('exit', (code, signal) => {
      const error = new Error(`JSON-RPC process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
      for (const request of this.pending.values()) {
        request.reject(error)
      }
      this.pending.clear()
      this.emit('exit', { code, signal })
    })
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    const message: JsonRpcMessage = { jsonrpc: '2.0', id, method }
    if (params !== undefined) {
      message.params = params
    }
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.write(message)
    return promise
  }

  notify(method: string, params?: unknown): void {
    const message: JsonRpcMessage = { jsonrpc: '2.0', method }
    if (params !== undefined) {
      message.params = params
    }
    this.write(message)
  }

  respond(id: string | number | null, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  dispose(): void {
    this.child.kill()
  }

  protected write(message: JsonRpcMessage): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.child.stdin.write(body)
  }

  protected handleStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) {
        return
      }
      const header = this.stdoutBuffer.slice(0, headerEnd).toString('utf8')
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4)
        continue
      }
      const length = Number(lengthMatch[1])
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + length
      if (this.stdoutBuffer.length < bodyEnd) {
        return
      }
      const body = this.stdoutBuffer.slice(bodyStart, bodyEnd).toString('utf8')
      this.stdoutBuffer = this.stdoutBuffer.slice(bodyEnd)
      try {
        this.handleMessage(JSON.parse(body) as JsonRpcMessage)
      } catch (error) {
        this.emit('error', error)
      }
    }
  }

  protected handleMessage(message: JsonRpcMessage): void {
    if (
      message.id !== undefined &&
      message.id !== null &&
      (message.result !== undefined || message.error !== undefined)
    ) {
      const request = this.pending.get(message.id)
      if (request) {
        this.pending.delete(message.id)
        if (message.error !== undefined) {
          request.reject(new Error(JSON.stringify(message.error)))
        } else {
          request.resolve(message.result)
        }
      }
      return
    }
    this.emit('message', message)
  }
}
