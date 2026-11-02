#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { stopWorkspaceMcpProcesses } = require('./stop-workspace-mcp');

const resolvedRoot = fs.realpathSync.native(path.resolve(__dirname, '..'));

const getCanonicalRoot = root => {
    if (process.platform !== 'win32') {
        return root;
    }

    const lowerDriveLetter = value => value.replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`);

    // Yarn workspace links retain the drive-letter casing used during
    // installation. Read the link target itself; fs.realpathSync.native can
    // normalize the drive casing differently on different Windows machines.
    const electronAppLink = path.join(root, 'node_modules', 'electron-app');
    if (fs.existsSync(electronAppLink)) {
        try {
            const workspaceTarget = fs.readlinkSync(electronAppLink);
            const workspaceRoot = path.dirname(path.resolve(path.dirname(electronAppLink), workspaceTarget));
            if (workspaceRoot.toLowerCase() === root.toLowerCase()) {
                return workspaceRoot;
            }
        } catch {
            // Keep the fallback below for first installs and incomplete installs.
        }
    }

    return lowerDriveLetter(root);
};

const canonicalRoot = getCanonicalRoot(resolvedRoot);

const env = {
    ...process.env,
    INIT_CWD: canonicalRoot,
    PWD: canonicalRoot
};

const isRebuild = process.argv.includes('--rebuild');
const yarnCommands = isRebuild
    ? [
        ['run', 'clean'],
        // Yarn's lifecycle runner resolves its own node-gyp 9, which selects
        // unavailable ClangCL tooling with Node 24 on Windows. Build native
        // modules with the workspace's node-gyp 11 after linking instead.
        ['install', '--frozen-lockfile', ...(process.platform === 'win32' ? ['--ignore-scripts'] : [])],
        ['run', 'build:electron:impl']
    ]
    : [['run', 'build:electron:impl']];

const runYarn = args => {
    if (process.platform === 'win32') {
        return spawnSync(
            process.env.ComSpec || 'cmd.exe',
            ['/d', '/c', 'yarn.cmd', ...args],
            {
                cwd: canonicalRoot,
                env,
                stdio: 'inherit'
            }
        );
    }

    return spawnSync('yarn', args, {
        cwd: canonicalRoot,
        env,
        stdio: 'inherit'
    });
};

const rebuildWindowsNativeModules = () => {
    const nodeGyp = path.join(canonicalRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
    const nativeModules = [
        '@vscode/windows-ca-certs',
        'drivelist',
        '@theia/ffmpeg',
        'native-keymap'
    ];

    for (const moduleName of nativeModules) {
        console.log(`Rebuilding ${moduleName} with node-gyp 11...`);
        const result = spawnSync(process.execPath, [nodeGyp, 'rebuild'], {
            cwd: path.join(canonicalRoot, 'node_modules', moduleName),
            env,
            stdio: 'inherit'
        });
        if (result.error || result.status !== 0) {
            console.error(result.error?.message || `${moduleName} rebuild exited with ${result.status}`);
            process.exit(result.status ?? 1);
        }
    }
};

// This must run before clean removes Electron and the MCP server from disk.
if (isRebuild) {
    try {
        stopWorkspaceMcpProcesses(canonicalRoot);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

for (const args of yarnCommands) {
    const result = runYarn(args);

    if (result.error) {
        console.error(result.error.message);
        process.exit(1);
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }

    if (isRebuild && process.platform === 'win32' && args[0] === 'install') {
        rebuildWindowsNativeModules();
    }
}
