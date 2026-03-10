import { inject, injectable } from '@theia/core/shared/inversify'
import {
  DidChangeLabelEvent,
  LabelProvider,
  LabelProviderContribution,
} from '@theia/core/lib/browser/label-provider'
import { OpenEditorNode } from './navigator-open-editors-tree-model'

@injectable()
export class OpenEditorsLabelProvider implements LabelProviderContribution {
  @inject(LabelProvider)
  protected readonly labelProvider: LabelProvider

  canHandle(element: object): number {
    return OpenEditorNode.is(element) ? 100 : 0
  }

  getName(node: OpenEditorNode): string {
    if (node.uri.scheme === 'rocrate') {
      return node.widget.title.caption || node.widget.title.label
    }
    return this.labelProvider.getName(node.fileStat)
  }

  getIcon(node: OpenEditorNode): string {
    if (node.uri.scheme === 'rocrate') {
      return (
        node.widget.title.iconClass ||
        this.labelProvider.getIcon(node.fileStat) ||
        'fa fa-pencil-square-o'
      )
    }
    return this.labelProvider.getIcon(node.fileStat) || 'fa fa-file-text-o'
  }

  getDescription(node: OpenEditorNode): string {
    if (node.uri.scheme === 'rocrate') {
      return ''
    }
    return this.labelProvider.getLongName(node.fileStat)
  }

  affects(node: OpenEditorNode, event: DidChangeLabelEvent): boolean {
    if (node.uri.scheme === 'rocrate') {
      return false
    }
    return event.affects(node.fileStat)
  }
}
