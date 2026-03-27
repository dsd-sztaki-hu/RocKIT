import { MenuPath } from '@theia/core'
import {
  ApplicationShell,
  CompositeTreeNode,
  ContextMenuRenderer,
  NodeProps,
  TreeModel,
  TreeNode,
  TreeProps,
  TreeWidget,
  Widget,
  WidgetManager,
} from '@theia/core/lib/browser'
import { ThemeService } from '@theia/core/lib/browser/theming'
import { FOCUS_CLASS, SELECTED_CLASS } from '@theia/core/lib/browser/widgets'
import { Disposable } from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { Button, Select } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { MetadataSchemaManager } from 'aroma2-common/lib/browser'
import '../../src/browser/styles/entities-overview-widget.css'
import { AntdThemeProvider } from 'aroma2-common/lib/browser/antd-theme-provider'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'
import {
  EntitiesOverviewModel,
  ExampleTreeLeaf,
  ExampleTreeNode,
  ValidityFilter,
} from './entities-overview-model'
import { AdvancedFiltersDialog } from './entities-overview-advanced-filters-dialog'
import {
  AdvancedEntityMatcher,
  ALL_ENTITY_TYPES_OPTION,
  AdvancedFilterState,
  buildAdvancedEntityMatcher,
  buildAdvancedFilterCatalog,
  countActiveAdvancedRules,
} from './entities-overview-advanced-filtering'
import { MultiEditDialog } from './entities-overview-multi-edit-dialog'

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
  static readonly LABEL = 'Entities'

  /** Used in Drag & Drop code to remember and cancel deferred expansion of hovered nodes */
  // protected readonly toCancelNodeExpansion = new DisposableCollection()

  constructor(
    @inject(TreeProps) public override readonly props: TreeProps,
    @inject(TreeModel) public override readonly model: EntitiesOverviewModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(AppStateService) private readonly appStateService: AppStateService,
    @inject(MetadataSchemaManager)
    private readonly schemaManagerService: MetadataSchemaManager,
    @inject(WidgetManager) private readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) private readonly shell: ApplicationShell,
    @inject(ThemeService) private readonly themeService: ThemeService,
  ) {
    super(props, model, contextMenuRenderer)
    this.shouldScrollToRow = false

    // set the general properties for the view
    this.id = EntitiesOverviewWidget.ID
    this.title.label = EntitiesOverviewWidget.LABEL
    this.title.caption = EntitiesOverviewWidget.LABEL
    this.title.closable = true
    this.title.iconClass = 'fa fa-list-ul'

    // this.toDispose.push(this.toCancelNodeExpansion)
    this.addClass('entities-overview-panel')
    this.filtersVisible = this.appStateService.entitiesOverviewFiltersVisible
    this.syncFiltersVisibleBodyClass()
    this.toDispose.push(
      Disposable.create(() => {
        document.body.classList.remove(this.filtersVisibleBodyClass)
      }),
    )
    this.toDispose.push(
      this.shell.onDidChangeCurrentWidget(({ newValue }) => {
        if (newValue && this.isRoCrateEditorWidget(newValue)) {
          this.markEditorFocused(newValue.id)
        }
      }),
    )
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
  protected filtersVisible = true
  protected readonly filtersVisibleBodyClass = 'entities-overview-filters-visible'
  protected readonly editorFocusOrder: string[] = []
  protected advancedFilterState: AdvancedFilterState | undefined
  protected advancedEntityMatcher: AdvancedEntityMatcher | undefined
  protected advancedRuleCount = 0

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

  protected override renderCaption(node: TreeNode, props: NodeProps): React.ReactNode {
    const attrs = this.getCaptionAttributes(node, props)
    const children = this.getCaptionChildren(node, props)

    const isLeafInvalid = ExampleTreeLeaf.is(node) && node.data.valid === false
    const isNodeInvalid = ExampleTreeNode.is(node) && this.hasInvalidDescendant(node)
    const showInvalidIcon = isLeafInvalid || isNodeInvalid

    if (showInvalidIcon) {
      const className =
        `${attrs.className ?? ''} entities-overview-invalid-caption`.trim()
      const containerTitle = isLeafInvalid ? 'Invalid entity' : 'Contains invalid entity'
      return (
        <div {...attrs} className={className} title={containerTitle}>
          <span
            className="entities-overview-invalid-icon fa fa-exclamation-triangle"
            role="img"
            aria-label={isLeafInvalid ? 'Invalid entity' : 'Contains invalid entity'}
            title={isLeafInvalid ? 'Invalid entity' : 'Contains invalid entity'}
          />
          {children}
        </div>
      )
    }

    return React.createElement('div', attrs, children)
  }

  protected hasInvalidDescendant(node: ExampleTreeNode): boolean {
    for (const child of node.children) {
      if (ExampleTreeLeaf.is(child)) {
        if (child.data.valid === false) {
          return true
        }
        continue
      }
      if (ExampleTreeNode.is(child) && this.hasInvalidDescendant(child)) {
        return true
      }
    }
    return false
  }

  protected override scrollToSelected(): void {
    // Selection visuals in this widget are driven by entity ids rather than the tree model
    // selection service. The base implementation scrolls to the first selected DOM row,
    // which can jump the viewport unexpectedly for large/virtualized lists.
  }

  protected override render(): React.ReactNode {
    const availableTypes = this.model.getAvailableTypes()
    const activeFilters = this.getActiveFilters()
    const selectedTypes = this.normalizeSelectedTypes(availableTypes, activeFilters)
    const isAdvanced = this.filterMode === 'advanced'
    const showFilters = this.filtersVisible
    const isSimpleClearDisabled =
      activeFilters.entityNameFilter.trim() === '' &&
      selectedTypes.length === 0 &&
      activeFilters.validityFilter === 'all'
    const isAdvancedClearDisabled =
      !this.advancedEntityMatcher &&
      this.advancedFilters.selectedTypeFilters.length === 0 &&
      this.advancedFilters.entityNameFilter.trim() === '' &&
      this.advancedFilters.validityFilter === 'all'
    return (
      <AntdThemeProvider themeService={this.themeService}>
        <div className="entities-overview-panel-content">
          <div
            className={`entities-overview-filters${showFilters ? '' : ' is-hidden'}`}
            aria-hidden={!showFilters}
          >
            <div className="entities-overview-filter-header">
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
                    classNames={{ popup: { root: 'entities-overview-filter-dropdown' } }}
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
                    classNames={{ popup: { root: 'entities-overview-filter-dropdown' } }}
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
                  {this.advancedRuleCount > 0
                    ? `Advanced filters (${this.advancedRuleCount})`
                    : 'Advanced filters'}
                </Button>
              </div>
              <Button
                className="entities-overview-filter-clear"
                danger
                ghost
                disabled={isAdvanced ? isAdvancedClearDisabled : isSimpleClearDisabled}
                onClick={() => this.clearFilters()}
                onKeyDownCapture={(event: React.KeyboardEvent) =>
                  this.stopFilterKeyEvents(event)
                }
              >
                Clear filters
              </Button>
            </div>
          </div>
          <div
            className="entities-overview-edit-row"
            onClick={(event) => this.handleEditRowClick(event)}
          >
            <Button
              className="entities-overview-edit-button"
              type="default"
              onClick={() => this.openMultiEditDialog()}
              onKeyDownCapture={(event: React.KeyboardEvent) =>
                this.stopFilterKeyEvents(event)
              }
            >
              Edit
            </Button>
          </div>
          <div {...this.createContainerAttributes()}>{this.renderTree(this.model)}</div>
        </div>
      </AntdThemeProvider>
    )
  }

  isFiltersVisible(): boolean {
    return this.filtersVisible
  }

  toggleFiltersVisibility(): void {
    this.filtersVisible = !this.filtersVisible
    this.appStateService.entitiesOverviewFiltersVisible = this.filtersVisible
    this.syncFiltersVisibleBodyClass()
    this.update()
  }

  async collapseAllEntityNodes(): Promise<void> {
    const root = this.model.root
    if (!root || !CompositeTreeNode.is(root)) {
      return
    }
    for (const child of root.children) {
      if (ExampleTreeNode.is(child)) {
        await this.model.collapseAll(child)
      }
    }
  }

  protected syncFiltersVisibleBodyClass(): void {
    document.body.classList.toggle(this.filtersVisibleBodyClass, this.filtersVisible)
  }

  protected override createContainerAttributes(): React.HTMLAttributes<HTMLElement> {
    const attributes = super.createContainerAttributes()
    const existingOnClick = attributes.onClick
    return {
      ...attributes,
      onClick: (event) => {
        if (typeof existingOnClick === 'function') {
          existingOnClick(event)
        }
        const target = event.target as HTMLElement
        if (target.closest('.theia-TreeNode')) {
          return
        }
        this.model.clearSelection()
      },
    }
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
    if (ExampleTreeLeaf.is(node) && node.data.selected) {
      classNames.push('entities-overview-leaf-selected')
      classNames.push(SELECTED_CLASS)
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
      onDoubleClick: (event) => this.handleNodeDoubleClick(node, event),
    }
  }

  /**
   * Handle click events on tree nodes.
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
      if (!entityId) {
        console.warn('EntitiesOverviewWidget: missing entityId for selection')
        return
      }
      event.stopPropagation()
      event.preventDefault()
      if (event.shiftKey) {
        this.model.selectRangeTo(entityId)
        return
      }
      if (event.ctrlKey || event.metaKey) {
        this.model.toggleSelection(entityId)
        return
      }
      this.model.selectSingle(entityId)
      if (event.altKey) {
        void this.openRoCrateEditorForEntity(entityId, { forceNewWindow: true })
      }
    }
  }

  protected handleNodeDoubleClick(
    node: TreeNode,
    event: React.MouseEvent<HTMLElement>,
  ): void {
    if (!ExampleTreeLeaf.is(node)) {
      return
    }
    const entityId = node.data.entityId
    if (!entityId) {
      console.warn('EntitiesOverviewWidget: missing entityId for open')
      return
    }
    event.stopPropagation()
    event.preventDefault()
    if (event.altKey || event.shiftKey) {
      return
    }
    this.model.selectSingle(entityId)
    void this.openRoCrateEditorForEntity(entityId)
  }

  protected handleEditRowClick(event: React.MouseEvent<HTMLElement>): void {
    const target = event.target as HTMLElement | null
    if (target?.closest('.entities-overview-edit-button')) {
      return
    }
    this.model.clearSelection()
  }

  protected async openRoCrateEditorForEntity(
    entityId: string,
    options?: { forceNewWindow?: boolean },
  ): Promise<void> {
    if (!entityId) {
      console.warn('EntitiesOverviewWidget: attempted to open editor without entityId')
      return
    }
    const forceNewWindow = options?.forceNewWindow === true
    // Keep deduplication for regular open/focus flow, but allow repeated Alt+click
    // to open multiple windows for the same entity without waiting for initialization.
    const dedupeByEntity = !forceNewWindow
    if (dedupeByEntity && this.openingEntities.has(entityId)) {
      return
    }
    if (dedupeByEntity) {
      this.openingEntities.add(entityId)
    }
    const prevSelected = this.appStateService.selectedEntityId
    if (prevSelected !== entityId) {
      this.appStateService.selectedEntityId = entityId
    }
    try {
      if (!forceNewWindow) {
        const existingWidgetId = this.findWidgetIdForEntity(entityId)
        if (existingWidgetId) {
          this.appStateService.registerEntityEditor(existingWidgetId, entityId)
          await this.shell.activateWidget(existingWidgetId)
          this.markEditorFocused(existingWidgetId)
          return
        }

        const lastFocusedEditor = this.getPreferredRoCrateEditorWidget()
        if (lastFocusedEditor) {
          this.appStateService.registerEntityEditor(lastFocusedEditor.id, entityId)
          await this.shell.activateWidget(lastFocusedEditor.id)
          this.markEditorFocused(lastFocusedEditor.id)
          return
        }
      }

      const instanceId = `${RoCrateEditorWidget.ID}:${Math.random().toString(36).slice(2)}`

      const widget = await this.widgetManager.getOrCreateWidget(RoCrateEditorWidget.ID, {
        instanceId,
        entityId,
      })

      const addOptions: {
        area: 'main'
        mode?: 'split-right' | 'tab-after'
        ref?: Widget
      } = { area: 'main' }
      const referenceEditor = this.getPreferredRoCrateEditorWidget()
      if (referenceEditor) {
        if (forceNewWindow) {
          const rightmostInRecentContainer =
            this.getRightmostWidgetInSameTabBar(referenceEditor) ?? referenceEditor
          addOptions.mode = 'tab-after'
          addOptions.ref = rightmostInRecentContainer
        } else {
          addOptions.mode = 'split-right'
          addOptions.ref = referenceEditor
        }
      }

      await this.shell.addWidget(widget, addOptions)
      this.appStateService.registerEntityEditor(widget.id, entityId)
      await this.shell.activateWidget(widget.id)
      this.markEditorFocused(widget.id)
    } catch (error) {
      console.error('EntitiesOverviewWidget: failed to open editor', { entityId, error })
    } finally {
      if (dedupeByEntity) {
        this.openingEntities.delete(entityId)
      }
    }
  }

  protected findWidgetIdForEntity(entityId: string): string | undefined {
    const mapping = this.appStateService.EIRCEIA ?? {}
    const matchingIds = Object.entries(mapping)
      .filter(([, mappedEntityId]) => mappedEntityId === entityId)
      .map(([widgetId]) => widgetId)
      .filter((widgetId) => Boolean(this.shell.getWidgetById(widgetId)))
    if (matchingIds.length === 0) {
      return undefined
    }

    for (let index = this.editorFocusOrder.length - 1; index >= 0; index -= 1) {
      const widgetId = this.editorFocusOrder[index]
      if (matchingIds.includes(widgetId)) {
        return widgetId
      }
    }
    return matchingIds[0]
  }

  protected isRoCrateEditorWidget(widget: Widget): boolean {
    return widget.id.startsWith(RoCrateEditorWidget.ID)
  }

  protected markEditorFocused(widgetId: string): void {
    const index = this.editorFocusOrder.indexOf(widgetId)
    if (index >= 0) {
      this.editorFocusOrder.splice(index, 1)
    }
    this.editorFocusOrder.push(widgetId)
  }

  protected getPreferredRoCrateEditorWidget(): Widget | undefined {
    for (let index = this.editorFocusOrder.length - 1; index >= 0; index -= 1) {
      const widgetId = this.editorFocusOrder[index]
      const widget = this.shell.getWidgetById(widgetId)
      if (widget && this.isRoCrateEditorWidget(widget)) {
        return widget
      }
      this.editorFocusOrder.splice(index, 1)
    }

    const active = this.shell.activeWidget ?? this.shell.currentWidget
    if (active && this.isRoCrateEditorWidget(active)) {
      return active
    }

    for (const widget of this.shell.getWidgets('main')) {
      if (this.isRoCrateEditorWidget(widget)) {
        return widget
      }
    }

    return undefined
  }

  protected getRightmostWidgetInSameTabBar(widget: Widget): Widget | undefined {
    const tabBar = this.shell.getTabBarFor(widget)
    if (!tabBar || tabBar.titles.length === 0) {
      return undefined
    }
    return tabBar.titles[tabBar.titles.length - 1].owner
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
    this.model.setAdvancedEntityMatcher(
      this.filterMode === 'advanced' ? this.advancedEntityMatcher : undefined,
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
    if (this.filterMode === 'advanced') {
      this.advancedFilterState = undefined
      this.advancedEntityMatcher = undefined
      this.advancedRuleCount = 0
    }
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
    const profile = this.appStateService.completeProfile ?? this.appStateService.profile
    const catalog = buildAdvancedFilterCatalog(this.appStateService.roCrate, profile)
    const availableTypes = this.model.getAvailableTypes()
    const dialog = new AdvancedFiltersDialog(
      catalog,
      this.advancedFilterState,
      availableTypes,
      this.appStateService.roCrate,
    )
    const result = await dialog.open()
    if (result) {
      this.advancedFilterState = result
      this.advancedFilters.selectedTypeFilters =
        result.selectedEntityType === ALL_ENTITY_TYPES_OPTION
          ? []
          : [result.selectedEntityType]
      this.advancedEntityMatcher = buildAdvancedEntityMatcher(
        result,
        catalog,
        this.appStateService.roCrate,
      )
      this.advancedRuleCount = countActiveAdvancedRules(result, catalog)
      this.applyAdvancedFilters()
    }
  }

  protected async openMultiEditDialog(): Promise<void> {
    const selectedEntityIds = this.model.getSelectedEntityIds()
    const entityIds =
      selectedEntityIds.length > 0 ? selectedEntityIds : this.model.getVisibleEntityIds()
    const dialog = new MultiEditDialog(
      entityIds,
      this.appStateService,
      this.schemaManagerService,
    )
    await dialog.open()
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
