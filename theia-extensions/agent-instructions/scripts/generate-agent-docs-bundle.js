const fs = require('fs')
const path = require('path')

const docsDir = path.join(__dirname, '../agent-docs')
const outPath = path.join(__dirname, '../src/electron-browser/agent-docs-bundle.ts')

function escapeTemplateLiteral(input) {
  return input.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

function normalizeLineEndings(input) {
  return input.replace(/\r\n/g, '\n')
}

if (!fs.existsSync(docsDir)) {
  throw new Error(`Agent docs directory not found: ${docsDir}`)
}

const entries = fs
  .readdirSync(docsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))

if (entries.length === 0) {
  throw new Error(`No markdown docs found in ${docsDir}`)
}

const docsObjectContent = entries
  .map((name) => {
    const fullPath = path.join(docsDir, name)
    const raw = normalizeLineEndings(fs.readFileSync(fullPath, 'utf8'))
    return `  '${name}': \`${escapeTemplateLiteral(raw)}\``
  })
  .join(',\n')

const content = [
  '// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.',
  '// Source: agent-docs/*.md',
  '',
  "export const AGENT_DOCS_DIR = '.rockit'",
  '',
  'export const AGENT_DOCS_BUNDLE: Record<string, string> = {',
  docsObjectContent,
  '}',
  '',
].join('\n')

fs.writeFileSync(outPath, content, 'utf8')
console.log(
  `Generated ${path.relative(path.join(__dirname, '..'), outPath)} from agent-docs`,
)
