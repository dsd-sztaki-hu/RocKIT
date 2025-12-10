#!/usr/bin/env node

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
            this._env = { ...this._env, ...result.parsed };
            console.log('[AppSetup] Environment variables loaded successfully.');
        }
    }

    initializeFileSystem() {
        const folderName = this._env.AROMA_FOLDER_NAME || '.aroma';
        const userHome = os.homedir();
        const aromaRootPath = path.join(userHome, folderName);
        const schemasRoot = path.join(aromaRootPath, 'metadata-schemas');

        // Expected directory structure:
        // $HOME/.aroma/metadata-schemas/
        // ├── cedar/           <-- Raw CEDAR templates
        // │   ├── local/
        // │   └── remote/
        // └── ro-crate/        <-- Converted RO-Crate profiles
        //     ├── local/
        //     └── remote/

        const paths = {
            root: aromaRootPath,
            schemas: schemasRoot,
            
            // CEDAR Folders (Raw inputs)
            cedarRoot: path.join(schemasRoot, 'cedar'),
            cedarLocal: path.join(schemasRoot, 'cedar', 'local'),
            cedarRemote: path.join(schemasRoot, 'cedar', 'remote'),

            // RO-Crate Folders (Converted outputs)
            roCrateRoot: path.join(schemasRoot, 'ro-crate'),
            roCrateLocal: path.join(schemasRoot, 'ro-crate', 'local'),
            roCrateRemote: path.join(schemasRoot, 'ro-crate', 'remote'),
        };

        console.log(`[AppSetup] Verifying filesystem structure at: ${paths.root}`);

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

        this._env.AROMA_ROOT_PATH = paths.root;
        console.log(`[AppSetup] Injected AROMA_ROOT_PATH=${paths.root}`);
    }

    getEnv() {
        return this._env;
    }
}

module.exports = AppSetup;