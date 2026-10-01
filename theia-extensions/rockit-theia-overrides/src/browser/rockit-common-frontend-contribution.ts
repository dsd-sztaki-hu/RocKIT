// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd-sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  CommonFrontendContribution,
  ConfirmSaveDialog,
  confirmExit,
  Dialog,
  NavigatableWidget,
  OnWillStopAction,
  Saveable,
} from '@theia/core/lib/browser'
import { Widget } from '@theia/core/lib/browser/widgets'
import { UNTITLED_SCHEME } from '@theia/core/lib/common'
import { nls } from '@theia/core/lib/common/nls'
import { injectable } from '@theia/core/shared/inversify'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'

/**
 * Keeps RO-Crate editor widgets Saveable (including their dirty tab marker and
 * normal save behaviour), but leaves their window-close confirmation to
 * ApplicationFileMenuOverrides, which reports the actual persisted files.
 */
@injectable()
export class RockitCommonFrontendContribution extends CommonFrontendContribution {
  override onWillStop(): OnWillStopAction | undefined {
    if (!this.shouldPreventClose && this.dirtyFileWidgets().length === 0) {
      return undefined
    }

    return {
      reason: 'Dirty file editors present',
      action: async () => {
        const dirtyWidgets = this.dirtyFileWidgets()
        const captions = dirtyWidgets.map((widget) => widget.title.label)
        const shouldExit = await this.confirmFileEditorsBeforeExit(captions)

        if (shouldExit === true) {
          await this.saveFileWidgets(dirtyWidgets)
          const allSaved = this.dirtyFileWidgets().length === 0
          this.shouldPreventClose = !allSaved
          return allSaved
        }

        const allSavedOrDoNotSave = shouldExit === false
        this.shouldPreventClose = !allSavedOrDoNotSave
        return allSavedOrDoNotSave
      },
    }
  }

  protected dirtyFileWidgets(): Widget[] {
    return this.shell.widgets.filter(
      (widget) =>
        !(widget instanceof RoCrateEditorWidget) &&
        this.saveResourceService.canSave(widget),
    )
  }

  protected async saveFileWidgets(widgets: Widget[]): Promise<void> {
    const untitledWidgets = widgets.filter(
      (widget) => NavigatableWidget.getUri(widget)?.scheme === UNTITLED_SCHEME,
    )
    const fileWidgets = widgets.filter((widget) => !untitledWidgets.includes(widget))

    for (const widget of [...untitledWidgets, ...fileWidgets]) {
      if (Saveable.isDirty(widget) && this.saveResourceService.canSave(widget)) {
        await this.saveResourceService.save(widget)
      }
    }
  }

  protected async confirmFileEditorsBeforeExit(
    captions: string[],
  ): Promise<boolean | undefined> {
    if (captions.length === 0) {
      return confirmExit()
    }

    const message = document.createElement('div')
    message.innerText = nls.localizeByDefault(
      "Your changes will be lost if you don't save them.",
    )

    const captionList = document.createElement('span')
    captionList.appendChild(document.createElement('br'))
    for (const caption of captions) {
      const item = document.createElement('b')
      item.innerText = caption
      captionList.appendChild(item)
      captionList.appendChild(document.createElement('br'))
    }
    captionList.appendChild(document.createElement('br'))
    message.appendChild(captionList)

    const result = await new ConfirmSaveDialog({
      title: nls.localizeByDefault(
        'Do you want to save the changes to the following {0} files?',
        captions.length,
      ),
      msg: message,
      dontSave: nls.localizeByDefault("Don't Save"),
      save: nls.localizeByDefault('Save All'),
      cancel: Dialog.CANCEL,
    }).open()

    return result === undefined ? undefined : result
  }
}
