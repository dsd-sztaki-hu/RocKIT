// *****************************************************************************
// Copyright (C) 2017 TypeFox and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import './style/index.css'
import './open-editors-widget/open-editors.css'

import {
  ApplicationShellLayoutMigration,
  bindViewContribution,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator'
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar'
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager'
import { bindContributionProvider } from '@theia/core/lib/common'
import { LabelProviderContribution } from '@theia/core/lib/browser/label-provider'
import { ContainerModule } from '@theia/core/shared/inversify'
import { FileTreeDecoratorAdapter } from '@theia/filesystem/lib/browser'
import { bindFileNavigatorPreferences } from '../common/navigator-preferences'
import { createFileNavigatorWidget } from './navigator-container'
import { NavigatorContextKeyService } from './navigator-context-key-service'
import { FileNavigatorContribution } from './navigator-contribution'
import { NavigatorTreeDecorator } from './navigator-decorator-service'
import { NavigatorDiff } from './navigator-diff'
import { FileNavigatorFilter } from './navigator-filter'
import {
  NavigatorLayoutVersion3Migration,
  NavigatorLayoutVersion5Migration,
} from './navigator-layout-migrations'
import { NavigatorSymlinkDecorator } from './navigator-symlink-decorator'
import { NavigatorTabBarDecorator } from './navigator-tab-bar-decorator'
import { FILE_NAVIGATOR_ID, FileNavigatorWidget } from './navigator-widget'
import { NavigatorWidgetFactory } from './navigator-widget-factory'
import { NavigatorDeletedEditorDecorator } from './open-editors-widget/navigator-deleted-editor-decorator'
import { OpenEditorsLabelProvider } from './open-editors-widget/open-editors-label-provider'
import { OpenEditorsTreeDecorator } from './open-editors-widget/navigator-open-editors-decorator-service'
import { OpenEditorsWidget } from './open-editors-widget/navigator-open-editors-widget'

export default new ContainerModule((bind) => {
  bindFileNavigatorPreferences(bind)
  bind(FileNavigatorFilter).toSelf().inSingletonScope()

  bind(NavigatorContextKeyService).toSelf().inSingletonScope()

  bindViewContribution(bind, FileNavigatorContribution)
  bind(FrontendApplicationContribution).toService(FileNavigatorContribution)
  bind(TabBarToolbarContribution).toService(FileNavigatorContribution)

  bind(FileNavigatorWidget).toDynamicValue((ctx) =>
    createFileNavigatorWidget(ctx.container),
  )
  bind(WidgetFactory)
    .toDynamicValue(({ container }) => ({
      id: FILE_NAVIGATOR_ID,
      createWidget: () => container.get(FileNavigatorWidget),
    }))
    .inSingletonScope()
  bindContributionProvider(bind, NavigatorTreeDecorator)
  bindContributionProvider(bind, OpenEditorsTreeDecorator)
  bind(NavigatorTreeDecorator).toService(FileTreeDecoratorAdapter)
  bind(OpenEditorsTreeDecorator).toService(FileTreeDecoratorAdapter)
  bind(NavigatorDeletedEditorDecorator).toSelf().inSingletonScope()
  bind(OpenEditorsTreeDecorator).toService(NavigatorDeletedEditorDecorator)
  bind(OpenEditorsLabelProvider).toSelf().inSingletonScope()
  bind(LabelProviderContribution).toService(OpenEditorsLabelProvider)

  bind(WidgetFactory)
    .toDynamicValue(({ container }) => ({
      id: OpenEditorsWidget.ID,
      createWidget: () => OpenEditorsWidget.createWidget(container),
    }))
    .inSingletonScope()

  bind(NavigatorWidgetFactory).toSelf().inSingletonScope()
  bind(WidgetFactory).toService(NavigatorWidgetFactory)
  bind(ApplicationShellLayoutMigration)
    .to(NavigatorLayoutVersion3Migration)
    .inSingletonScope()
  bind(ApplicationShellLayoutMigration)
    .to(NavigatorLayoutVersion5Migration)
    .inSingletonScope()

  bind(NavigatorDiff).toSelf().inSingletonScope()
  bind(NavigatorTabBarDecorator).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(NavigatorTabBarDecorator)
  bind(TabBarDecorator).toService(NavigatorTabBarDecorator)

  bind(NavigatorSymlinkDecorator).toSelf().inSingletonScope()
  bind(NavigatorTreeDecorator).toService(NavigatorSymlinkDecorator)
  bind(OpenEditorsTreeDecorator).toService(NavigatorSymlinkDecorator)
})
