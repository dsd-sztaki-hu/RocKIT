// scripts/clean-build.js
const fs = require('fs');
const path = require('path');

// 1. Define paths
// Adjust '..' if this script is not inside a 'scripts' subfolder
const rootDir = path.resolve(__dirname, '..'); 

const extensionDir = path.join(rootDir, 'theia-extensions');
const appDirs = [
    path.join(rootDir, 'browser-app'),
    path.join(rootDir, 'electron-app')
];

// Folders to delete at the ROOT level
const rootFoldersToDelete = [
    'node_modules',
    '.browser_modules'
];

// Helper to remove a directory or file recursively
// (Using fs.rmSync for Node 14.14+, compatible with Windows/Mac/Linux)
const removePath = (targetPath) => {
    if (fs.existsSync(targetPath)) {
        try {
            console.log(`Deleting: ${targetPath}`);
            fs.rmSync(targetPath, { recursive: true, force: true });
        } catch (err) {
            console.error(`Failed to delete ${targetPath}: ${err.message}`);
        }
    }
};

console.log('--- Starting Clean Process ---');

// TASK A: Clean Root Level Folders
rootFoldersToDelete.forEach(folderName => {
    removePath(path.join(rootDir, folderName));
});

// TASK B: Clean Extensions (node_modules, lib, dist)
if (fs.existsSync(extensionDir)) {
    const extensions = fs.readdirSync(extensionDir);
    extensions.forEach(ext => {
        const extPath = path.join(extensionDir, ext);
        // Only process directories
        if (fs.statSync(extPath).isDirectory()) {
            removePath(path.join(extPath, 'node_modules'));
            removePath(path.join(extPath, 'lib'));
            removePath(path.join(extPath, 'dist'));
            removePath(path.join(extPath, 'tsconfig.tsbuildinfo'));
        }
    });
}

// TASK C: Clean App Folders (Everything except package.json)
appDirs.forEach(appDir => {
    if (fs.existsSync(appDir)) {
        const files = fs.readdirSync(appDir);
        files.forEach(file => {
            // SKIP package.json
            if (file === 'package.json') return;

            // Delete everything else
            removePath(path.join(appDir, file));
        });
    }
});

console.log('--- Clean Complete ---');