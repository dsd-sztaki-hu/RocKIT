import { MenuPath } from '@theia/core'
import {
  ApplicationShell,
  ContextMenuRenderer,
  NodeProps,
  TreeModel,
  TreeNode,
  TreeProps,
  TreeWidget,
  WidgetManager,
} from '@theia/core/lib/browser'
import { FOCUS_CLASS, SELECTED_CLASS } from '@theia/core/lib/browser/widgets'
import { inject, injectable } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import '../../src/browser/styles/entities-overview-widget.css'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'
import {
  EntitiesOverviewModel,
  ExampleTreeLeaf,
  ExampleTreeNode,
} from './entities-overview-model'

/** Well-known constant for the context menu path */
export const TREEVIEW_EXAMPLE_CONTEXT_MENU: MenuPath = [
  'theia-examples:treeview-example-context-menu',
]

/** Implementation of the Tree Widget */
@injectable()
export class EntitiesOverviewWidget extends TreeWidget {
  /** The ID of the view */
  static readonly ID = 'theia-examples:treeview-example-view'
  /** The label of the view */
  static readonly LABEL = 'Entities Overview'

  /** Used in Drag & Drop code to remember and cancel deferred expansion of hovered nodes */
  // protected readonly toCancelNodeExpansion = new DisposableCollection()

  constructor(
    @inject(TreeProps) public override readonly props: TreeProps,
    @inject(TreeModel) public override readonly model: EntitiesOverviewModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(AppStateService) private readonly appStateService: AppStateService,
    @inject(WidgetManager) private readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) private readonly shell: ApplicationShell,
  ) {
    super(props, model, contextMenuRenderer)

    // set the general properties for the view
    this.id = EntitiesOverviewWidget.ID
    this.title.label = EntitiesOverviewWidget.LABEL
    this.title.caption = EntitiesOverviewWidget.LABEL
    this.title.closable = true
    this.title.iconClass = 'fa fa-list-ul'

    // this.toDispose.push(this.toCancelNodeExpansion)
  }

  protected readonly openingEntities = new Set<string>()

  /**
   * Enable icon rendering.
   *
   * The super implementation is currently empty.
   * This implementation is taken from `file-tree-widget.tsx`.
   *
   * @param node the node to render
   * @param props the node props (currently transporting the depth of the item in the tree)
   * @returns
   */
  protected override renderIcon(node: TreeNode, props: NodeProps): React.ReactNode {
    const icon = this.getIconClass(this.toNodeIcon(node))
    if (icon) {
      return <div className={`${icon}`}></div>
    }
    return super.renderIcon(node, props)
  }

  /**
   * Provide CSS class names for a given tree node.
   *
   * In our example, we append our own CSS class to all nodes. See/modify the included CSS file for the corresponding style.
   *
   * @param node the node to render
   * @param props the node props (currently transporting the depth of the item in the tree)
   * @returns the node's CSS classes
   */
  protected override createNodeClassNames(node: TreeNode, props: NodeProps): string[] {
    const classNames = super
      .createNodeClassNames(node, props)
      .concat('theia-example-tree-node')
    if (ExampleTreeNode.is(node)) {
      return classNames.filter(
        (className) => className !== SELECTED_CLASS && className !== FOCUS_CLASS,
      )
    }
    return classNames
  }

  protected override rowIsSelected(node: TreeNode, props: NodeProps): boolean {
    if (ExampleTreeNode.is(node)) {
      return false
    }
    return super.rowIsSelected(node, props)
  }

  protected override handleContextMenuEvent(
    node: TreeNode | undefined,
    event: React.MouseEvent<HTMLElement>,
  ): void {
    if (node && ExampleTreeNode.is(node)) {
      const contextMenuPath = this.props.contextMenuPath
      if (contextMenuPath) {
        const { x, y } = event.nativeEvent
        const args = this.toContextMenuArgs(node)
        const target = event.currentTarget
        setTimeout(
          () =>
            this.contextMenuRenderer.render({
              menuPath: contextMenuPath,
              context: target,
              anchor: { x, y },
              args,
            }),
          10,
        )
      }
      event.stopPropagation()
      event.preventDefault()
      return
    }
    super.handleContextMenuEvent(node, event)
  }

  /**
   * Provide node element attributes for a given tree node.
   *
   * @param node the node to render
   * @param props the node props (currently transporting the depth of the item in the tree)
   * @returns the HTML element attributes.
   */
  protected override createNodeAttributes(
    node: TreeNode,
    props: NodeProps,
  ): React.Attributes & React.HTMLAttributes<HTMLElement> {
    return {
      ...super.createNodeAttributes(node, props),
      onClick: () => this.handleNodeClick(node),
    }
  }

  /**
   * Handle click events on tree nodes.
   * For leaf nodes, this will log the name to the console.
   *
   * @param node the clicked node
   */
  protected handleNodeClick(node: TreeNode): void {
    if (ExampleTreeNode.is(node)) {
      void this.model.toggleNodeExpansion(node)
      return
    }
    if (ExampleTreeLeaf.is(node)) {
      const entityId = node.data.entityId
      if (!entityId) {
        return
      }
      this.appStateService.selectedEntityId = entityId
      void this.openRoCrateEditorForEntity(entityId)
    }
  }

  protected async openRoCrateEditorForEntity(entityId: string): Promise<void> {
    if (this.openingEntities.has(entityId)) {
      return
    }
    this.openingEntities.add(entityId)
    try {
      const existingWidgetId = this.findWidgetIdForEntity(entityId)
      if (existingWidgetId) {
        const existing = this.shell.getWidgetById(existingWidgetId)
        if (existing) {
          this.appStateService.registerEntityEditor(existingWidgetId, entityId)
          await this.shell.activateWidget(existingWidgetId)
          return
        }
      }

      const widget = await this.widgetManager.getOrCreateWidget(RoCrateEditorWidget.ID, {
        instance: entityId,
        entityId,
      })
      await this.shell.addWidget(widget, { area: 'main' })
      this.appStateService.registerEntityEditor(widget.id, entityId)
      await this.shell.activateWidget(widget.id)
    } finally {
      this.openingEntities.delete(entityId)
    }
  }

  protected findWidgetIdForEntity(entityId: string): string | undefined {
    return this.appStateService.getEntityEditorWidgetId(entityId)
  }
}
