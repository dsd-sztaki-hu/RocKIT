const fs = require('fs')
const path = require('path')

const files = ['native-agent-chat.css']
const sourceDir = path.join(__dirname, '..', 'src', 'electron-browser')
const targetDir = path.join(__dirname, '..', 'lib', 'electron-browser')

fs.mkdirSync(targetDir, { recursive: true })
for (const file of files) {
  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file))
}
