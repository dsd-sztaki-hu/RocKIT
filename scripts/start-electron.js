#!/usr/bin/env node

/**
 * start-electron.js
 * 1. Runs AppSetup (filesystem, cleanup)
 * 2. Delegates execution to "yarn workspace electron-app start"
 */

const { spawn } = require('child_process');
const AppSetup = require('./app-setup');

(async () => {
    try {
        // 1. Initialize Setup
        const appSetup = new AppSetup();

        // 2. Run Pre-flight Checks & Cleanup
        appSetup.initializeFileSystem();
        await appSetup.cleanOrphanedApiKeys();

        console.log('Starting Theia Electron Backend via Yarn Workspace...');

        // 3. Launch via Yarn Workspace
        const child = spawn(
            'yarn',
            ['workspace', 'electron-app', 'start'],
            {
                env: appSetup.getEnv(), 
                shell: true,
                stdio: 'inherit'
            }
        );

        child.on('close', code => process.exit(code));
    } catch (err) {
        console.error('Failed to start application:', err);
        process.exit(1);
    }
})();