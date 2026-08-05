/**
 * Generated using theia-extension-generator
 */

import { FrontendApplicationContribution } from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'
import { GrabHelperContribution } from './react-grab-helper-contribution'
import { bindReactGrabHelperPreferences } from '../common/react-grab-helper-preferences'

export default new ContainerModule((bind) => {
  bindReactGrabHelperPreferences(bind)
  bind(GrabHelperContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(GrabHelperContribution)
})
