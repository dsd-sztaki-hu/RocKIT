#!/usr/bin/env node
// Adds missing accessor get/set pairs for defaultAppState keys into app-state-service.ts.
// Existing accessors are preserved; nothing is removed or overwritten.

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const appStateFile = path.resolve(__dirname, '../src/browser/state/app-state.ts')
const serviceFile = path.resolve(__dirname, '../src/browser/state/app-state-service.ts')

function log(msg) {
  console.log(`[app-state:accessors ${new Date().toISOString()}] ${msg}`)
}

function getDefaultAppStateKeys() {
  const program = ts.createProgram([appStateFile], {})
  const source = program.getSourceFile(appStateFile)
  const keys = []
  ts.forEachChild(source, (node) => {
    if (!ts.isVariableStatement(node)) return
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== 'defaultAppState') continue
      const init = decl.initializer
      if (!init || !ts.isObjectLiteralExpression(init))
        throw new Error('defaultAppState must be an object literal')
      for (const prop of init.properties) {
        if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
          const name = prop.name.getText(source).replace(/^['"]|['"]$/g, '')
          keys.push(name)
        }
      }
    }
  })
  if (!keys.length) throw new Error('No keys found on defaultAppState')
  return keys
}

function getExistingAccessorNames(serviceContent) {
  const names = new Set()
  const getterRegex = /get\s+(\w+)\s*\(/g
  let m
  while ((m = getterRegex.exec(serviceContent)) !== null) {
    names.add(m[1])
  }
  return names
}

function buildAccessors(keys, indent) {
  if (!keys.length) return ''
  const body = indent + '    '
  return keys
    .map((k) =>
      [
        `${indent}get ${k}(): AppState['${k}'] {`,
        `${body}return this.getState().${k};`,
        `${indent}}`,
        `${indent}set ${k}(value: AppState['${k}']) {`,
        `${body}this.updateState({ ${k}: value });`,
        `${indent}}`,
      ].join(''),
    )
    .join('\n')
}

function injectMissing(serviceContent, missingKeys) {
  if (!missingKeys.length) return serviceContent

  // infer indent from first getter; fallback to 4 spaces
  const indentMatch = serviceContent.match(/\n(\s*)get\s+\w+/)
  const indent = indentMatch ? indentMatch[1] || '    ' : '    '

  const block = buildAccessors(missingKeys, indent) + '\n\n'

  const insertPos = serviceContent.lastIndexOf('}')
  return serviceContent.slice(0, insertPos) + block + serviceContent.slice(insertPos)
}

function runOnce() {
  const keys = getDefaultAppStateKeys()
  const serviceContent = fs.readFileSync(serviceFile, 'utf8')
  const existing = getExistingAccessorNames(serviceContent)
  const missing = keys.filter((k) => !existing.has(k))

  if (!missing.length) {
    log(`Accessors up to date (keys: ${keys.join(', ')})`)
    return
  }

  const next = injectMissing(serviceContent, missing)
  fs.writeFileSync(serviceFile, next, 'utf8')
  log(`Added missing accessors: ${missing.join(', ')}`)
}

function main() {
  const watch = process.argv.includes('--watch')
  log(`Starting accessor generation${watch ? ' (watch mode)' : ''}`)
  runOnce()
  if (watch) {
    log('Watching app-state.ts for changes...')
    fs.watch(appStateFile, { persistent: true }, () => {
      log('Change detected, regenerating...')
      try {
        runOnce()
      } catch (err) {
        log(`Accessor generation failed: ${err.message}`)
      }
    })
  }
}

main()
