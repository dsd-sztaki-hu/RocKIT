import {
  PreferenceContribution,
  PreferenceSchema,
} from '@theia/core'
import { nls } from '@theia/core/lib/common/nls'
import { interfaces } from '@theia/core/shared/inversify'

export const AROMA_SPLASH_SHOW_AT_STARTUP = 'rockit.splash.showAtStartup'

export const RockitSplashConfigSchema: PreferenceSchema = {
  properties: {
    [AROMA_SPLASH_SHOW_AT_STARTUP]: {
      type: 'boolean',
      default: true,
      description: nls.localizeByDefault(
        'Controls whether the RocKIT splash screen is shown at application startup.',
      ),
    },
  },
}

export const RockitSplashPreferenceContribution = Symbol(
  'RockitSplashPreferenceContribution',
)

export function bindRockitSplashPreferences(bind: interfaces.Bind): void {
  bind(RockitSplashPreferenceContribution).toConstantValue({
    schema: RockitSplashConfigSchema,
  })
  bind(PreferenceContribution).toService(RockitSplashPreferenceContribution)
}
