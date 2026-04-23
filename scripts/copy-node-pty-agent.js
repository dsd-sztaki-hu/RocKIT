const fs = require('fs')
const path = require('path')

const workspaceRoot = path.resolve(__dirname, '..')
const appRoot = path.join(workspaceRoot, 'electron-app')
const sourceDir = path.join(workspaceRoot, 'node_modules', 'node-pty', 'lib')
const targetDir = path.join(appRoot, 'lib', 'backend')
const files = ['conpty_console_list_agent.js', 'conpty_console_list_agent.js.map']

fs.mkdirSync(targetDir, { recursive: true })

for (const file of files) {
  const source = path.join(sourceDir, file)
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(targetDir, file))
  }
}
