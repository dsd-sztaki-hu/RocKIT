#!/usr/bin/env node

/**
 * app-setup.js
 * * Responsibilities:
 * 1. Load environment variables (mainly for API keys)
 * 2. FORCE the configuration directory to ~/.aroma (ignoring .env folder settings)
 * 3. Set THEIA_CONFIG_DIR to redirect all Theia settings to ~/.aroma
 * 4. Create the required folder structure
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const dotenv = require('dotenv');

class AppSetup {
    constructor() {
        this._env = { ...process.env };
    }

    loadEnvironment() {
        const envPath = path.resolve(__dirname, '..', '.env');
        console.log(`[AppSetup] Loading environment from: ${envPath}`);

        const result = dotenv.config({ path: envPath });

        if (result.error) {
            console.warn(`[AppSetup] Warning: No .env file found at ${envPath}`);
        } else if (result.parsed) {
            // Load variables (like CEDAR_API_KEY)
            this._env = { ...this._env, ...result.parsed };
            console.log('[AppSetup] Environment variables loaded.');
        }
    }

    initializeFileSystem() {
        // 1. CONFIGURATION
        const FOLDER_NAME = '.aroma'; 
        const userHome = os.homedir();
        const aromaRootPath = path.join(userHome, FOLDER_NAME);
        const schemasRoot = path.join(aromaRootPath, 'metadata-schemas');

        // 2. Define Subdirectories
        const paths = {
            root: aromaRootPath,
            schemas: schemasRoot,
            
            cedarRoot: path.join(schemasRoot, 'cedar'),
            cedarLocal: path.join(schemasRoot, 'cedar', 'local'),
            cedarRemote: path.join(schemasRoot, 'cedar', 'remote'),

            roCrateRoot: path.join(schemasRoot, 'ro-crate'),
            roCrateLocal: path.join(schemasRoot, 'ro-crate', 'local'),
            roCrateRemote: path.join(schemasRoot, 'ro-crate', 'remote'),
        };

        console.log(`[AppSetup] Enforcing root directory: ${paths.root}`);

        // 3. Create Directories
        try {
            Object.values(paths).forEach(dirPath => {
                if (!fs.existsSync(dirPath)) {
                    console.log(`[AppSetup] Creating directory: ${dirPath}`);
                    fs.mkdirSync(dirPath, { recursive: true });
                }
            });
            console.log('[AppSetup] Filesystem verified.');
        } catch (error) {
            console.error('[AppSetup] FATAL: Failed to create application directories.', error);
            process.exit(1);
        }

        // 4. Force Environment Overrides       
        this._env.AROMA_ROOT_PATH = paths.root; // Used by your Widget
        this._env.THEIA_CONFIG_DIR = paths.root; // Used by Theia (Settings, Logs, etc.)

        console.log(`[AppSetup] Configuration locked: THEIA_CONFIG_DIR=${paths.root}`);
    }

    getEnv() {
        return this._env;
    }
}

module.exports = AppSetup;