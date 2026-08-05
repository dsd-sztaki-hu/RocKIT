#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const customEditorPluginIds = [
  'vscode.media-preview',
  'tomoki1207.pdf',
]
const pluginsRoot = path.resolve(__dirname, '..', 'plugins')

for (const pluginId of customEditorPluginIds) {
  const manifestPath = path.join(pluginsRoot, pluginId, 'extension', 'package.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Viewer plugin manifest is missing: ${manifestPath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const customEditors = manifest.contributes?.customEditors
  if (!Array.isArray(customEditors) || customEditors.length === 0) {
    throw new Error(`Viewer plugin does not contribute custom editors: ${pluginId}`)
  }

  for (const editor of customEditors) {
    editor.priority = 'default'
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Configured ${pluginId} as the default editor for supported files.`)
}

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
