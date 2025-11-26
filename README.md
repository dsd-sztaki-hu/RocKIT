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

*or* watch only specific packages with

    cd 
    yarn watch

and the Electron example.

    cd electron-app
    yarn watch

Run the example as [described above](#Running-the-Electron-example)