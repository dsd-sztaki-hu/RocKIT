# Third-Party Notices

RocKIT Electron application distributions bundle third-party runtime
components. This file records the external VS Code/OpenVSX plugins that are
downloaded during the build and copied into the packaged Electron application.

The plugins are configured in the root `package.json` under `theiaPlugins` and
are downloaded with `yarn download:plugins`. The Electron package copies the
resulting `plugins/` directory into the application resources.

## Bundled VS Code/OpenVSX Plugins

| Plugin | Version | Publisher | Source | License | Bundled license location |
| --- | --- | --- | --- | --- | --- |
| `vscode.media-preview` | 1.95.3 | `vscode` | `https://open-vsx.org/api/vscode/media-preview/1.95.3/file/vscode.media-preview-1.95.3.vsix` | MIT | `plugins/vscode.media-preview/extension/LICENSE-vscode.txt` |
| `vscode.json` | 1.95.3 | `vscode` | `https://open-vsx.org/api/vscode/json/1.95.3/file/vscode.json-1.95.3.vsix` | MIT | `plugins/vscode.json/extension/LICENSE-vscode.txt` |
| `vscode.json-language-features` | 1.95.3 | `vscode` | `https://open-vsx.org/api/vscode/json-language-features/1.95.3/file/vscode.json-language-features-1.95.3.vsix` | MIT | `plugins/vscode.json-language-features/extension/LICENSE-vscode.txt` |
| `tomoki1207.pdf` | 1.2.2 | `tomoki1207` | `https://open-vsx.org/api/tomoki1207/pdf/1.2.2/file/tomoki1207.pdf-1.2.2.vsix` | MIT; includes PDF.js and font/cmap license files | `plugins/tomoki1207.pdf/extension/LICENSE.txt`; `plugins/tomoki1207.pdf/extension/lib/LICENSE`; `plugins/tomoki1207.pdf/extension/lib/web/cmaps/LICENSE`; `plugins/tomoki1207.pdf/extension/lib/web/standard_fonts/LICENSE_FOXIT`; `plugins/tomoki1207.pdf/extension/lib/web/standard_fonts/LICENSE_LIBERATION` |
| `janisdd.vscode-edit-csv` | 0.11.9 | `janisdd` | `https://open-vsx.org/api/janisdd/vscode-edit-csv/0.11.9/file/janisdd.vscode-edit-csv-0.11.9.vsix` | MIT; includes third-party component license files | `plugins/janisdd.vscode-edit-csv/extension/LICENSE.txt`; `plugins/janisdd.vscode-edit-csv/extension/thirdParty/*/LICENSE*` |

## RocKIT Packaging-Time Modifications

RocKIT applies packaging-time adjustments to the downloaded plugins in
`scripts/configure-viewer-plugins.js` before they are bundled:

- media, PDF, and CSV custom editors are configured as default editors for
  their supported file types;
- English and Hungarian display labels are added or normalized;
- media preview sizing is adjusted so video previews fit inside RocKIT editor
  panes;
- CSV editor layout and sizing are adjusted so the table editor fits inside
  RocKIT editor panes.

These modifications do not change the license terms of the upstream plugins.
The modified plugins remain third-party components bundled with RocKIT.

## Additional Runtime Components

The Electron distribution also includes third-party runtime components from
Electron, Chromium, Eclipse Theia, Monaco Editor, Node.js packages, and native
helper binaries. Their license texts and notices are included in the packaged
application through their corresponding package metadata or generated Electron
license files.
