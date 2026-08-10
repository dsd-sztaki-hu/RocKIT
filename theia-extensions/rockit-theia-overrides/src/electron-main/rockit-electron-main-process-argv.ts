import { dirname, resolve } from 'node:path'
import { ElectronMainProcessArgv } from '@theia/core/lib/electron-main/electron-main-application'
import { injectable } from '@theia/core/shared/inversify'

const PLUGINS_OPTION = '--plugins'

/**
 * Makes RocKIT's bundled VS Code extensions available to both development and
 * packaged Electron launches. In development THEIA_APP_PROJECT_PATH points at
 * electron-app; in a packaged build it points at resources/app.asar. The
 * shared plugins directory is a sibling in both layouts.
 */
@injectable()
export class RockitElectronMainProcessArgv extends ElectronMainProcessArgv {
  override getProcessArgvWithoutBin(argv = process.argv): string[] {
    const args = super.getProcessArgvWithoutBin(argv)
    if (
      args.some((arg) => arg === PLUGINS_OPTION || arg.startsWith(`${PLUGINS_OPTION}=`))
    ) {
      return args
    }

    const appProjectPath = process.env.THEIA_APP_PROJECT_PATH
    if (!appProjectPath) {
      return args
    }

    const pluginsPath = resolve(dirname(appProjectPath), 'plugins')
    return [...args, `${PLUGINS_OPTION}=local-dir:${pluginsPath}`]
  }
}
