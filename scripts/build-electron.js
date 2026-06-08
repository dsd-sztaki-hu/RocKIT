#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const canonicalRoot =
    process.platform === 'win32'
        ? root.replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`)
        : root;

const env = {
    ...process.env,
    INIT_CWD: canonicalRoot,
    PWD: canonicalRoot
};

const result =
    process.platform === 'win32'
        ? spawnSync(
            process.env.ComSpec || 'cmd.exe',
            ['/d', '/c', 'yarn.cmd run build:electron:impl'],
            {
                cwd: canonicalRoot,
                env,
                stdio: 'inherit'
            }
        )
        : spawnSync('yarn', ['run', 'build:electron:impl'], {
            cwd: canonicalRoot,
            env,
            stdio: 'inherit'
        });

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}

process.exit(result.status ?? 1);
