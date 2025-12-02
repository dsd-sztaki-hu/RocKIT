#!/usr/bin/env node

/**
 * start-electron.js
 *
 * Starts Theia in Electron mode with configured environment variables.
 */

const { spawn } = require('child_process');
const EnvConfig = require('./env-config');

// Create an instance of the environment configuration
const envConfig = new EnvConfig();

// Set the default THEIA_CONFIG_DIR
envConfig.setDefaultTheiaConfigDir();

// Spawn Theia in Electron mode with the configured environment
const child = spawn(
    'theia',               // command
    ['start'],             // args
    {
        env: envConfig.getEnv(),  // pass the configured environment
        shell: true,              // required for Windows
        stdio: 'inherit'          // forward output to the console
    }
);

// Exit with the same code as the Theia process
child.on('close', code => process.exit(code));  