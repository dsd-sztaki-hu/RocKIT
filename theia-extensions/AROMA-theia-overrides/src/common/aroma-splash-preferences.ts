import {
  PreferenceContribution,
  PreferenceSchema,
} from '@theia/core'
import { nls } from '@theia/core/lib/common/nls'
import { interfaces } from '@theia/core/shared/inversify'

export const AROMA_SPLASH_SHOW_AT_STARTUP = 'aroma.splash.showAtStartup'

export const AromaSplashConfigSchema: PreferenceSchema = {
  properties: {
    [AROMA_SPLASH_SHOW_AT_STARTUP]: {
      type: 'boolean',
      default: true,
      description: nls.localizeByDefault(
        'Controls whether the AROMA-2 splash screen is shown at application startup.',
      ),
    },
  },
}

export const AromaSplashPreferenceContribution = Symbol(
  'AromaSplashPreferenceContribution',
)

export function bindAromaSplashPreferences(bind: interfaces.Bind): void {
  bind(AromaSplashPreferenceContribution).toConstantValue({
    schema: AromaSplashConfigSchema,
  })
  bind(PreferenceContribution).toService(AromaSplashPreferenceContribution)
}
