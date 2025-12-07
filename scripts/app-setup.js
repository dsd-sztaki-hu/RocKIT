#!/usr/bin/env node

/**
 * app-setup.js
 * * Responsibilities:
 * 1. Load environment variables from .env
 * 2. Ensure the required folder structure exists in the User's Home Directory
 * 3. Export the prepared environment for the Electron process
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const dotenv = require('dotenv');

class AppSetup {
    constructor() {
        // Start with the current process environment
        this._env = { ...process.env };
    }

    /**
     * Load .env file from the project root
     */
    loadEnvironment() {
        const envPath = path.resolve(__dirname, '..', '.env');
        console.log(`[AppSetup] Loading environment from: ${envPath}`);

        const result = dotenv.config({ path: envPath });

        if (result.error) {
            console.warn(`[AppSetup] Warning: No .env file found at ${envPath}`);
        } else if (result.parsed) {
            // Merge parsed variables into our internal env object
            this._env = { ...this._env, ...result.parsed };
            console.log('[AppSetup] Environment variables loaded successfully.');
        }
    }

    /**
     * Ensure the .aroma folder structure exists in the User's Home Directory.
     * Sets AROMA_ROOT_PATH in the environment variables for the frontend to use.
     */
    initializeFileSystem() {
        // 1. Determine Root Path
        // Uses the name from .env (AROMA_FOLDER_NAME) or defaults to '.aroma'
        const folderName = this._env.AROMA_FOLDER_NAME || '.aroma';
        const userHome = os.homedir();
        const aromaRootPath = path.join(userHome, folderName);

        // 2. Define Subdirectories
        const paths = {
            root: aromaRootPath,
            schemas: path.join(aromaRootPath, 'metadata-schemas'),
            local: path.join(aromaRootPath, 'metadata-schemas', 'local'),
            remote: path.join(aromaRootPath, 'metadata-schemas', 'remote')
        };

        console.log(`[AppSetup] Verifying filesystem structure at: ${paths.root}`);

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
            process.exit(1); // Exit if we can't create necessary folders
        }

        // 4. Inject the calculated root path into the environment
        // This is crucial: The frontend widget will read this variable to know where to look.
        this._env.AROMA_ROOT_PATH = paths.root;
        console.log(`[AppSetup] Injected AROMA_ROOT_PATH=${paths.root}`);
    }

    /**
     * Returns the final environment object to be passed to Electron
     */
    getEnv() {
        return this._env;
    }
}

module.exports = AppSetup;