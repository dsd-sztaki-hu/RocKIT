import {
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { ShellLayoutTransformer } from '@theia/core/lib/browser/shell/shell-layout-restorer'
import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { ContainerModule } from '@theia/core/shared/inversify'
import { RoCrateDefaultLayoutContribution } from './application-default-layout-contribution'
import { ApplicationEditMenuOverrides } from './application-edit-menu-overrides'
import { ApplicationFileMenuOverrides } from './application-file-menu-overrides'
import { ApplicationRoCrateMenuContribution } from './application-ro-crate-menu-contribution'
import { ApplicationViewMenuOverrides } from './application-view-menu-overrides'
import { FileEditorLanguageContribution } from './file-editor-language-contribution'

export default new ContainerModule((bind) => {
  bind(ApplicationEditMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationEditMenuOverrides)
  bind(CommandContribution).toService(ApplicationEditMenuOverrides)
  bind(MenuContribution).toService(ApplicationEditMenuOverrides)
  bind(ApplicationFileMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationFileMenuOverrides)
  bind(CommandContribution).toService(ApplicationFileMenuOverrides)
  bind(MenuContribution).toService(ApplicationFileMenuOverrides)
  bind(ApplicationRoCrateMenuContribution).toSelf().inSingletonScope()
  bind(MenuContribution).toService(ApplicationRoCrateMenuContribution)
  bind(ApplicationViewMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationViewMenuOverrides)
  bind(ShellLayoutTransformer).toService(ApplicationViewMenuOverrides)
  bind(RoCrateDefaultLayoutContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(RoCrateDefaultLayoutContribution)
  bind(FileEditorLanguageContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(FileEditorLanguageContribution)
})
