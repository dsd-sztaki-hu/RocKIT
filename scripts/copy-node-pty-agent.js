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

// node-pty ships a `spawn-helper` (unix/mac) and `conpty_console_list.node` (Windows)
// that are exec'd at runtime, not dlopen'd. The webpack backend bundle inlines node-pty
// into lib/backend, so __dirname at runtime is lib/backend and node-pty resolves the
// helper to lib/build/Release/<file>. Stage it there so the bundled code finds it.
// These must ALSO be listed in electron-app `build.asarUnpack` (`lib/build/Release/**`),
// because execve cannot read from inside app.asar — unlike .node addons, which dlopen fine.
for (const file of ['conpty_console_list.node', 'spawn-helper']) {
  const source = path.join(releaseSourceDir, file)
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(releaseTargetDir, file))
  }
}
