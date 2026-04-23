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
  protected stdoutBuffer = ''
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
    const message: JsonRpcMessage = { id, method }
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
    const message: JsonRpcMessage = { method }
    if (params !== undefined) {
      message.params = params
    }
    this.write(message)
  }

  respond(id: string | number | null, result: unknown): void {
    this.write({ id, result })
  }

  dispose(): void {
    this.child.kill()
  }

  protected write(message: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  protected handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8')
    while (true) {
      const lineEnd = this.stdoutBuffer.indexOf('\n')
      if (lineEnd < 0) {
        return
      }
      const line = this.stdoutBuffer.slice(0, lineEnd).replace(/\r$/, '')
      this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1)
      if (!line.trim()) {
        continue
      }
      try {
        this.handleMessage(JSON.parse(line) as JsonRpcMessage)
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
