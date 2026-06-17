import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import { BackendApplicationContribution } from '@theia/core/lib/node'
import { injectable } from 'inversify'
import {
  getRocrateMcpServerPathCandidates,
  resolveRocrateMcpPidPath,
  resolveRocrateMcpSocketPath,
  ROCRATE_MCP_SHUTDOWN_CONTROL_MESSAGE,
} from '../common/rocrate-mcp-config'

type DaemonRuntime = {
  command: string
  env: NodeJS.ProcessEnv
}

@injectable()
export class RocrateMcpDaemonManager implements BackendApplicationContribution {
  protected daemonProcess: ChildProcess | undefined
  protected startedDaemon = false

  async onStart(): Promise<void> {
    this.publishFrontendRuntimeEnv()
    if (!this.isAutoStartEnabled()) {
      return
    }
    await this.ensureStarted()
  }

  async onStop(): Promise<void> {
    const socketPath = this.resolveSocketPath()
    const pidPath = this.resolvePidPath()

    if (!this.startedDaemon) {
      return
    }

    await this.requestSocketShutdown(socketPath)

    if (this.daemonProcess?.pid) {
      try {
        this.daemonProcess.kill()
      } catch (error) {
        console.warn(
          '[rockit] failed to stop RO-Crate MCP daemon:',
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    this.removePidFile(pidPath)
    this.daemonProcess = undefined
    this.startedDaemon = false
  }

  protected async ensureStarted(): Promise<void> {
    const socketPath = this.resolveSocketPath()
    const pidPath = this.resolvePidPath()

    const serverPath = this.resolveServerPath()
    if (!serverPath) {
      console.warn('[rockit] RO-Crate MCP server script not found; skipping auto-start')
      return
    }

    await this.stopExistingDaemon(socketPath, pidPath)
    this.cleanupStaleSocket(socketPath)
    this.ensureSocketDirectory(socketPath)
    this.ensurePidDirectory(pidPath)

    const runtime = this.resolveDaemonRuntime()
    console.info('[rockit] starting RO-Crate MCP daemon', {
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
        this.startedDaemon = false
        this.removePidFile(pidPath)
      }
      console.info(
        `[rockit] RO-Crate MCP daemon exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      )
    })

    this.daemonProcess = child
    this.startedDaemon = true
    if (child.pid) {
      this.writePidFile(pidPath, child.pid)
    }
    await this.waitForSocket(socketPath)
    console.info(`[rockit] started RO-Crate MCP daemon at ${socketPath}`)
  }

  protected isAutoStartEnabled(): boolean {
    return (
      process.env.ROCKIT_ROCRATE_MCP_AUTO_START ??
      process.env.AROMA_ROCRATE_MCP_AUTO_START
    ) !== 'false'
  }

  protected publishFrontendRuntimeEnv(): void {
    if (!process.env.ROCKIT_ROCRATE_MCP_NODE_PATH) {
      process.env.ROCKIT_ROCRATE_MCP_NODE_PATH =
        process.env.AROMA_ROCRATE_MCP_NODE_PATH || process.execPath
    }
    if (process.versions.electron) {
      process.env.ROCKIT_ROCRATE_MCP_ELECTRON_RUN_AS_NODE = '1'
    }
  }

  protected resolveDaemonRuntime(): DaemonRuntime {
    const nodePath =
      process.env.ROCKIT_ROCRATE_MCP_NODE_PATH ||
      process.env.AROMA_ROCRATE_MCP_NODE_PATH
    if (nodePath) {
      return {
        command: nodePath,
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
      socketPathOverride:
        process.env.ROCKIT_ROCRATE_MCP_SOCKET_PATH ||
        process.env.AROMA_ROCRATE_MCP_SOCKET_PATH,
      username: process.env.USERNAME,
    })
  }

  protected resolvePidPath(): string {
    return resolveRocrateMcpPidPath({
      homeDir: process.env.HOME || process.env.USERPROFILE,
      platform: process.platform,
      username: process.env.USERNAME,
    })
  }

  protected resolveServerPath(): string | undefined {
    const candidates = getRocrateMcpServerPathCandidates({
      appProjectPath: process.env.THEIA_APP_PROJECT_PATH,
      resourcesPath: process.resourcesPath,
      serverPathOverride:
        process.env.ROCKIT_ROCRATE_MCP_SERVER_PATH ||
        process.env.AROMA_ROCRATE_MCP_SERVER_PATH,
    })

    return candidates.find((candidate) => fs.existsSync(candidate))
  }

  protected ensureSocketDirectory(socketPath: string): void {
    if (process.platform === 'win32' || socketPath.startsWith('\\\\.\\pipe\\')) {
      return
    }

    fs.mkdirSync(path.dirname(socketPath), { recursive: true })
  }

  protected ensurePidDirectory(pidPath: string): void {
    fs.mkdirSync(path.dirname(pidPath), { recursive: true })
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
        '[rockit] failed to clean stale RO-Crate MCP socket:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  protected async stopExistingDaemon(
    socketPath: string,
    pidPath: string,
  ): Promise<void> {
    const stoppedByControl = await this.requestSocketShutdown(socketPath)
    if (stoppedByControl) {
      await this.waitForSocketClosed(socketPath)
    }

    const stoppedByPid = await this.stopPidFileProcess(pidPath)
    if (stoppedByPid) {
      await this.waitForSocketClosed(socketPath)
    }
  }

  protected requestSocketShutdown(socketPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      let response = ''
      const finish = (value: boolean) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        socket.destroy()
        resolve(value)
      }
      const socket = net.createConnection(socketPath)
      const timer = setTimeout(() => finish(false), 750)
      socket.once('connect', () => {
        socket.write(ROCRATE_MCP_SHUTDOWN_CONTROL_MESSAGE)
      })
      socket.on('data', (chunk) => {
        response += chunk.toString('utf8')
        if (response.includes('OK')) {
          finish(true)
        }
      })
      socket.once('error', () => finish(false))
      socket.once('close', () => finish(response.includes('OK')))
    })
  }

  protected readPidFile(pidPath: string): number | undefined {
    try {
      const raw = fs.readFileSync(pidPath, 'utf8').trim()
      const pid = Number(raw)
      return Number.isInteger(pid) && pid > 0 ? pid : undefined
    } catch {
      return undefined
    }
  }

  protected writePidFile(pidPath: string, pid: number): void {
    try {
      fs.writeFileSync(pidPath, String(pid), 'utf8')
    } catch (error) {
      console.warn(
        '[rockit] failed to write RO-Crate MCP daemon PID file:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  protected removePidFile(pidPath: string): void {
    try {
      if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath)
      }
    } catch {
      // PID file cleanup is best effort.
    }
  }

  protected async stopPidFileProcess(pidPath: string): Promise<boolean> {
    const pid = this.readPidFile(pidPath)
    if (!pid || pid === process.pid) {
      this.removePidFile(pidPath)
      return false
    }

    try {
      process.kill(pid, 0)
    } catch {
      this.removePidFile(pidPath)
      return false
    }

    try {
      process.kill(pid)
      this.removePidFile(pidPath)
      await this.waitForPidExit(pid)
      return true
    } catch (error) {
      console.warn(
        '[rockit] failed to stop previous RO-Crate MCP daemon process:',
        error instanceof Error ? error.message : String(error),
      )
      return false
    }
  }

  protected async waitForPidExit(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        process.kill(pid, 0)
      } catch {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
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

  protected async waitForSocketClosed(socketPath: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await this.probeSocket(socketPath))) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
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
