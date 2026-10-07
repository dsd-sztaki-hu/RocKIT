# Third-Party Notices

## README Platform Icons

The Windows, Apple, and Linux platform icons in `readme-assets/icon-windows.svg`,
`readme-assets/icon-apple.svg`, and `readme-assets/icon-linux.svg` are from Font Awesome
Free 6.7.2. They are licensed under CC BY 4.0 and are copyright 2024
Fonticons, Inc. The source attribution and license links are also embedded in
each SVG file.

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

## Native and Binary Runtime Components

The following runtime components are known to include native code, downloaded
runtime binaries, or executable helper files in RocKIT Electron builds.

| Component | Version used by this workspace | Purpose in RocKIT Electron builds | License | License or notice location |
| --- | --- | --- | --- | --- |
| `electron` | 37.2.1 | Electron/Chromium desktop runtime | MIT; Chromium third-party notices | `node_modules/electron/LICENSE`; packaged Electron builds also include generated Electron/Chromium license files such as `LICENSE.electron.txt` and `LICENSES.chromium.html` |
| `@theia/ffmpeg` | 1.65.2 | Theia FFmpeg native helper used by media support | EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0 | `node_modules/@theia/ffmpeg/package.json`; Eclipse Theia license files are included with Theia packages |
| `@vscode/ripgrep` | 1.17.1 | Search backend binary used by Theia/VS Code search features | MIT | `node_modules/@vscode/ripgrep/LICENSE` |
| `node-pty` | 1.1.0-beta27 | Pseudoterminal support for integrated terminals and agent processes | MIT | `node_modules/node-pty/LICENSE`; bundled `winpty` files also carry `node_modules/node-pty/deps/winpty/LICENSE` |
| `keytar` | 7.9.0 | Native bindings for operating-system credential storage | MIT | `node_modules/keytar/LICENSE.md` |
| `@anthropic-ai/claude-agent-sdk` | resolved from `^0.2.111` | Optional Claude agent SDK integration used by RocKIT agent launcher | See package license | `node_modules/@anthropic-ai/claude-agent-sdk/LICENSE.md` and `README.md` |
| `@anthropic-ai/claude-agent-sdk-*` platform package | matching installed SDK version | Platform-specific Claude executable packaged with the SDK when installed for the target platform | See package license | `node_modules/@anthropic-ai/claude-agent-sdk-*/LICENSE.md` |

RocKIT build scripts prepare some of these components before packaging:

- `scripts/ensure-electron-runtime.js` checks or installs the Electron runtime,
  the `@vscode/ripgrep` binary, and the Theia FFmpeg native helper;
- `scripts/copy-node-pty-agent.js` stages `node-pty` helper binaries under
  `electron-app/lib/build/Release/` so they can be executed from packaged
  builds;
- `scripts/fetch-darwin-native.js` prepares single-architecture macOS runtime
  packages and may fetch platform-specific runtime binaries for macOS builds.

The Electron package configuration keeps required native runtime files outside
`app.asar` using `asarUnpack`, because executable helper files and native addons
must be available as real files at runtime.
