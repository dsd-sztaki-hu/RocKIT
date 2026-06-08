#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const canonicalRoot = fs.realpathSync.native(path.resolve(__dirname, '..'));

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
