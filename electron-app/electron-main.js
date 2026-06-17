const { app } = require('electron');

const memoryLimit = process.env.ROCKIT_MEMORY_LIMIT_MB || process.env.AROMA_MEMORY_LIMIT_MB;
if (memoryLimit) {
    app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${memoryLimit}`);
}

require('./lib/backend/electron-main.js');
