#!/usr/bin/env node

/**
 * start-electron.js
 * * 1. Runs AppSetup (env loading, filesystem creation)
 * 2. Delegates execution to "yarn workspace electron-app start"
 */

const { spawn } = require('child_process');
const AppSetup = require('./app-setup');

// 1. Initialize Setup
const appSetup = new AppSetup();

// 2. Run Configuration & Initialization Steps
appSetup.loadEnvironment();      
appSetup.initializeFileSystem(); 

console.log('Starting Theia Electron Backend via Yarn Workspace...');

// 3. Launch via Yarn Workspace
// This tells Yarn to go find the 'electron-app' package and run its 'start' script.
// Yarn handles the directory switching automatically.
const child = spawn(
    'yarn',
    ['workspace', 'electron-app', 'start'],
    {
        // We stay in the root folder, Yarn handles the rest
        env: appSetup.getEnv(), 
        shell: true,
        stdio: 'inherit'
    }
);

child.on('close', code => process.exit(code));