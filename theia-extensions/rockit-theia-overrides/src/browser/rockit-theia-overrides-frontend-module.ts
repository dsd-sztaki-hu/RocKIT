// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  CommonFrontendContribution,
  FrontendApplicationContribution,
  WidgetFactory,
} from '@theia/core/lib/browser'
import { ShellLayoutTransformer } from '@theia/core/lib/browser/shell/shell-layout-restorer'
import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { ContainerModule } from '@theia/core/shared/inversify'
import { PreferenceTreeLabelProvider } from '@theia/preferences/lib/browser/util/preference-tree-label-provider'
import { PreferenceNodeRendererContribution } from '@theia/preferences/lib/browser/views/components/preference-node-renderer-creator'
import { bindRockitSplashPreferences } from '../common/rockit-splash-preferences'
import { RoCrateDefaultLayoutContribution } from './application-default-layout-contribution'
import { ApplicationEditMenuOverrides } from './application-edit-menu-overrides'
import { ApplicationFileMenuOverrides } from './application-file-menu-overrides'
import { ApplicationMainMenuOverrides } from './application-main-menu-overrides'
import { ApplicationManageMenuOverrides } from './application-manage-menu-overrides'
import { ApplicationRoCrateMenuContribution } from './application-ro-crate-menu-contribution'
import { ApplicationViewMenuOverrides } from './application-view-menu-overrides'
import { ConnectionNotificationContribution } from './connection-notification-contribution'
import { DisplayLanguageMenuContribution } from './display-language-menu-contribution'
import { EmptyWorkspaceWidget } from './empty-workspace-widget'
import { FileEditorLanguageContribution } from './file-editor-language-contribution'
import { HelpIconsToggleContribution } from './help-icons-toggle-contribution'
import { RockitCommonFrontendContribution } from './rockit-common-frontend-contribution'
import {
  RockitPreferenceSelectInputRenderer,
  RockitPreferenceSelectInputRendererContribution,
} from './rockit-preference-select-input'
import { RockitPreferenceTreeLabelProvider } from './rockit-preference-tree-label-provider'
import { RockitSplashContribution } from './rockit-splash-contribution'
import '../../src/browser/style/empty-workspace.css'
import '../../src/browser/style/help-icons.css'
import '../../src/browser/style/panel-backgrounds.css'

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  bind(RockitCommonFrontendContribution).toSelf().inSingletonScope()
  rebind(CommonFrontendContribution).toService(RockitCommonFrontendContribution)
  bind(RockitPreferenceTreeLabelProvider).toSelf().inSingletonScope()
  rebind(PreferenceTreeLabelProvider).toService(RockitPreferenceTreeLabelProvider)
  bind(RockitPreferenceSelectInputRenderer).toSelf()
  bind(PreferenceNodeRendererContribution)
    .to(RockitPreferenceSelectInputRendererContribution)
    .inSingletonScope()
  bind(EmptyWorkspaceWidget).toSelf()
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: EmptyWorkspaceWidget.ID,
      createWidget: async () => {
        const widget = ctx.container.get(EmptyWorkspaceWidget)
        await widget.initialize()
        return widget
      },
    }))
    .inSingletonScope()
  bindRockitSplashPreferences(bind)
  bind(ApplicationEditMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationEditMenuOverrides)
  bind(CommandContribution).toService(ApplicationEditMenuOverrides)
  bind(MenuContribution).toService(ApplicationEditMenuOverrides)
  bind(ApplicationFileMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationFileMenuOverrides)
  bind(CommandContribution).toService(ApplicationFileMenuOverrides)
  bind(MenuContribution).toService(ApplicationFileMenuOverrides)
  bind(ApplicationMainMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationMainMenuOverrides)
  bind(MenuContribution).toService(ApplicationMainMenuOverrides)
  bind(ApplicationManageMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationManageMenuOverrides)
  bind(MenuContribution).toService(ApplicationManageMenuOverrides)
  bind(ApplicationRoCrateMenuContribution).toSelf().inSingletonScope()
  bind(MenuContribution).toService(ApplicationRoCrateMenuContribution)
  bind(RockitSplashContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(RockitSplashContribution)
  bind(CommandContribution).toService(RockitSplashContribution)
  bind(MenuContribution).toService(RockitSplashContribution)
  bind(ApplicationViewMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationViewMenuOverrides)
  bind(ShellLayoutTransformer).toService(ApplicationViewMenuOverrides)
  bind(ConnectionNotificationContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ConnectionNotificationContribution)
  bind(DisplayLanguageMenuContribution).toSelf().inSingletonScope()
  bind(MenuContribution).toService(DisplayLanguageMenuContribution)
  bind(RoCrateDefaultLayoutContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(RoCrateDefaultLayoutContribution)
  bind(FileEditorLanguageContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(FileEditorLanguageContribution)
  bind(HelpIconsToggleContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(HelpIconsToggleContribution)
  bind(CommandContribution).toService(HelpIconsToggleContribution)
  bind(MenuContribution).toService(HelpIconsToggleContribution)
})
