// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

const fs = require('fs')
const path = require('path')
const postcss = require('postcss')
const selectorParser = require('postcss-selector-parser')

const root = process.cwd()
const prefix = '.rocrate-editor .recrate-scope'

const recratePath = path.join(
  root,
  'node_modules',
  '@arpproject',
  'recrate',
  'dist',
  'recrate.css',
)

const allotmentPath = path.join(root, 'node_modules', 'allotment', 'dist', 'style.css')
const outPath = path.join(
  root,
  'theia-extensions',
  'ro-crate-editor',
  'src',
  'browser',
  'style',
  'recrate-scoped.css',
)

const recrateCss = fs.readFileSync(recratePath, 'utf8')
const allotmentCss = fs.readFileSync(allotmentPath, 'utf8')
const combinedCss = `/* Generated file: scoped RECrate + Allotment styles */\n${allotmentCss}\n${recrateCss}`

const rootNode = postcss.parse(combinedCss)

const prefixRuleSelector = (selectorText) => {
  const processor = selectorParser((selectors) => {
    selectors.each((sel) => {
      const raw = sel.toString().trim()
      if (!raw) {
        return
      }
      if (raw.includes('&')) {
        return
      }

      const lower = raw.toLowerCase()
      let scoped
      if (
        lower === ':root' ||
        lower === ':host' ||
        lower === 'html' ||
        lower === 'body' ||
        lower.startsWith(':root') ||
        lower.startsWith(':host') ||
        lower.startsWith('html') ||
        lower.startsWith('body')
      ) {
        scoped = prefix
      } else if (raw.startsWith('::')) {
        scoped = `${prefix}${raw}`
      } else {
        scoped = `${prefix} ${raw}`
      }

      const replacementRoot = selectorParser().astSync(scoped)
      const replacement = replacementRoot.first
      if (replacement) {
        sel.replaceWith(replacement)
      }
    })
  })

  return processor.processSync(selectorText)
}

rootNode.walkRules((rule) => {
  if (!rule.selector) {
    return
  }

  let parent = rule.parent
  while (parent) {
    if (
      parent.type === 'atrule' &&
      String(parent.name).toLowerCase().includes('keyframes')
    ) {
      return
    }
    parent = parent.parent
  }

  try {
    rule.selector = prefixRuleSelector(rule.selector)
  } catch (error) {
    console.warn(
      'Failed to scope selector:',
      rule.selector,
      error && error.message ? error.message : error,
    )
  }
})

const outputCss = rootNode.toString().replace(/\r\n?/g, '\n')
fs.writeFileSync(outPath, outputCss, 'utf8')
console.log('Generated:', outPath)
