/**
 * Generated using theia-extension-generator
 */

import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { ContainerModule } from '@theia/core/shared/inversify'
import {
  ExportRoCrateCommandContribution,
  ExportRoCrateMenuContribution,
} from './export-ro-crate-contribution'

import '../../src/browser/style/index.css'

export default new ContainerModule((bind) => {
  // add your contribution bindings here
  bind(CommandContribution).to(ExportRoCrateCommandContribution)
  bind(MenuContribution).to(ExportRoCrateMenuContribution)
})
