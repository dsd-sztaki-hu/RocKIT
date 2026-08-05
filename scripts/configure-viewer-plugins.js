#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const customEditorPluginIds = [
  'vscode.media-preview',
  'tomoki1207.pdf',
]
const pluginsRoot = path.resolve(__dirname, '..', 'plugins')

function readManifest(pluginId) {
  const manifestPath = path.join(pluginsRoot, pluginId, 'extension', 'package.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Viewer plugin manifest is missing: ${manifestPath}`)
  }
  return {
    manifestPath,
    manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function mergePluginMessages(pluginId, locale, messages) {
  const suffix = locale ? `.${locale}` : ''
  const messagesPath = path.join(
    pluginsRoot,
    pluginId,
    'extension',
    `package.nls${suffix}.json`,
  )
  const existing = fs.existsSync(messagesPath)
    ? JSON.parse(fs.readFileSync(messagesPath, 'utf8'))
    : {}
  writeJson(messagesPath, { ...existing, ...messages })
}

for (const pluginId of customEditorPluginIds) {
  const { manifestPath, manifest } = readManifest(pluginId)
  const customEditors = manifest.contributes?.customEditors
  if (!Array.isArray(customEditors) || customEditors.length === 0) {
    throw new Error(`Viewer plugin does not contribute custom editors: ${pluginId}`)
  }

  for (const editor of customEditors) {
    editor.priority = 'default'
  }

  writeJson(manifestPath, manifest)
  console.log(`Configured ${pluginId} as the default editor for supported files.`)
}

const { manifestPath: mediaManifestPath, manifest: mediaManifest } = readManifest(
  'vscode.media-preview',
)
mediaManifest.displayName = '%displayName%'
for (const command of mediaManifest.contributes?.commands ?? []) {
  command.category = '%command.category%'
}
if (mediaManifest.contributes?.configuration) {
  mediaManifest.contributes.configuration.title = '%configuration.title%'
}
writeJson(mediaManifestPath, mediaManifest)
mergePluginMessages('vscode.media-preview', '', {
  'command.category': 'Image Preview',
  'configuration.title': 'Media Previewer',
})
mergePluginMessages('vscode.media-preview', 'hu', {
  displayName: 'Média-előnézet',
  description: 'Beépített előnézet képekhez, hang- és videófájlokhoz',
  'customEditor.audioPreview.displayName': 'Hang előnézete',
  'customEditor.imagePreview.displayName': 'Kép előnézete',
  'customEditor.videoPreview.displayName': 'Videó előnézete',
  videoPreviewerAutoPlay: 'A videók automatikus lejátszása némítva.',
  videoPreviewerLoop: 'A videók ismételt lejátszása.',
  'command.category': 'Képelőnézet',
  'command.zoomIn': 'Nagyítás',
  'command.zoomOut': 'Kicsinyítés',
  'command.copyImage': 'Kép másolása',
  'configuration.title': 'Média-előnézet',
})

const { manifestPath: pdfManifestPath, manifest: pdfManifest } = readManifest(
  'tomoki1207.pdf',
)
pdfManifest.displayName = '%extension.displayName%'
pdfManifest.description = '%extension.description%'
for (const editor of pdfManifest.contributes?.customEditors ?? []) {
  editor.displayName = '%customEditor.pdfPreview.displayName%'
}
writeJson(pdfManifestPath, pdfManifest)
mergePluginMessages('tomoki1207.pdf', '', {
  'extension.displayName': 'PDF Preview',
  'extension.description': 'Displays PDF files in the editor.',
  'customEditor.pdfPreview.displayName': 'PDF Preview',
})
mergePluginMessages('tomoki1207.pdf', 'hu', {
  'extension.displayName': 'PDF-előnézet',
  'extension.description': 'PDF-fájlok megjelenítése a szerkesztőben.',
  'customEditor.pdfPreview.displayName': 'PDF előnézete',
})

const { manifestPath: csvManifestPath, manifest: csvManifest } = readManifest(
  'janisdd.vscode-edit-csv',
)
csvManifest.displayName = '%extension.displayName%'
csvManifest.description = '%extension.description%'
const csvCommandMessageKeys = {
  'edit-csv.edit': 'command.edit.title',
  'edit-csv.goto-source': 'command.gotoSource.title',
  'edit-csv.apply': 'command.apply.title',
  'edit-csv.applyAndSave': 'command.applyAndSave.title',
}
for (const command of csvManifest.contributes?.commands ?? []) {
  command.category = '%command.category%'
  const messageKey = csvCommandMessageKeys[command.command]
  if (messageKey) {
    command.title = `%${messageKey}%`
  }
}
writeJson(csvManifestPath, csvManifest)
mergePluginMessages('janisdd.vscode-edit-csv', '', {
  'extension.displayName': 'Edit CSV',
  'extension.description': 'Edit CSV files with a table UI.',
  'command.category': 'CSV',
  'command.edit.title': 'Edit CSV',
  'command.gotoSource.title': 'Go to CSV source file',
  'command.apply.title': 'Apply changes to source file',
  'command.applyAndSave.title': 'Apply changes to source file and save',
})
mergePluginMessages('janisdd.vscode-edit-csv', 'hu', {
  'extension.displayName': 'CSV szerkesztése',
  'extension.description': 'CSV-fájlok szerkesztése táblázatos felületen.',
  'command.category': 'CSV',
  'command.edit.title': 'CSV szerkesztése',
  'command.gotoSource.title': 'Ugrás a CSV-forrásfájlhoz',
  'command.apply.title': 'Módosítások alkalmazása a forrásfájlra',
  'command.applyAndSave.title': 'Módosítások alkalmazása és a forrásfájl mentése',
})
console.log('Added Hungarian menu labels for the media, PDF, and CSV plugins.')

const videoPreviewCssPath = path.join(
  pluginsRoot,
  'vscode.media-preview',
  'extension',
  'media',
  'videoPreview.css',
)
const videoFitMarker = '/* RocKIT: keep video previews contained in the editor pane. */'
const videoFitCss = `${videoFitMarker}
body video {
	display: block;
	width: auto;
	height: auto;
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
}`

if (!fs.existsSync(videoPreviewCssPath)) {
  throw new Error(`Video preview stylesheet is missing: ${videoPreviewCssPath}`)
}

const videoPreviewCss = fs.readFileSync(videoPreviewCssPath, 'utf8')
if (!videoPreviewCss.includes(videoFitMarker)) {
  fs.writeFileSync(videoPreviewCssPath, `${videoPreviewCss.trimEnd()}\n\n${videoFitCss}\n`)
}
console.log('Configured video previews to fit inside the editor pane.')

const csvEditorRoot = path.join(
  pluginsRoot,
  'janisdd.vscode-edit-csv',
  'extension',
)
const csvEditorCssPath = path.join(csvEditorRoot, 'csvEditorHtml', 'main.css')
const csvEditorUiPath = path.join(csvEditorRoot, 'csvEditorHtml', 'out', 'ui.js')
const csvFitMarker = '/* RocKIT: keep the CSV editor contained in the editor pane. */'
const csvFitCss = `${csvFitMarker}
html,
body,
#full-page {
	width: 100%;
	max-width: 100%;
	min-width: 0;
}

body {
	margin: 0;
}

#full-page {
	box-sizing: border-box;
}

#all-options,
#table-actions,
.side-paneled,
#csv-editor-wrapper {
	min-width: 0;
	max-width: 100%;
}

#all-options {
	overflow-x: auto;
	overflow-y: hidden;
}

.side-paneled {
	min-height: 0;
	overflow: hidden;
}

#csv-editor-wrapper {
	flex: 1 1 0;
	min-height: 0;
}

#csv-editor {
	max-width: 100%;
	max-height: 100%;
}

.table-action-buttons .separated-btns {
	flex-wrap: wrap;
	align-items: stretch;
	gap: 5px;
}

.table-action-buttons .separated-btns > button:not(:last-child) {
	margin-right: 0;
}

#status-info-wrapper {
	min-width: 0;
}`

if (!fs.existsSync(csvEditorCssPath)) {
  throw new Error(`CSV editor stylesheet is missing: ${csvEditorCssPath}`)
}

const csvEditorCss = fs.readFileSync(csvEditorCssPath, 'utf8')
if (!csvEditorCss.includes(csvFitMarker)) {
  fs.writeFileSync(csvEditorCssPath, `${csvEditorCss.trimEnd()}\n\n${csvFitCss}\n`)
}

if (!fs.existsSync(csvEditorUiPath)) {
  throw new Error(`CSV editor UI script is missing: ${csvEditorUiPath}`)
}

const csvGridSizeOriginal = `    const width = pageWrapperDivWidth;
    const height = pageWrapperDivHeight - allOptionsDivHeight - tableActionsDivHeight;`
const csvGridSizeMarker = '    // RocKIT: size the grid from its flex container, not the full webview page.'
const csvGridSizeReplacement = `${csvGridSizeMarker}
    const width = Math.max(0, csvEditorWrapper.clientWidth);
    const height = Math.max(0, csvEditorWrapper.clientHeight);`
let csvEditorUi = fs.readFileSync(csvEditorUiPath, 'utf8')
if (!csvEditorUi.includes(csvGridSizeMarker)) {
  if (!csvEditorUi.includes(csvGridSizeOriginal)) {
    throw new Error(`CSV editor sizing code has changed: ${csvEditorUiPath}`)
  }
  csvEditorUi = csvEditorUi.replace(csvGridSizeOriginal, csvGridSizeReplacement)
  fs.writeFileSync(csvEditorUiPath, csvEditorUi)
}
console.log('Configured the CSV editor to fit inside the editor pane.')
