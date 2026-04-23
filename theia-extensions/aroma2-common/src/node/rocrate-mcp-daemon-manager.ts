import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import { BackendApplicationContribution } from '@theia/core/lib/node'
import { injectable } from 'inversify'
import {
  getRocrateMcpServerPathCandidates,
  resolveRocrateMcpSocketPath,
} from '../common/rocrate-mcp-config'

type DaemonOwnership = 'existing' | 'started-by-aroma'
type DaemonRuntime = {
  command: string
  env: NodeJS.ProcessEnv
}

@injectable()
export class RocrateMcpDaemonManager implements BackendApplicationContribution {
  protected daemonProcess: ChildProcess | undefined
  protected ownership: DaemonOwnership | undefined

  async onStart(): Promise<void> {
    if (!this.isAutoStartEnabled()) {
      return
    }
    await this.ensureStarted()
  }

  onStop(): void {
    if (this.ownership !== 'started-by-aroma' || !this.daemonProcess?.pid) {
      return
    }

    try {
      this.daemonProcess.kill()
    } catch (error) {
      console.warn(
        '[aroma] failed to stop RO-Crate MCP daemon:',
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      this.daemonProcess = undefined
      this.ownership = undefined
    }
  }

  protected async ensureStarted(): Promise<void> {
    const socketPath = this.resolveSocketPath()
    const isRunning = await this.probeSocket(socketPath)
    if (isRunning) {
      this.ownership = 'existing'
      console.info(`[aroma] reusing existing RO-Crate MCP daemon at ${socketPath}`)
      return
    }

    const serverPath = this.resolveServerPath()
    if (!serverPath) {
      console.warn('[aroma] RO-Crate MCP server script not found; skipping auto-start')
      return
    }

    this.cleanupStaleSocket(socketPath)
    this.ensureSocketDirectory(socketPath)

    const runtime = this.resolveDaemonRuntime()
    console.info('[aroma] starting RO-Crate MCP daemon', {
      command: runtime.command,
      electronRunAsNode: runtime.env.ELECTRON_RUN_AS_NODE === '1',
      serverPath,
      socketPath,
    })
    const child = spawn(runtime.command, [serverPath, '--listen', socketPath], {
      cwd: path.dirname(serverPath),
      env: runtime.env,
      stdio: 'ignore',
    })
    child.on('exit', (code, signal) => {
      if (this.daemonProcess?.pid === child.pid) {
        this.daemonProcess = undefined
        this.ownership = undefined
      }
      console.info(
        `[aroma] RO-Crate MCP daemon exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      )
    })

    this.daemonProcess = child
    this.ownership = 'started-by-aroma'
    await this.waitForSocket(socketPath)
    console.info(`[aroma] started RO-Crate MCP daemon at ${socketPath}`)
  }

  protected isAutoStartEnabled(): boolean {
    return process.env.AROMA_ROCRATE_MCP_AUTO_START !== 'false'
  }

  protected resolveDaemonRuntime(): DaemonRuntime {
    if (process.env.AROMA_ROCRATE_MCP_NODE_PATH) {
      return {
        command: process.env.AROMA_ROCRATE_MCP_NODE_PATH,
        env: process.env,
      }
    }

    const env = { ...process.env }
    if (process.versions.electron) {
      env.ELECTRON_RUN_AS_NODE = '1'
    }

    return {
      command: process.execPath,
      env,
    }
  }

  protected resolveSocketPath(): string {
    return resolveRocrateMcpSocketPath({
      homeDir: process.env.HOME || process.env.USERPROFILE,
      platform: process.platform,
      socketPathOverride: process.env.AROMA_ROCRATE_MCP_SOCKET_PATH,
      username: process.env.USERNAME,
    })
  }

  protected resolveServerPath(): string | undefined {
    const candidates = getRocrateMcpServerPathCandidates({
      appProjectPath: process.env.THEIA_APP_PROJECT_PATH,
      resourcesPath: process.resourcesPath,
      serverPathOverride: process.env.AROMA_ROCRATE_MCP_SERVER_PATH,
    })

    return candidates.find((candidate) => fs.existsSync(candidate))
  }

  protected ensureSocketDirectory(socketPath: string): void {
    if (process.platform === 'win32' || socketPath.startsWith('\\\\.\\pipe\\')) {
      return
    }

    fs.mkdirSync(path.dirname(socketPath), { recursive: true })
  }

  protected cleanupStaleSocket(socketPath: string): void {
    if (process.platform === 'win32' || socketPath.startsWith('\\\\.\\pipe\\')) {
      return
    }

    if (!fs.existsSync(socketPath)) {
      return
    }

    try {
      fs.unlinkSync(socketPath)
    } catch (error) {
      console.warn(
        '[aroma] failed to clean stale RO-Crate MCP socket:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  protected probeSocket(socketPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection(socketPath)
      socket.once('connect', () => {
        socket.end()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })
  }

  protected async waitForSocket(socketPath: string): Promise<void> {
    const attempts = 30
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await this.probeSocket(socketPath)) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`RO-Crate MCP daemon startup timeout: ${socketPath}`)
  }
}
