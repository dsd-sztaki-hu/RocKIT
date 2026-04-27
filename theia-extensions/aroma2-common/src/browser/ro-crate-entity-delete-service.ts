import { ApplicationShell } from '@theia/core/lib/browser'
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs'
import type { Command } from '@theia/core/lib/common/command'
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command'
import { inject, injectable } from 'inversify'

export const RoCrateDeleteSelectedEntitiesCommand: Command = {
  id: 'ro-crate:delete-selected-entities',
  label: 'Delete',
}

export type RoCrateEntityDeleteCommandTarget = {
  canDeleteFromContextMenu(): boolean
  deleteFromContextMenu(): Promise<void>
}

type EntityEditorMapping = Record<string, string>

type RoCrateEntityDeleteAppState = {
  roCrate: Record<string, any> | undefined
  selectedEntityId: string | undefined
  EIRCEIA: EntityEditorMapping | undefined
  unregisterEntityEditor(widgetId: string): void
}

type RoCrateHistory = {
  applyRoCrateChange(
    roCrate: Record<string, any>,
    options?: { label?: string },
  ): boolean
}

export type RoCrateEntityDeleteOptions = {
  selectedEntityIds: Iterable<string>
  rootEntityId: string
  appStateService: RoCrateEntityDeleteAppState
  roCrateHistoryService: RoCrateHistory
  shell: ApplicationShell
}

export type RoCrateEntityDeleteResult = {
  changed: boolean
  deletedEntityIds: Set<string>
}

@injectable()
export class RoCrateEntityDeleteService {
  async deleteSelectedEntities(
    options: RoCrateEntityDeleteOptions,
  ): Promise<RoCrateEntityDeleteResult> {
    const crate = options.appStateService.roCrate
    const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : undefined
    const idsToRemove = this.getDeletableEntityIds(
      options.selectedEntityIds,
      options.rootEntityId,
    )

    if (!crate || !graph || idsToRemove.size === 0) {
      return { changed: false, deletedEntityIds: idsToRemove }
    }

    const confirmed = await this.confirmDeleteEntities(idsToRemove)
    if (!confirmed) {
      return { changed: false, deletedEntityIds: idsToRemove }
    }

    const updatedGraph = this.removeEntitiesAndReferences(graph, idsToRemove)
    const updatedCrate = { ...crate, '@graph': updatedGraph }
    const label = idsToRemove.size > 1 ? 'Delete entities' : 'Delete entity'
    const changed = options.roCrateHistoryService.applyRoCrateChange(updatedCrate, {
      label,
    })
    if (!changed) {
      return { changed: false, deletedEntityIds: idsToRemove }
    }

    if (
      options.appStateService.selectedEntityId &&
      idsToRemove.has(options.appStateService.selectedEntityId)
    ) {
      options.appStateService.selectedEntityId = options.rootEntityId
    }

    await this.closeDeletedEntityEditors(
      idsToRemove,
      options.appStateService,
      options.shell,
    )

    return { changed: true, deletedEntityIds: idsToRemove }
  }

  getDeletableEntityIds(
    selectedEntityIds: Iterable<string>,
    rootEntityId: string,
  ): Set<string> {
    return new Set(Array.from(selectedEntityIds).filter((entityId) => entityId !== rootEntityId))
  }

  protected async confirmDeleteEntities(idsToRemove: ReadonlySet<string>): Promise<boolean> {
    const deleteCount = idsToRemove.size
    if (deleteCount === 0) {
      return false
    }

    const confirmed = await new ConfirmDialog({
      title: deleteCount > 1 ? 'Delete RO-Crate entities?' : 'Delete RO-Crate entity?',
      msg:
        deleteCount > 1
          ? `Are you sure you want to delete the ${deleteCount} selected entities?`
          : 'Are you sure you want to delete the selected entity?',
      ok: 'Delete',
      cancel: 'Cancel',
    }).open()
    return confirmed === true
  }

