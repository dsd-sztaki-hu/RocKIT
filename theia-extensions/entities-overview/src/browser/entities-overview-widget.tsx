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
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { FOCUS_CLASS, SELECTED_CLASS } from '@theia/core/lib/browser/widgets'
import { inject, injectable } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { Button, Select } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import '../../src/browser/styles/entities-overview-widget.css'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'
import {
  EntitiesOverviewModel,
  ExampleTreeLeaf,
  ExampleTreeNode,
  ValidityFilter,
} from './entities-overview-model'

/** Well-known constant for the context menu path */
export const TREEVIEW_EXAMPLE_CONTEXT_MENU: MenuPath = [
  'theia-examples:treeview-example-context-menu',
]

class AdvancedFiltersDialog extends ReactDialog<'apply'> {
  constructor() {
    super({ title: 'Advanced filters' })
    this.appendCloseButton('Close')
    this.appendAcceptButton('Filter')
  }

  protected render(): React.ReactNode {
    return (
      <div className="entities-overview-advanced-modal-body">
        <p>Advanced filtering options will live here.</p>
      </div>
    )
  }

  get value(): 'apply' {
    return 'apply'
  }
}

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
  protected readonly simpleFilters: {
    entityNameFilter: string
    selectedTypeFilters: string[]
    validityFilter: ValidityFilter
  } = {
    entityNameFilter: '',
    selectedTypeFilters: [],
    validityFilter: 'all',
  }
  protected readonly advancedFilters: {
    entityNameFilter: string
    selectedTypeFilters: string[]
    validityFilter: ValidityFilter
  } = {
    entityNameFilter: '',
    selectedTypeFilters: [],
    validityFilter: 'all',
  }
  protected filterMode: 'simple' | 'advanced' = 'simple'
  protected readonly entityNameInputRef = React.createRef<HTMLInputElement>()
  protected entityNameSelection: { start: number | null; end: number | null } | undefined

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
    const activeFilters = this.getActiveFilters()
    const selectedTypes = this.normalizeSelectedTypes(availableTypes, activeFilters)
    const isAdvanced = this.filterMode === 'advanced'
    return (
      <div className="entities-overview-panel-content">
        <div className="entities-overview-filters">
          <div className="entities-overview-filter-header">
            <span className="entities-overview-filter-title">Filters</span>
            <div className="entities-overview-filter-toggle">
              <Button.Group size="small">
                <Button
                  type={this.filterMode === 'simple' ? 'primary' : 'default'}
                  onClick={() => this.setFilterMode('simple')}
                >
                  Simple
                </Button>
                <Button
                  type={this.filterMode === 'advanced' ? 'primary' : 'default'}
                  onClick={() => this.setFilterMode('advanced')}
                >
                  Advanced
                </Button>
              </Button.Group>
            </div>
          </div>
          <div
            className={`entities-overview-filter-fields${isAdvanced ? ' is-hidden' : ''}`}
            aria-hidden={isAdvanced}
          >
            <label className="entities-overview-filter-row">
              <span className="entities-overview-filter-label">Entity name</span>
              <input
                className="entities-overview-filter-input"
                type="text"
                placeholder="Search entity name"
                ref={this.entityNameInputRef}
                value={activeFilters.entityNameFilter}
                onChange={(event) => this.onEntityNameFilterChange(event)}
                onKeyDownCapture={(event) => this.stopFilterKeyEvents(event)}
              />
            </label>
            <label className="entities-overview-filter-row">
              <span className="entities-overview-filter-label">Validity</span>
              <div onKeyDownCapture={(event) => this.stopFilterKeyEvents(event)}>
                <Select
                  className="entities-overview-validity-select"
                  value={activeFilters.validityFilter}
                  options={[
                    { value: 'all', label: 'All entities' },
                    { value: 'valid', label: 'Only valid' },
                    { value: 'invalid', label: 'Only invalid' },
                  ]}
                  onChange={(value) =>
                    this.onValidityFilterChange(value as ValidityFilter)
                  }
                  size="small"
                />
              </div>
            </label>
            <div className="entities-overview-filter-row">
              <span className="entities-overview-filter-label">Entity type</span>
              <div onKeyDownCapture={(event) => this.stopFilterKeyEvents(event)}>
                <Select
                  className="entities-overview-type-select"
                  mode="multiple"
                  placeholder="All types"
                  value={selectedTypes}
                  options={availableTypes.map((type) => ({ value: type, label: type }))}
                  onChange={(values) => this.onTypeFiltersChange(values)}
                  maxTagCount="responsive"
                  size="small"
                  disabled={availableTypes.length === 0}
                />
              </div>
            </div>
          </div>
          <div
            className={`entities-overview-filter-actions${isAdvanced ? ' is-advanced' : ''}`}
          >
            <div
              className={`entities-overview-advanced-button-wrap${
                isAdvanced ? ' is-visible' : ''
              }`}
            >
              <Button
                className="entities-overview-advanced-button"
                type="default"
                onClick={() => this.openAdvancedDialog()}
                onKeyDownCapture={(event: React.KeyboardEvent) =>
                  this.stopFilterKeyEvents(event)
                }
              >
                Advanced filters
              </Button>
            </div>
            <Button
              className="entities-overview-filter-clear"
              danger
              ghost
              block={!isAdvanced}
              disabled={
                activeFilters.entityNameFilter.trim() === '' &&
                selectedTypes.length === 0 &&
                activeFilters.validityFilter === 'all'
              }
              onClick={() => this.clearFilters()}
              onKeyDownCapture={(event: React.KeyboardEvent) =>
                this.stopFilterKeyEvents(event)
              }
            >
              Clear filters
            </Button>
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
      onClick: (event) => this.handleNodeClick(node, event),
    }
  }

  /**
   * Handle click events on tree nodes.
   * For leaf nodes, this will log the name to the console.
   *
   * @param node the clicked node
   */
  protected handleNodeClick(node: TreeNode, event: React.MouseEvent<HTMLElement>): void {
    if (ExampleTreeNode.is(node)) {
      void this.model.toggleNodeExpansion(node)
      return
    }
    if (ExampleTreeLeaf.is(node)) {
      const entityId = node.data.entityId
      if (entityId && (event.ctrlKey || event.metaKey)) {
        event.stopPropagation()
        event.preventDefault()
        this.model.toggleSelection(entityId)
        console.log('Entities overview ctrl+click:', node)
        console.log('Selected entities: ', this.model.getSelectedEntityIds())
        return
      }

      if (!entityId) return
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

  protected onEntityNameFilterChange(event: React.ChangeEvent<HTMLInputElement>): void {
    this.entityNameSelection = {
      start: event.target.selectionStart,
      end: event.target.selectionEnd,
    }
    this.getActiveFilters().entityNameFilter = event.target.value
    this.applyFilters()
    this.restoreInputSelection(this.entityNameInputRef, this.entityNameSelection)
  }

  protected applyFilters(): void {
    const availableTypes = this.model.getAvailableTypes()
    const activeFilters = this.getActiveFilters()
    const selectedTypes = this.normalizeSelectedTypes(availableTypes, activeFilters)
    this.model.setFilters(
      activeFilters.entityNameFilter,
      selectedTypes,
      activeFilters.validityFilter,
    )
    this.update()
  }

  protected normalizeSelectedTypes(
    availableTypes: string[],
    filters: {
      selectedTypeFilters: string[]
    },
  ): string[] {
    if (availableTypes.length === 0) {
      return []
    }
    const availableSet = new Set(availableTypes)
    const filteredSelections = filters.selectedTypeFilters.filter((type) =>
      availableSet.has(type),
    )
    if (filteredSelections.length !== filters.selectedTypeFilters.length) {
      filters.selectedTypeFilters = [...filteredSelections]
    }
    return availableTypes.filter((type) => filters.selectedTypeFilters.includes(type))
  }

  protected onTypeFiltersChange(values: string[]): void {
    this.getActiveFilters().selectedTypeFilters = [...values]
    this.applyFilters()
  }

  protected onValidityFilterChange(value: ValidityFilter): void {
    this.getActiveFilters().validityFilter = value
    this.applyFilters()
  }

  protected clearFilters(): void {
    const activeFilters = this.getActiveFilters()
    activeFilters.entityNameFilter = ''
    activeFilters.selectedTypeFilters = []
    activeFilters.validityFilter = 'all'
    this.applyFilters()
  }

  protected setFilterMode(mode: 'simple' | 'advanced'): void {
    if (this.filterMode === mode) {
      return
    }
    this.filterMode = mode
    this.applyFilters()
  }

  protected async openAdvancedDialog(): Promise<void> {
    const dialog = new AdvancedFiltersDialog()
    const result = await dialog.open()
    if (result === 'apply') {
      this.applyAdvancedFilters()
    }
  }

  protected applyAdvancedFilters(): void {
    this.applyFilters()
  }

  protected getActiveFilters(): {
    entityNameFilter: string
    selectedTypeFilters: string[]
    validityFilter: ValidityFilter
  } {
    return this.filterMode === 'simple' ? this.simpleFilters : this.advancedFilters
  }

  protected stopFilterKeyEvents(event: React.KeyboardEvent): void {
    event.stopPropagation()
    if (typeof event.nativeEvent.stopImmediatePropagation === 'function') {
      event.nativeEvent.stopImmediatePropagation()
    }
  }

  protected restoreInputSelection(
    inputRef: React.RefObject<HTMLInputElement>,
    selection?: { start: number | null; end: number | null },
  ): void {
    if (!selection) {
      return
    }
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) {
        return
      }
      const { start, end } = selection
      if (start === null || end === null) {
        return
      }
      input.setSelectionRange(start, end)
    })
  }
}
