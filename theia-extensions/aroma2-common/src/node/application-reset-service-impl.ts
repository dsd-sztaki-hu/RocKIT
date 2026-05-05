import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { injectable } from 'inversify'
import {
  ApplicationResetResult,
  ApplicationResetService,
} from '../common/application-reset-protocol'

@injectable()
export class ApplicationResetServiceImpl implements ApplicationResetService {
  async resetApplication(): Promise<ApplicationResetResult> {
    const aromaRootPath = this.resolveAromaRootPath()
    this.assertSafeAromaRootPath(aromaRootPath)

    await fs.promises.rm(aromaRootPath, { recursive: true, force: true })

    return { aromaRootPath }
  }

  protected resolveAromaRootPath(): string {
    const configuredRoot = String(process.env.AROMA_ROOT_PATH ?? '').trim()
    if (configuredRoot) {
      return path.resolve(configuredRoot)
    }
    return path.join(os.homedir(), '.aroma')
  }

  protected assertSafeAromaRootPath(aromaRootPath: string): void {
    const normalized = path.resolve(aromaRootPath)
    if (path.basename(normalized) !== '.aroma') {
      throw new Error(`Refusing to delete non-.aroma directory: ${normalized}`)
    }

    const homeDir = path.resolve(os.homedir())
    if (path.dirname(normalized) !== homeDir) {
      throw new Error(`Refusing to delete .aroma outside the user home directory: ${normalized}`)
    }
  }

}
