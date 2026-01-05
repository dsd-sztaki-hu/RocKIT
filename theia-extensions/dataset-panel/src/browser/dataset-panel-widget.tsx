import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { injectable } from 'inversify'
import * as React from 'react'

@injectable()
export class DatasetPanelWidget extends ReactWidget {
  static readonly ID = 'dataset-panel:widget'

  protected instanceId: string = ''

  constructor() {
    super()
    this.addClass('dataset-panel')
    this.title.closable = true
  }

  initialize(options: any = {}): void {
    this.instanceId =
      options.instanceId ??
      `${DatasetPanelWidget.ID}:${Math.random().toString(36).substring(2)}`

    this.id = this.instanceId
    this.title.label = `Dataset panel (${this.instanceId})`

    this.update()
  }

  render(): React.ReactNode {
    return (
      <div style={{ padding: '1rem' }}>
        <h3>Panel ID:</h3>
        <pre>{this.instanceId}</pre>
      </div>
    )
  }
}
