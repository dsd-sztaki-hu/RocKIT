import { DisposableCollection, MenuPath, MessageService } from '@theia/core'
import {
  ContextMenuRenderer,
  NodeProps,
  TreeModel,
  TreeNode,
  TreeProps,
  TreeWidget,
} from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import '../../src/browser/styles/entities-overview-widget.css'
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
  protected readonly toCancelNodeExpansion = new DisposableCollection()

  /** The MessageService to demonstrate the action when a user opens (double-clicks) a node */
  @inject(MessageService) private readonly messageService: MessageService

  constructor(
    @inject(TreeProps) public override readonly props: TreeProps,
    @inject(TreeModel) public override readonly model: EntitiesOverviewModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
  ) {
    super(props, model, contextMenuRenderer)

    // set the general properties for the view
    this.id = EntitiesOverviewWidget.ID
    this.title.label = EntitiesOverviewWidget.LABEL
    this.title.caption = EntitiesOverviewWidget.LABEL
    this.title.closable = true
    this.title.iconClass = 'fa fa-list-ul'

    // register action on double-click / ENTER key
    this.toDispose.push(
      this.model.onOpenNode((node: TreeNode) => {
        if (ExampleTreeLeaf.is(node) || ExampleTreeNode.is(node)) {
          this.messageService.info(`Example node ${node.data.name} was opened.`)
        }
      }),
    )
    this.toDispose.push(this.toCancelNodeExpansion)
  }

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
    return super.createNodeClassNames(node, props).concat('theia-example-tree-node')
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
    if (ExampleTreeLeaf.is(node)) {
      console.log(`Clicked entity: ${node.data.name}`)
      console.log(`Entity details:`, {
        name: node.data.name,
        valid: node.data.valid,
      })
    }
  }
}
