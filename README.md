## Getting started

Please install all necessary [prerequisites](https://github.com/eclipse-theia/theia/blob/master/doc/Developing.md#prerequisites).

## Building the application and running the Electron
1. yarn
2. yarn build:browser
3. yarn build:electron
4. yarn start:electron


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