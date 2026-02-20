const fs = require('node:fs')
const path = require('node:path')

const source = path.join(__dirname, '..', 'src', 'browser', 'app-state-panel-widget.css')
const targetDir = path.join(__dirname, '..', 'lib', 'browser')
const target = path.join(targetDir, 'app-state-panel-widget.css')

fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, target)
