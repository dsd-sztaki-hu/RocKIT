#!/usr/bin/env node

/**
 * app-setup.js
 * Responsibilities:
 * 1. Centralize Application Configuration (Folder names, File names, Service IDs).
 * 2. Perform pre-start maintenance (Orphaned API Key Cleanup).
 * 3. Set Environment Variables for the Theia Backend.
 * 4. Create required folder structure and base files.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// --- CENTRALIZED CONFIGURATION ---
const APP_FOLDER_NAME = '.rockit';

// Feature: Metadata Schema Index
const METADATA_SCHEMA_INDEX_FILENAME = 'metadata-schema-index.json';

// Feature: Remote Schema Provider
const REMOTE_SCHEMA_PROVIDER_CONFIG_FILENAME = 'remote-schema-providers.json';
const REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE = 'RocKIT.RemoteSchemaProvider';

// Feature: Data Repository
const DATA_REPOSITORY_CONFIG_FILENAME = 'data-repositories.json';
const DATA_REPOSITORY_KEYTAR_SERVICE = 'RocKIT.DataRepository';

class AppSetup {
    constructor() {
        this._env = { ...process.env };
    }

    /**
     * Cleans up API keys stored in the OS Keychain that no longer have 
     * a corresponding entry in the JSON config files.
     */
    async cleanOrphanedApiKeys() {
        console.log('[AppSetup] Checking for orphaned API keys...');
        
        try {
            const keytar = require('keytar');
            
            // Clean up Remote Schema Providers
            await this._cleanServiceKeys(keytar, REMOTE_SCHEMA_PROVIDER_CONFIG_FILENAME, REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE);
            
            // Clean up Data Repositories
            await this._cleanServiceKeys(keytar, DATA_REPOSITORY_CONFIG_FILENAME, DATA_REPOSITORY_KEYTAR_SERVICE);
            
            console.log('[AppSetup] Orphaned key check complete.');
        } catch (error) {
            if (error.code === 'MODULE_NOT_FOUND') {
                console.warn('[AppSetup] "keytar" module not found. Skipping cleanup.');
            } else {
                console.warn('[AppSetup] Skipped orphaned key cleanup (Native module mismatch or error):', error.message);
            }
        }
    }

    /**
     * Reusable helper to compare a JSON config file against stored keychain credentials
     */
    async _cleanServiceKeys(keytar, configFilename, serviceName) {
        const userHome = os.homedir();
        const configPath = path.join(userHome, APP_FOLDER_NAME, configFilename);
        
        let activeIds = [];

        // Read Active IDs from JSON
        if (fs.existsSync(configPath)) {
            try {
                const content = fs.readFileSync(configPath, 'utf8');
                const json = JSON.parse(content);
                if (Array.isArray(json)) {
                    activeIds = json.map(c => c.id);
                }
            } catch (e) {
                console.warn(`[AppSetup] Failed to read ${configFilename} for cleanup:`, e.message);
            }
        }

        // Compare with Keychain
        const credentials = await keytar.findCredentials(serviceName);
        for (const cred of credentials) {
            if (!activeIds.includes(cred.account)) {
                console.log(`[AppSetup] Deleting orphaned key for ID: ${cred.account} (Service: ${serviceName})`);
                await keytar.deletePassword(serviceName, cred.account);
            }
        }
    }

    initializeFileSystem() {
        // 1. Resolve Paths
        const userHome = os.homedir();
        const rockitRootPath = path.join(userHome, APP_FOLDER_NAME);
        const schemasRoot = path.join(rockitRootPath, 'metadata-schemas');

        const paths = {
            root: rockitRootPath,
            schemas: schemasRoot,
            cedarRoot: path.join(schemasRoot, 'cedar'),
            roCrateRoot: path.join(schemasRoot, 'ro-crate'),
            schemaIndex: path.join(rockitRootPath, METADATA_SCHEMA_INDEX_FILENAME)
        };

        console.log(`[AppSetup] Enforcing root directory: ${paths.root}`);

        // 2. Create Directories & Base Files
        try {
            if (!fs.existsSync(paths.root)) fs.mkdirSync(paths.root, { recursive: true });
            if (!fs.existsSync(paths.schemas)) fs.mkdirSync(paths.schemas, { recursive: true });
            
            if (!fs.existsSync(paths.cedarRoot)) fs.mkdirSync(paths.cedarRoot, { recursive: true });
            if (!fs.existsSync(paths.roCrateRoot)) fs.mkdirSync(paths.roCrateRoot, { recursive: true });

            // Seed the central schema index file if it doesn't exist
            if (!fs.existsSync(paths.schemaIndex)) {
                const defaultIndex = {
                    profiles: [],
                    conformsToIndex: {}
                };
                fs.writeFileSync(paths.schemaIndex, JSON.stringify(defaultIndex, null, 4), 'utf8');
                console.log(`[AppSetup] Initialized empty schema index at: ${METADATA_SCHEMA_INDEX_FILENAME}`);
            }

            console.log('[AppSetup] Filesystem verified.');
        } catch (error) {
            console.error('[AppSetup] FATAL: Failed to create application directories or files.', error);
            process.exit(1);
        }

        // 3. Set Environment Variables
        this._env.ROCKIT_ROOT_PATH = paths.root;
        this._env.AROMA_ROOT_PATH = paths.root; 
        this._env.THEIA_CONFIG_DIR = paths.root;
        
        // Metadata Schema Env Vars
        this._env.ROCKIT_METADATA_SCHEMA_INDEX_FILE = METADATA_SCHEMA_INDEX_FILENAME;
        this._env.AROMA_METADATA_SCHEMA_INDEX_FILE = METADATA_SCHEMA_INDEX_FILENAME;

        // Remote Schema Provider Env Vars
        this._env.ROCKIT_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE = REMOTE_SCHEMA_PROVIDER_CONFIG_FILENAME;
        this._env.ROCKIT_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE = REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE;
        this._env.AROMA_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE = REMOTE_SCHEMA_PROVIDER_CONFIG_FILENAME;
        this._env.AROMA_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE = REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE;

        // Data Repository Env Vars
        this._env.ROCKIT_DATA_REPOSITORY_CONFIG_FILE = DATA_REPOSITORY_CONFIG_FILENAME;
        this._env.ROCKIT_DATA_REPOSITORY_KEYTAR_SERVICE = DATA_REPOSITORY_KEYTAR_SERVICE;
        this._env.AROMA_DATA_REPOSITORY_CONFIG_FILE = DATA_REPOSITORY_CONFIG_FILENAME;
        this._env.AROMA_DATA_REPOSITORY_KEYTAR_SERVICE = DATA_REPOSITORY_KEYTAR_SERVICE;

        // ARP External URI Configurations
        this._env.ARP_PROD_PREFIX = 'https://repo.schema.researchdata.hu/templates/';
        this._env.ARP_DEV_PREFIX = 'https://repo.cedardev.dsd.sztaki.hu/templates/';
        this._env.ARP_W3ID_PROD = 'https://w3id.org/arp/schema/';
        this._env.ARP_W3ID_DEV = 'https://w3id.org/arp/dev/schema/';

        console.log(`[AppSetup] Configuration locked: Root=${paths.root}`);
    }

    getEnv() {
        return this._env;
    }
}

module.exports = AppSetup;
