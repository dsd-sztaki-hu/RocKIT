#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const resolvedRoot = fs.realpathSync.native(path.resolve(__dirname, '..'));

const getCanonicalRoot = root => {
    if (process.platform !== 'win32') {
        return root;
    }

    // Yarn workspace junctions retain the drive-letter casing used during
    // installation. Match it so webpack does not load the same files twice
    // under paths that differ only by case.
    const electronAppLink = path.join(root, 'node_modules', 'electron-app');
    if (fs.existsSync(electronAppLink)) {
        const junctionRoot = path.dirname(fs.realpathSync.native(electronAppLink));
        if (junctionRoot.toLowerCase() === root.toLowerCase()) {
            return junctionRoot;
        }
    }

    return root;
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
