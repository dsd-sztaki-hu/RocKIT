// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { type ChildProcess, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { BackendApplicationContribution } from '@theia/core/lib/node'
import { injectable } from 'inversify'
import {
  getRocrateMcpServerPathCandidates,
  resolveRocrateMcpPidPath,
  resolveRocrateMcpSocketPath,
} from '../common/rocrate-mcp-config'
import {
  isRocrateMcpDaemonAvailable,
  shutdownRocrateMcpDaemon,
} from './rocrate-mcp-daemon-control'

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
      console.info(
        '[rockit] RO-Crate MCP daemon auto-start disabled; MCP clients will start it from their configured launch command',
      )
      return
    }
    await this.ensureStarted()
  }

  async onStop(): Promise<void> {
    const socketPath = this.resolveSocketPath()
    const pidPath = this.resolvePidPath()
    const ownedProcess = this.daemonProcess

    if (!this.startedDaemon) {
      return
    }

    const shutdownResult = await shutdownRocrateMcpDaemon(socketPath)

    if (shutdownResult.status !== 'stopped' && ownedProcess?.pid) {
      try {
        ownedProcess.kill()
        await this.waitForOwnedProcessExit(ownedProcess)
      } catch (error) {
        console.warn(
          '[rockit] failed to stop RO-Crate MCP daemon:',
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    if (shutdownResult.status === 'failed') {
      console.warn(
        '[rockit] RO-Crate MCP daemon shutdown was not acknowledged:',
        shutdownResult.reason,
      )
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

    const previousDaemonStopped = await this.stopExistingDaemon(socketPath, pidPath)
    if (!previousDaemonStopped) {
      return
    }
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
    return process.env.ROCKIT_ROCRATE_MCP_AUTO_START === 'true'
  }

  protected publishFrontendRuntimeEnv(): void {
    if (!process.env.ROCKIT_ROCRATE_MCP_NODE_PATH) {
      process.env.ROCKIT_ROCRATE_MCP_NODE_PATH = process.execPath
    }
    if (process.versions.electron) {
      process.env.ROCKIT_ROCRATE_MCP_ELECTRON_RUN_AS_NODE = '1'
    }
  }

  protected resolveDaemonRuntime(): DaemonRuntime {
    const env = { ...process.env }
    const nodePath = process.env.ROCKIT_ROCRATE_MCP_NODE_PATH
    if (
      process.env.ROCKIT_ROCRATE_MCP_ELECTRON_RUN_AS_NODE === '1' ||
      (!nodePath && process.versions.electron)
    ) {
      env.ELECTRON_RUN_AS_NODE = '1'
    }
    if (nodePath) {
      const env = { ...process.env }
      if (
        process.versions.electron ||
        env.ROCKIT_ROCRATE_MCP_ELECTRON_RUN_AS_NODE === '1'
      ) {
        env.ELECTRON_RUN_AS_NODE = '1'
      }
      return {
        command: nodePath,
        env,
      }
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
      socketPathOverride: process.env.ROCKIT_ROCRATE_MCP_SOCKET_PATH,
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
      serverPathOverride: process.env.ROCKIT_ROCRATE_MCP_SERVER_PATH,
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
  ): Promise<boolean> {
    const shutdownResult = await shutdownRocrateMcpDaemon(socketPath)
    if (shutdownResult.status === 'failed') {
      console.warn(
        '[rockit] refusing to replace an existing RO-Crate MCP daemon:',
        shutdownResult.reason,
      )
      return false
    }

    this.removePidFile(pidPath)
    return true
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

  protected async waitForOwnedProcessExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }

    await new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined
      const finish = (): void => {
        if (timer) {
          clearTimeout(timer)
        }
        child.off('exit', finish)
        resolve()
      }
      child.once('exit', finish)
      timer = setTimeout(finish, 2000)
    })
  }

  protected async waitForSocket(socketPath: string): Promise<void> {
    const attempts = 30
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await isRocrateMcpDaemonAvailable(socketPath)) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`RO-Crate MCP daemon startup timeout: ${socketPath}`)
  }
}
