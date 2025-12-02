#!/usr/bin/env node

/**
 * env-config.js
 *
 * Manages environment variable configuration with getter-setter pairs.
 * This allows easy extension for additional environment variables.
 */

const path = require('path');
const os = require('os');

class EnvConfig {
    constructor() {
        this._env = { ...process.env };
    }

    /**
     * Get the current THEIA_CONFIG_DIR value
     * @returns {string} The THEIA_CONFIG_DIR path
     */
    getTheiaConfigDir() {
        return this._env.THEIA_CONFIG_DIR || path.join(os.homedir(), '.aroma');
    }

    /**
     * Set THEIA_CONFIG_DIR to a specific path
     * @param {string} dirPath - The directory path to set
     */
    setTheiaConfigDir(dirPath) {
        this._env.THEIA_CONFIG_DIR = dirPath;
        console.log(`Setting THEIA_CONFIG_DIR to: ${dirPath}`);
    }

    /**
     * Set THEIA_CONFIG_DIR to the default ~/.aroma directory
     */
    setDefaultTheiaConfigDir() {
        const defaultDir = path.join(os.homedir(), '.aroma');
        this.setTheiaConfigDir(defaultDir);
    }

    // Example of how to add more environment variables:
    // 
    // getMyCustomVar() {
    //     return this._env.MY_CUSTOM_VAR || 'default-value';
    // }
    //
    // setMyCustomVar(value) {
    //     this._env.MY_CUSTOM_VAR = value;
    //     console.log(`Setting MY_CUSTOM_VAR to: ${value}`);
    // }

    /**
     * Get the complete environment object with all configured variables
     * @returns {Object} The environment variables object
     */
    getEnv() {
        return this._env;
    }
}

module.exports = EnvConfig;