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
    this.addClass('entities-overview-panel')
  }

  protected readonly openingEntities = new Set<string>()
  protected entityNameFilter = ''
  protected selectedTypeFilters = new Set<string>()

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

  protected override render(): React.ReactNode {
    const availableTypes = this.model.getAvailableTypes()
    const selectedTypes = this.getSelectedTypes(availableTypes)
    const selectedCountLabel =
      selectedTypes.length === 0 ? 'All types' : `${selectedTypes.length} selected`
    return (
      <div className="entities-overview-panel-content">
        <div className="entities-overview-filters">
          <div className="entities-overview-filter-header">
            <span className="entities-overview-filter-title">Filters</span>
            <button
              className="entities-overview-filter-clear"
              type="button"
              disabled={this.entityNameFilter.trim() === '' && selectedTypes.length === 0}
              onClick={() => this.clearFilters()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              Clear
            </button>
          </div>
          <label className="entities-overview-filter-row">
            <span className="entities-overview-filter-label">Entity name</span>
            <input
              className="entities-overview-filter-input"
              type="text"
              placeholder="Search entity name"
              value={this.entityNameFilter}
              onChange={(event) => this.onEntityNameFilterChange(event)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </label>
          <div className="entities-overview-filter-row">
            <span className="entities-overview-filter-label">Entity type</span>
            <details
              className="entities-overview-type-dropdown"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <summary className="entities-overview-type-summary">
                {selectedCountLabel}
              </summary>
              <div className="entities-overview-type-options">
                {availableTypes.length === 0 ? (
                  <div className="entities-overview-type-empty">No types available</div>
                ) : (
                  availableTypes.map((type) => {
                    const checked = this.selectedTypeFilters.has(type)
                    return (
                      <label key={type} className="entities-overview-type-option">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => this.toggleTypeFilter(type)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        />
                        <span>{type}</span>
                      </label>
                    )
                  })
                )}
              </div>
            </details>
          </div>
        </div>
        <div {...this.createContainerAttributes()}>{this.renderTree(this.model)}</div>
      </div>
    )
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
        await this.shell.activateWidget(existingWidgetId)
        return
      }

      const instanceId = `${RoCrateEditorWidget.ID}:${Math.random().toString(36).slice(2)}`

      const widget = await this.widgetManager.getOrCreateWidget(RoCrateEditorWidget.ID, {
        instanceId,
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

  protected onEntityNameFilterChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    this.entityNameFilter = event.target.value
    this.applyFilters()
  }

  protected applyFilters(): void {
    const availableTypes = this.model.getAvailableTypes()
    const selectedTypes = this.getSelectedTypes(availableTypes)
    this.model.setFilters(this.entityNameFilter, selectedTypes)
    this.update()
  }

  protected getSelectedTypes(availableTypes: string[]): string[] {
    if (availableTypes.length === 0) {
      return []
    }
    const availableSet = new Set(availableTypes)
    const filteredSelections = Array.from(this.selectedTypeFilters).filter((type) =>
      availableSet.has(type),
    )
    if (filteredSelections.length !== this.selectedTypeFilters.size) {
      this.selectedTypeFilters = new Set(filteredSelections)
    }
    return availableTypes.filter((type) => this.selectedTypeFilters.has(type))
  }

  protected toggleTypeFilter(type: string): void {
    if (this.selectedTypeFilters.has(type)) {
      this.selectedTypeFilters.delete(type)
    } else {
      this.selectedTypeFilters.add(type)
    }
    this.applyFilters()
  }

  protected clearFilters(): void {
    this.entityNameFilter = ''
    this.selectedTypeFilters.clear()
    this.applyFilters()
  }
}
