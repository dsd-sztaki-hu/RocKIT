#!/usr/bin/env node

/**
 * start-electron.js
 *
 * This script sets THEIA_CONFIG_DIR to ~/.aroma (cross-platform)
 * and then starts Theia in Electron mode.
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

// Build the path to ~/.aroma in the user's home directory
const theiaConfigDir = path.join(os.homedir(), '.aroma');

console.log(`Setting THEIA_CONFIG_DIR to: ${theiaConfigDir}`);

// Clone the current environment variables and set THEIA_CONFIG_DIR
const env = { ...process.env, THEIA_CONFIG_DIR: theiaConfigDir };

// Spawn Theia in Electron mode
const child = spawn(
    'theia',               // command
    ['start'],             // args
    {
        env,               // pass the updated environment
        shell: true,       // required for Windows
        stdio: 'inherit'   // forward output to the console
    }
);

// Exit with the same code as the Theia process
child.on('close', code => process.exit(code));
