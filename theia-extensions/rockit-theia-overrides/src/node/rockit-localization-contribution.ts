import {
  LocalizationContribution,
  LocalizationRegistry,
} from '@theia/core/lib/node/i18n/localization-contribution'
import { injectable } from '@theia/core/shared/inversify'

/**
 * Marks Hungarian as a complete, installed display language.
 *
 * Theia contributes its framework translations separately. Declaring this
 * language-pack entry makes those translations available through the standard
 * "Configure Display Language" flow without requiring users to install a
 * VS Code extension in the packaged desktop application.
 */
@injectable()
export class RockitLocalizationContribution
  implements LocalizationContribution
{
  async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
    // The Settings editor and several workbench widgets reuse VS Code NLS keys.
    // Load the compatible upstream catalog first, then apply RockIT's wording.
    registry.registerLocalizationFromRequire(
      'hu',
      require('../../i18n/vscode.hu.json'),
    )
    registry.registerLocalizationFromRequire({
      languageId: 'hu',
      languageName: 'Hungarian',
      localizedLanguageName: 'Magyar',
      languagePack: true,
    }, require('../../i18n/nls.hu.json'))
  }
}
