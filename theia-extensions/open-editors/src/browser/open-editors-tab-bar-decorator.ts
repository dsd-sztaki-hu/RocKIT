// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { injectable } from '@theia/core/shared/inversify'
import { Emitter, Event } from '@theia/core/lib/common/event'
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator'
import {
  ApplicationShell,
  FrontendApplication,
  FrontendApplicationContribution,
  Saveable,
  Title,
  Widget,
} from '@theia/core/lib/browser'
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration'
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable'
import { OpenEditorsWidget } from './navigator-open-editors-widget'

@injectable()
export class OpenEditorsTabBarDecorator
  implements TabBarDecorator, FrontendApplicationContribution
{
  readonly id = 'theia-open-editors-tabbar-decorator'
  protected applicationShell: ApplicationShell

  protected readonly emitter = new Emitter<void>()
  private readonly toDispose = new DisposableCollection()
  private readonly toDisposeOnDirtyChanged = new Map<string, Disposable>()

  onStart(app: FrontendApplication): void {
    this.applicationShell = app.shell
    if (this.getDirtyEditorsCount() > 0) {
      this.fireDidChangeDecorations()
    }
    this.toDispose.pushAll([
      this.applicationShell.onDidAddWidget((widget) => {
        const saveable = Saveable.get(widget)
        if (saveable) {
          this.toDisposeOnDirtyChanged.set(
            widget.id,
            saveable.onDirtyChanged(() => this.fireDidChangeDecorations()),
          )
        }
      }),
      this.applicationShell.onDidRemoveWidget((widget) =>
        this.toDisposeOnDirtyChanged.get(widget.id)?.dispose(),
      ),
    ])
  }

  decorate(title: Title<Widget>): WidgetDecoration.Data[] {
    if (title.owner instanceof OpenEditorsWidget) {
      const changes = this.getDirtyEditorsCount()
      return changes > 0 ? [{ badge: changes }] : []
    }
    return []
  }

  protected getDirtyEditorsCount(): number {
    return this.applicationShell.widgets.filter((widget) => Saveable.isDirty(widget)).length
  }

  get onDidChangeDecorations(): Event<void> {
    return this.emitter.event
  }

  protected fireDidChangeDecorations(): void {
    this.emitter.fire(undefined)
  }
}
