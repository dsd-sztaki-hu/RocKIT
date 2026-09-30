# RocKIT

RocKIT source code is available at
<https://github.com/dsd-sztaki-hu/RocKIT>.

## Getting started

Please install all necessary [prerequisites](https://github.com/eclipse-theia/theia/blob/master/doc/Developing.md#prerequisites).

## Building the application and running the Electron
1. yarn
2. yarn build:browser
3. yarn build:electron
4. yarn start:electron

The browser and Electron build/start scripts automatically download pinned
extensions for media/PDF previews, JSON language support, and CSV/TSV editing
into the ignored `plugins/` directory. To refresh external plugins
without building the applications, run:

    yarn download:plugins

The Electron packaging configuration copies this directory beside the packaged
application so these editors are also available in release builds. A single
click opens the appropriate preview/editor automatically, including media, PDF,
and an editable CSV/TSV table UI. JSON and JSON-with-comments files receive syntax
highlighting, validation, formatting, and schema-aware completion. Double-clicking
a described file still opens its ReCrate entity editor.

React Grab is disabled by default so it does not intercept normal selection and
copy shortcuts. Developers can opt in with the
`rockit.developer.reactGrab.enabled` preference in a development build.

## Building and packaging the standalone RO-Crate MCP server

The RO-Crate MCP server can be built as a standalone npm CLI package without
building the full Electron application.

From the repo root:

    yarn build:rocrate-mcp-standalone

This creates a publishable package directory at:

    theia-extensions/rocrate-mcp-server/dist/npm

To create the npm tarball:

    yarn pack:rocrate-mcp-standalone

The tarball is written to:

    theia-extensions/rocrate-mcp-server/arpproject-vibearp-mcp-<version>.tgz

For example, if the MCP package version is `1.2.0`, install the local tarball
from the repo root with:

    npm install -g ./theia-extensions/rocrate-mcp-server/arpproject-vibearp-mcp-1.2.0.tgz

To publish the standalone MCP server to npm, publish the generated package
directory, not the raw workspace package:

    cd theia-extensions/rocrate-mcp-server/dist/npm
    npm publish --access public

After publishing, users can install and run it with:

    npm install -g @arpproject/vibearp-mcp
    rocrate-mcp-server

To install the MCP server into a detected coding agent, run:

    rocrate-mcp-server -i

Use the up/down arrows or an agent number to select the target. The installer
shows the exact MCP section and destination before confirmation; pressing Enter
accepts the default yes. To select an agent explicitly, for example:

    rocrate-mcp-server -i codex

Supported IDs are `codex`, `claude`, `opencode`, `kilo`, `roo`, `gemini`, and
`qwen`. The generated configuration connects through the shared per-user
RockIT socket at `~/.rockit/rocrate-mcp-server.sock`.

The standalone package bundles the internal workspace code needed by the MCP
server. The normal Theia/Electron build still uses the workspace package and
its `lib/` output.

### Configuring Theia backend memory

Set `ROCKIT_MEMORY_LIMIT_MB` to increase the V8 old-generation heap limit of the
Theia backend Node.js process. The value is in MiB. For example, a value of
`8192` results in a total backend V8 heap limit of approximately 8240 MiB.

This is an upper limit, not a memory reservation. The backend consumes memory
gradually as needed. When the variable is not set, the Node.js default is used.

The Electron renderer also receives the requested setting, but Electron 37
currently caps its effective JavaScript heap at approximately 3586 MiB. Setting
`ROCKIT_MEMORY_LIMIT_MB` to `8192` therefore increases the backend limit but does
not increase the renderer beyond that cap. Each process has a separate heap.

PowerShell:

    $env:ROCKIT_MEMORY_LIMIT_MB="8192"
    yarn start:electron

Command Prompt:

    set ROCKIT_MEMORY_LIMIT_MB=8192
    yarn start:electron

Linux/macOS:

    ROCKIT_MEMORY_LIMIT_MB=8192 yarn start:electron

## Working on `recrate` (vendored in `dev-packages/recrate`)

### One-time setup

If `recrate` is checked in as a git submodule, initialize it after cloning:

    git submodule update --init --recursive

Install workspace dependencies from the repo root:

    yarn

### Build / run / test `recrate`

From the repo root you can use the convenience scripts:

    yarn recrate:build
    yarn recrate:dev
    yarn recrate:test

Notes:
- `@arpproject/recrate` exports built artifacts from `dist/`, so `recrate:build` must be run at least once after fresh installs.
- Even if the upstream `recrate` project uses npm, running it via `yarn workspace` works fine in this monorepo because Yarn workspaces manage the dependencies.

### Publish a new `recrate` version to npm

Publishing is still done from inside the `recrate` package directory, but you can run it from the repo root:

    yarn recrate:publish

Typical release flow:
1. Commit and push changes in `dev-packages/recrate` to the upstream git repository.
2. Bump the version in `dev-packages/recrate/package.json`.
3. Run `yarn recrate:publish` (requires npm authentication).
4. Commit the updated submodule pointer in this repository (so this repo points at the released commit).

Authentication note:
- If your company GitLab uses AAI/SSO for the web UI, git operations typically use SSH keys or tokens. For submodules, SSH URLs are usually the most reliable.


## Developing with the Electron example

Start watching all packages, including `electron-app`, of your application with

    yarn watch:electron

and run the Electron with

    yarn start:electron

By doing this the changes are automatically reflected in the Electron window after refreshing (ctrl+r) the application.

## How to create a new extension

To create new extensions we use the [Theia generator](#https://github.com/eclipse-theia/generator-theia-extension) package, this has to be installed as a first step.
  
    npm install -g yo generator-theia-extension

Then these are the steps to create a new extension:
1. Run `yo theia-extension --skip-install`
2. Select the extension type.
3. Enter the extension name.
4. The generator will ask you a few other questions about overwriting certain files (package.json, README, etc.), press "n" for all of them.
5. The generator will create a new folder with the extension name and add some files inside.
6. Move this folder to the `theia-extensions` folder where we keep all our custom extensions.
7. Because we skipped the overwrites (it would mess up our package.json and other files), we need to add the new extension to the correct places. Open the electron-app's package.json and add the extension to the `dependencies` section by typing the extension name and version number (it can be checked in the extension's package.json, but it is generally 0.0.0 so the inserted part would look like "<extension-name>": "0.0.0"). (The nex extension does NOT have to be added to the root package.json file, because it is in the theia-extensions folder folder, and that is already added to the workspace)
8. Run `yarn` to install all dependencies.

### react-grab support

https://github.com/aidenybai/react-grab has been added via the `react-grab` extension. 

The UI part works
with cmd+c, but it doesn't collect the React specific file paths, only the
HTML selection. So, this is of minimal use for now.

## License

RocKIT is licensed under the Apache License, Version 2.0. See [LICENSE.md](LICENSE.md) for details.

Additional attribution and bundled third-party component information is available in
[NOTICE](NOTICE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
