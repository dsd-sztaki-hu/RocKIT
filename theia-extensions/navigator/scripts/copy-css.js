const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src');
const libDir = path.join(__dirname, '../lib');

// Function to recursively copy all CSS files
function copyCssFiles(dir) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            copyCssFiles(filePath);
        } else if (path.extname(file) === '.css') {
            const relativePath = path.relative(srcDir, filePath);
            const destPath = path.join(libDir, relativePath);

            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            fs.copyFileSync(filePath, destPath);
            console.log(`Copied ${relativePath} to lib/`);
        }
    });
}

if (fs.existsSync(srcDir)) {
    copyCssFiles(srcDir);
} else {
    console.error('Source directory does not exist');
}