#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

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

const yarnCommands = process.argv.includes('--rebuild')
    ? [
        ['run', 'clean'],
        ['install'],
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

for (const args of yarnCommands) {
    const result = runYarn(args);

    if (result.error) {
        console.error(result.error.message);
        process.exit(1);
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}
