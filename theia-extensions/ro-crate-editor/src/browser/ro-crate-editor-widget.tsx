import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { inject, injectable } from 'inversify'
import * as React from 'react'

import '@arpproject/recrate/style.css'
import { Message } from '@lumino/messaging'
import type { Disposable } from '@theia/core'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'

import { DescriboCrateBuilderWrapper } from './recrate-wrapper'

interface RoCrateEditorWidgetOptions {
  instanceId?: string
  entityId?: string
}

@injectable()
export class RoCrateEditorWidget extends ReactWidget {
  static readonly ID = 'rocrate-editor-widget'

  protected instanceId: string = ''
  protected assignedEntityId?: string

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  protected crateSubscription?: Disposable
  protected profileSubscription?: Disposable
  protected selectedEntityIdSubscription?: Disposable

  protected localCrate: Record<string, any> | undefined
  protected localProfile: Record<string, any> | undefined
  protected localSelectedEntityId: string | undefined

  constructor() {
    super()
    this.addClass('rocrate-editor')
    this.title.closable = true
    this.node.tabIndex = 0
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.node.addEventListener('mousedown', () => {
      this.activate()
    })
  }

  initialize(options: RoCrateEditorWidgetOptions = {}): void {
    this.instanceId =
      options.instanceId ??
      `${RoCrateEditorWidget.ID}:${Math.random().toString(36).substring(2)}`

    this.id = this.instanceId

    // Assign initial values from app-state on component load
    this.localCrate = this.appStateService.roCrate
    this.localProfile = this.appStateService.profile

    this.crateSubscription = this.appStateService.onDidChangeSelector((s) => s.roCrate)(
      (crate) => {
        this.localCrate = crate
        console.log('crate update')
        this.updateTitleLabel()
        this.update()
      },
    )
    this.profileSubscription = this.appStateService.onDidChangeSelector((s) => s.profile)(
      (profile) => {
        this.localProfile = profile
        console.log('profile update')
        this.update()
      },
    )
    this.selectedEntityIdSubscription = this.appStateService.onDidChangeSelector(
      (s) => s.selectedEntityId,
    )((selectedEntityId) => {
      if (selectedEntityId === this.assignedEntityId) {
        const prev = this.localSelectedEntityId
        this.localSelectedEntityId = selectedEntityId
        console.log('selectedEntityId update', { prev, next: selectedEntityId })
        this.updateTitleLabel()
        this.update()
      }
    })

    const initialEntity = options.entityId ?? this.appStateService.selectedEntityId ?? './'
    this.assignEntity(initialEntity)
    this.update()
  }

  protected handleSaveCrate = (saveData: any) => {
    console.log('saveData', saveData)
    const crate = saveData && (saveData as any).crate ? (saveData as any).crate : saveData
    this.appStateService.roCrate = crate
    this.localCrate = crate
  }

  protected handleNavigation = (entity: any) => {
    const nextId = entity && entity['@id']
    console.log('navigation event', entity)
    if (!nextId || nextId === this.assignedEntityId) {
      return
    }
    const prevId = this.assignedEntityId
    this.assignEntity(nextId)
    this.appStateService.selectedEntityId = nextId
    console.log('selectedEntityId set', {
      prev: prevId,
      next: this.appStateService.selectedEntityId,
    })
  }

  render(): React.ReactNode {
    return (
      <div style={{ padding: '1rem' }}>
        <h3>Panel ID:</h3>
        <pre>{this.instanceId}</pre>
        <DescriboCrateBuilderWrapper
          crate={this.localCrate}
          profile={this.localProfile}
          entityId={this.localSelectedEntityId}
          onSaveCrate={this.handleSaveCrate}
          onNavigation={this.handleNavigation}
        />
      </div>
    )
  }

  protected assignEntity(entityId: string): void {
    if (!this.id) {
      return
    }
    const prev = this.assignedEntityId
    this.assignedEntityId = entityId
    this.localSelectedEntityId = entityId
    this.appStateService.registerEntityEditor(this.id, entityId)
    console.log('Assigned entity to widget', { widget: this.id, prev, next: entityId })
    this.updateTitleLabel()
  }

  protected updateTitleLabel(): void {
    const entityId = this.assignedEntityId ?? './'
    const entityDisplay = this.getEntityDisplayName(entityId)
    this.title.label = `ROC-edit: ${entityDisplay}`
  }

  protected getEntityDisplayName(entityId: string): string {
    if (entityId === './') {
      return './'
    }
    const rawGraph = this.localCrate?.['@graph']
    const graph = Array.isArray(rawGraph) ? (rawGraph as Record<string, any>[]) : []
    const entity = graph.find(
      (entry) => entry && typeof entry === 'object' && String(entry['@id']) === entityId,
    )
    if (entity) {
      const name = entity.name ?? entity.title ?? entity['@id']
      if (typeof name === 'string' && name.trim()) {
        return name.trim()
      }
    }
    return entityId
  }

  protected unregisterFromAppState(): void {
    if (!this.id) {
      return
    }
    this.appStateService.unregisterEntityEditor(this.id)
  }

  dispose(): void {
    this.unregisterFromAppState()
    this.crateSubscription?.dispose()
    this.profileSubscription?.dispose()
    this.selectedEntityIdSubscription?.dispose()
    super.dispose()
  }
}
