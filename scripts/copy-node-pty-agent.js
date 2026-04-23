const fs = require('fs')
const path = require('path')

const workspaceRoot = path.resolve(__dirname, '..')
const appRoot = path.join(workspaceRoot, 'electron-app')
const nodePtyRoot = path.join(workspaceRoot, 'node_modules', 'node-pty')
const sourceDir = path.join(nodePtyRoot, 'lib')
const targetDir = path.join(appRoot, 'lib', 'backend')
const releaseSourceDir = path.join(nodePtyRoot, 'build', 'Release')
const releaseTargetDir = path.join(appRoot, 'lib', 'build', 'Release')

fs.mkdirSync(targetDir, { recursive: true })

for (const file of ['conpty_console_list_agent.js', 'conpty_console_list_agent.js.map']) {
  const source = path.join(sourceDir, file)
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(targetDir, file))
  }
}

fs.mkdirSync(releaseTargetDir, { recursive: true })

for (const file of ['conpty_console_list.node']) {
  const source = path.join(releaseSourceDir, file)
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(releaseTargetDir, file))
  }
}