  protected async closeDeletedEntityEditors(
    idsToRemove: ReadonlySet<string>,
    appStateService: RoCrateEntityDeleteAppState,
    shell: ApplicationShell,
  ): Promise<void> {
    const mapping = appStateService.EIRCEIA ?? {}
    const widgetIdsToClose = Object.entries(mapping)
      .filter(([, entityId]) => idsToRemove.has(entityId))
      .map(([widgetId]) => widgetId)

    for (const widgetId of widgetIdsToClose) {
      try {
        const widget = shell.getWidgetById(widgetId)
        if (widget) {
          await shell.closeWidget(widgetId, { save: false })
        } else {
          appStateService.unregisterEntityEditor(widgetId)
        }
      } catch (error) {
        console.warn('Failed to close RO-Crate editor for deleted entity', {
          widgetId,
          error,
        })
        appStateService.unregisterEntityEditor(widgetId)
      }
    }
  }

  protected removeEntitiesAndReferences(
    graph: ReadonlyArray<Record<string, any>>,
    idsToRemove: ReadonlySet<string>,
  ): Record<string, any>[] {
    const filtered = graph.filter((entry) => {
      const entityId = typeof entry?.['@id'] === 'string' ? entry['@id'] : ''
      return !idsToRemove.has(entityId)
    })

    const cleaned: Record<string, any>[] = []
    for (const entity of filtered) {
      const normalized = this.removeReferencesFromValue(entity, idsToRemove)
      if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
        cleaned.push(normalized as Record<string, any>)
      }
    }
    return cleaned
  }

  protected removeReferencesFromValue(
    value: unknown,
    idsToRemove: ReadonlySet<string>,
  ): unknown {
    if (typeof value === 'string' && idsToRemove.has(value)) {
      return undefined
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => this.removeReferencesFromValue(item, idsToRemove))
        .filter((item) => item !== undefined)
    }

    if (value && typeof value === 'object') {
      const objectValue = value as Record<string, unknown>
      const referenceId = this.extractReferenceId(objectValue)
      if (referenceId && idsToRemove.has(referenceId) && this.isReferenceObject(objectValue)) {
        return undefined
      }

      const normalizedObject: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(objectValue)) {
        const normalized = this.removeReferencesFromValue(child, idsToRemove)
        if (normalized === undefined) {
          continue
        }
        if (Array.isArray(normalized) && normalized.length === 0) {
          continue
        }
        normalizedObject[key] = normalized
      }
      return normalizedObject
    }

    return value
  }

  protected extractReferenceId(value: Record<string, unknown>): string | undefined {
    const idValue = value['@id'] ?? value.id
    return typeof idValue === 'string' ? idValue : undefined
  }

  protected isReferenceObject(value: Record<string, unknown>): boolean {
    const keys = Object.keys(value)
    return keys.length === 1 && (keys[0] === '@id' || keys[0] === 'id')
  }
}

@injectable()
export class RoCrateEntityDeleteCommandContribution implements CommandContribution {
  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(RoCrateDeleteSelectedEntitiesCommand, {
      execute: async (widget?: unknown) => {
        const target = this.getDeleteTarget(widget)
        if (!target) {
          return
        }
        await target.deleteFromContextMenu()
      },
      isEnabled: (widget?: unknown) => {
        const target = this.getDeleteTarget(widget)
        return Boolean(target && target.canDeleteFromContextMenu())
      },
      isVisible: (widget?: unknown) => Boolean(this.getDeleteTarget(widget)),
    })
  }

  protected getDeleteTarget(
    widget?: unknown,
  ): RoCrateEntityDeleteCommandTarget | undefined {
    const candidates = [widget, this.shell.currentWidget, this.shell.activeWidget]
    for (const candidate of candidates) {
      if (this.isDeleteTarget(candidate)) {
        return candidate
      }
    }
    return undefined
  }

  protected isDeleteTarget(
    value: unknown,
  ): value is RoCrateEntityDeleteCommandTarget {
    return Boolean(
      value &&
        typeof (value as RoCrateEntityDeleteCommandTarget).canDeleteFromContextMenu ===
          'function' &&
        typeof (value as RoCrateEntityDeleteCommandTarget).deleteFromContextMenu ===
          'function',
    )
  }
}
