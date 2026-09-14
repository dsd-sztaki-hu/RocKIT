// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { CommonCommands } from '@theia/core/lib/browser'
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell'
import { UndoRedoHandlerService } from '@theia/core/lib/browser/undo-redo-handler'
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common'
import { inject, injectable } from 'inversify'
import { RoCrateHistoryService } from './ro-crate-history-service'

@injectable()
export class RoCrateUndoRedoCommandContribution implements CommandContribution {
  @inject(RoCrateHistoryService)
  protected readonly roCrateHistoryService: RoCrateHistoryService

  @inject(UndoRedoHandlerService)
  protected readonly undoRedoHandlerService: UndoRedoHandlerService

  @inject(ApplicationShell)
  protected readonly applicationShell: ApplicationShell

  registerCommands(commands: CommandRegistry): void {
    commands.registerHandler(CommonCommands.UNDO.id, {
      execute: () => this.executeUndo(),
    })

    commands.registerHandler(CommonCommands.REDO.id, {
      execute: () => this.executeRedo(),
    })
  }

  protected executeUndo(): void {
    if (this.shouldUseRoCrateHistory() && this.roCrateHistoryService.canUndo()) {
      this.roCrateHistoryService.undo()
      return
    }
    this.undoRedoHandlerService.undo()
  }

  protected executeRedo(): void {
    if (this.shouldUseRoCrateHistory() && this.roCrateHistoryService.canRedo()) {
      this.roCrateHistoryService.redo()
      return
    }
    this.undoRedoHandlerService.redo()
  }

  protected shouldUseRoCrateHistory(): boolean {
    if (this.isFileEditorFocused()) {
      return false
    }

    const activeElement = document.activeElement as HTMLElement | null
    if (!activeElement) {
      return true
    }

    if (activeElement.closest('.monaco-editor')) {
      return false
    }

    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement
    ) {
      return false
    }

    if (activeElement.isContentEditable || activeElement.closest('[contenteditable="true"]')) {
      return false
    }

    return true
  }

  protected isFileEditorFocused(): boolean {
    const activeElement = document.activeElement as HTMLElement | null
    if (activeElement?.closest('.theia-editor, .monaco-editor')) {
      return true
    }

    const currentWidget = this.applicationShell.currentWidget
    if (!currentWidget) {
      return false
    }

    if (currentWidget.node?.classList.contains('theia-editor')) {
      return true
    }

    return currentWidget.id.startsWith('code-editor-opener')
  }
}
