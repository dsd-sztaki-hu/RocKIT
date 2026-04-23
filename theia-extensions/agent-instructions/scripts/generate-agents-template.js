const fs = require('fs')
const path = require('path')

const templatePath = path.join(__dirname, '../AGENTS.template.md')
const outPath = path.join(__dirname, '../src/electron-browser/agents-template.ts')

function escapeTemplateLiteral(input) {
  return input.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

function normalizeLineEndings(input) {
  return input.replace(/\r\n/g, '\n')
}

if (!fs.existsSync(templatePath)) {
  throw new Error(`AGENTS template file not found: ${templatePath}`)
}

const raw = normalizeLineEndings(fs.readFileSync(templatePath, 'utf8'))
const content = [
  '// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.',
  '// Source: AGENTS.template.md',
  '',
  `export const AGENTS_TEMPLATE = \`${escapeTemplateLiteral(raw)}\`;`,
  '',
].join('\n')

fs.writeFileSync(outPath, content, 'utf8')
console.log(
  `Generated ${path.relative(path.join(__dirname, '..'), outPath)} from AGENTS.template.md`,
)
