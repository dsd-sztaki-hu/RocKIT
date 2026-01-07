import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { inject, injectable } from 'inversify'
import * as React from 'react'

import '@arpproject/recrate/style.css'
import { Message } from '@lumino/messaging'
import type { Disposable } from '@theia/core'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'

import { DescriboCrateBuilderWrapper } from './recrate-wrapper'

@injectable()
export class RoCrateEditorWidget extends ReactWidget {
  static readonly ID = 'rocrate-editor-widget'

  protected instanceId: string = ''

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

  initialize(options: any = {}): void {
    this.instanceId =
      options.instanceId ??
      `${RoCrateEditorWidget.ID}:${Math.random().toString(36).substring(2)}`

    this.id = this.instanceId
    this.title.label = `Editor ${this.instanceId}`

    // Assign initial values from app-state on component load
    this.localCrate = this.appStateService.roCrate
    this.localProfile = this.appStateService.profile
    this.localSelectedEntityId = this.appStateService.selectedEntityId || './'

    this.crateSubscription = this.appStateService.onDidChangeSelector((s) => s.roCrate)(
      (crate) => {
        this.localCrate = crate
        console.log('crate update')
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
      const prev = this.localSelectedEntityId
      this.localSelectedEntityId = selectedEntityId
      console.log('selectedEntityId update', { prev, next: selectedEntityId })
      this.update()
    })

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
    if (!nextId) {
      return
    }
    if (nextId === this.appStateService.selectedEntityId) {
      return
    }
    const prevId = this.appStateService.selectedEntityId
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

  dispose(): void {
    super.dispose()
    this.crateSubscription?.dispose()
    this.profileSubscription?.dispose()
    this.selectedEntityIdSubscription?.dispose()
  }
}
