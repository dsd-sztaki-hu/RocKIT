import {
  LocalizationContribution,
} from '@theia/core/lib/node/i18n/localization-contribution'
import { ContainerModule } from '@theia/core/shared/inversify'
import { RockitLocalizationContribution } from './rockit-localization-contribution'

export default new ContainerModule((bind) => {
  bind(RockitLocalizationContribution).toSelf().inSingletonScope()
  bind(LocalizationContribution).toService(RockitLocalizationContribution)
})
