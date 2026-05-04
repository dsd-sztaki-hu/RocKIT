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
  protected disposed = false
  protected pending = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >()

  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    super()
    const launch = this.resolveLaunch(command, args)
    this.child = spawn(launch.command, launch.args, {
      cwd,
      detached: process.platform !== 'win32',
      env,
      shell: launch.shell,
      stdio: 'pipe',
    })
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
    if (this.disposed) {
      return
    }
    this.disposed = true
    const error = new Error('JSON-RPC process disposed')
    for (const request of this.pending.values()) {
      request.reject(error)
    }
    this.pending.clear()
    const pid = this.child.pid
    if (process.platform === 'win32' && pid) {
      const taskkill = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      taskkill.on('error', () => this.child.kill())
      return
    }
    if (pid) {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        this.child.kill('SIGTERM')
      }
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {}
      }, 2000).unref()
      return
    }
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
      const trimmed = line.trim()
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        this.emit('stderr', trimmed)
        continue
      }
      try {
        this.handleMessage(JSON.parse(trimmed) as JsonRpcMessage)
      } catch (error) {
        this.emit('stderr', trimmed)
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

  protected resolveLaunch(
    command: string,
    args: string[],
  ): { command: string; args: string[]; shell?: boolean } {
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
      return {
        command,
        args,
        shell: true,
      }
    }
    return { command, args }
  }
}
