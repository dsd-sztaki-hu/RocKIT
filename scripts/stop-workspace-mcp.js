// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function stopWorkspaceMcpProcesses(root, options = {}) {
    const platform = options.platform ?? process.platform;
    if (platform !== 'win32') return;

    const run = options.spawnSync ?? spawnSync;
    const kill = options.kill ?? process.kill;
    const log = options.log ?? console.log;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? (milliseconds => Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds,
    ));
    const normalize = value => value.replace(/\//g, '\\').toLowerCase();
    const electron = normalize(path.win32.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'));
    const server = normalize(path.win32.join(root, 'theia-extensions', 'rocrate-mcp-server', 'lib', 'server.js'));
    const escapedServer = server.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const serverArgument = new RegExp(`(?:^|[\\s"])${escapedServer}(?=[\\s"]|$)`);

    const list = () => {
        const result = run('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            '$ErrorActionPreference = "Stop"; @(' +
            'Get-CimInstance Win32_Process -Filter "Name = \'electron.exe\'" | ' +
            'Select-Object ProcessId, ExecutablePath, CommandLine' +
            ') | ConvertTo-Json -Compress',
        ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
        if (result.error || result.status !== 0) {
            throw new Error('Could not inspect background Electron processes before rebuilding. ' +
                (result.error?.message || result.stderr?.trim() || `Exit status ${result.status}`));
        }
        const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim() || '[]');
        return (Array.isArray(parsed) ? parsed : [parsed])
            .filter(item => item && normalize(item.ExecutablePath || '') === electron);
    };
    const isMcp = item => serverArgument.test(normalize(item.CommandLine || ''));
    const processes = list();
    // Do not clean an active app's runtime or stop unrelated Electron apps.
    if (processes.some(item => !isMcp(item))) {
        throw new Error('Close this workspace\'s Electron app before running rebuild:electron.');
    }
    if (processes.length === 0) return;

    for (const item of processes) {
        if (!Number.isSafeInteger(item.ProcessId) || item.ProcessId <= 0) {
            throw new Error('The process inventory returned an invalid MCP process ID.');
        }
        try {
            kill(item.ProcessId);
            log(`[Rebuild] Stopped background RO-Crate MCP process ${item.ProcessId}.`);
        } catch (error) {
            // Stopping a client can also stop its daemon before we reach it.
            if (error.code !== 'ESRCH') throw error;
        }
    }

    const deadline = now() + 10000;
    while (list().length > 0) {
        if (now() >= deadline) {
            throw new Error('Workspace Electron processes are still running; rebuild stopped before cleanup.');
        }
        sleep(250);
    }
    log('[Rebuild] Workspace Electron MCP processes have exited.');
}

module.exports = { stopWorkspaceMcpProcesses };
