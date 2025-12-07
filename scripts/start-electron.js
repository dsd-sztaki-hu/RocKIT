#!/usr/bin/env node

/**
 * start-electron.js
 * * Orchestrates the application startup:
 * 1. Runs AppSetup to prepare environment and filesystem
 * 2. Spawns the Theia Electron backend
 */

const { spawn } = require('child_process');
const AppSetup = require('./app-setup');

// 1. Initialize Setup
const appSetup = new AppSetup();

// 2. Run Configuration & Initialization Steps
appSetup.loadEnvironment();       // Load .env
appSetup.initializeFileSystem();  // Create folders in os.homedir()

console.log('Starting Theia Electron Backend...');

// 3. Launch Theia
const child = spawn(
    'theia',
    ['start'],
    {
        // Pass the environment we prepared (containing CEDAR_API_KEY and AROMA_ROOT_PATH)
        env: appSetup.getEnv(), 
        shell: true,
        stdio: 'inherit'
    }
);

child.on('close', code => process.exit(code));