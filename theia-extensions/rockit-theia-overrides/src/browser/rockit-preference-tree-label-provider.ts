import { nls } from '@theia/core'
import { PreferenceTreeLabelProvider } from '@theia/preferences/lib/browser/util/preference-tree-label-provider'
import { injectable } from '@theia/core/shared/inversify'

/** Localizes labels that Theia derives from preference identifiers. */
@injectable()
export class RockitPreferenceTreeLabelProvider extends PreferenceTreeLabelProvider {
  override formatString(value: string): string {
    return nls.localize(
      `rockit/settings/identifier/${value}`,
      super.formatString(value),
    )
  }
}
