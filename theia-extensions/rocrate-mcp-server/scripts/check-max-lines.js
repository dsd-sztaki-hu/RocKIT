#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const srcRoot = path.join(projectRoot, 'src')
const maxLines = Number(process.env.ROCRATE_MAX_TS_LINES || '5000')

function collectTsFiles(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'dashboard' && fullPath.includes(`${path.sep}static`)) {
        continue
      }
      collectTsFiles(fullPath, acc)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      acc.push(fullPath)
    }
  }
  return acc
}

const offenders = []
for (const file of collectTsFiles(srcRoot)) {
  const lineCount = fs.readFileSync(file, 'utf8').split('\n').length
  if (lineCount > maxLines) {
    offenders.push({
      file: path.relative(projectRoot, file),
      lineCount,
    })
  }
}

if (offenders.length > 0) {
  console.error(`Files exceeding max line limit (${maxLines}):`)
  for (const offender of offenders) {
    console.error(`- ${offender.file}: ${offender.lineCount}`)
  }
  process.exit(1)
}

console.log(`Max-lines check passed (limit=${maxLines}).`)
