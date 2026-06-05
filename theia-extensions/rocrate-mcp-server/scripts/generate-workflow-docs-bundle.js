const fs = require('fs')
const path = require('path')

const docsDir = path.join(__dirname, '../workflow-docs')
const outPath = path.join(__dirname, '../src/server/workflow-docs-bundle.ts')

function escapeTemplateLiteral(input) {
  return input.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

function normalizeLineEndings(input) {
  return input.replace(/\r\n/g, '\n')
}

if (!fs.existsSync(docsDir)) {
  throw new Error(`Workflow docs directory not found: ${docsDir}`)
}

const entries = fs
  .readdirSync(docsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))

if (!entries.includes('rocrate_workflow.md')) {
  throw new Error('Workflow docs must include rocrate_workflow.md')
}

const orderedEntries = [
  'rocrate_workflow.md',
  ...entries.filter((entry) => entry !== 'rocrate_workflow.md'),
]

const docsObjectContent = orderedEntries
  .map((name) => {
    const fullPath = path.join(docsDir, name)
    const raw = normalizeLineEndings(fs.readFileSync(fullPath, 'utf8'))
    return `  '${name}': \`${escapeTemplateLiteral(raw)}\``
  })
  .join(',\n')

const content = [
  '// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.',
  '// Source: workflow-docs/*.md',
  '',
  "export const DEFAULT_WORKFLOW_DOC = 'rocrate_workflow.md'",
  '',
  'export const WORKFLOW_DOCS_BUNDLE: Record<string, string> = {',
  docsObjectContent,
  '}',
  '',
].join('\n')

fs.writeFileSync(outPath, content, 'utf8')
console.log(
  `Generated ${path.relative(path.join(__dirname, '..'), outPath)} from workflow-docs`,
)
