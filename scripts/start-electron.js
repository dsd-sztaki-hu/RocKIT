#!/usr/bin/env node

/**
 * start-electron.js
 * 1. Runs AppSetup (filesystem, cleanup)
 * 2. Delegates execution to "yarn workspace electron-app start"
 */

const { spawn } = require('child_process');
const AppSetup = require('./app-setup');

const MEMORY_LIMIT_ENV = 'AROMA_MEMORY_LIMIT_MB';

function configureMemoryLimit(env, logger = console) {
    const configuredValue = env[MEMORY_LIMIT_ENV];
    if (configuredValue === undefined || configuredValue.trim() === '') {
        return;
    }

    if (!/^\d+$/.test(configuredValue) || Number(configuredValue) <= 0) {
        throw new Error(`${MEMORY_LIMIT_ENV} must be a positive integer representing MiB.`);
    }

    const memoryFlag = `--max-old-space-size=${configuredValue}`;
    env.NODE_OPTIONS = [env.NODE_OPTIONS, memoryFlag].filter(Boolean).join(' ');

    logger.log(`[Memory] Requested backend and renderer heap limits: ${configuredValue} MiB.`);
}

async function main() {
    try {
        // 1. Initialize Setup
        const appSetup = new AppSetup();

        // 2. Run Pre-flight Checks & Cleanup
        appSetup.initializeFileSystem();
        await appSetup.cleanOrphanedApiKeys();

        console.log('Starting Theia Electron Backend via Yarn Workspace...');

        // 3. Launch via Yarn Workspace
        const env = appSetup.getEnv();
        configureMemoryLimit(env);

        const child = spawn(
            'yarn',
            ['workspace', 'electron-app', 'start'],
            {
                env,
                shell: true,
                stdio: 'inherit'
            }
        );

        child.on('close', code => process.exit(code));
    } catch (err) {
        console.error('Failed to start application:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { configureMemoryLimit };
