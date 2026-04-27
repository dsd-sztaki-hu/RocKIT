import { MenuPath } from '@theia/core'
import {
  ApplicationShell,
  CompositeTreeNode,
  ContextMenuRenderer,
  NodeProps,
  SelectableTreeNode,
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
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
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

type PersistedEntityFilters = {
  entityNameFilter: string
  selectedTypeFilters: string[]
  validityFilter: ValidityFilter
}

type EntitiesOverviewWidgetState = {
  version: 2
  filtersVisible?: boolean
  filterMode?: 'simple' | 'advanced'
  simpleFilters?: PersistedEntityFilters
  advancedFilters?: PersistedEntityFilters
}

/** Implementation of the Tree Widget */
@injectable()
export class EntitiesOverviewWidget extends TreeWidget {
  /** The ID of the view */
  static readonly ID = 'theia-examples:treeview-example-view'
  /** The label of the view */
  static readonly LABEL = 'Entities'
  static readonly STATE_VERSION = 2
  static readonly MAX_PERSISTED_STATE_BYTES = 16 * 1024
  static readonly MAX_FILTER_TEXT_LENGTH = 1024
  static readonly MAX_SELECTED_TYPES = 200
  static readonly MAX_TYPE_LABEL_LENGTH = 256
  static readonly ROOT_DATASET_ENTITY_ID = './'

  /** Used in Drag & Drop code to remember and cancel deferred expansion of hovered nodes */
  // protected readonly toCancelNodeExpansion = new DisposableCollection()

  constructor(
    @inject(TreeProps) public override readonly props: TreeProps,
    @inject(TreeModel) public override readonly model: EntitiesOverviewModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(AppStateService) private readonly appStateService: AppStateService,
    @inject(RoCrateHistoryService)
    private readonly roCrateHistoryService: RoCrateHistoryService,
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

  override storeState(): object {
    const safeState: EntitiesOverviewWidgetState = {
      version: EntitiesOverviewWidget.STATE_VERSION,
      filtersVisible: this.filtersVisible,
      filterMode: this.filterMode,
      simpleFilters: this.sanitizeFiltersForStorage(this.simpleFilters),
      advancedFilters: this.sanitizeFiltersForStorage(this.advancedFilters),
    }
    const serializedSize = this.getSerializedSizeInBytes(safeState)
    if (
      serializedSize === undefined ||
      serializedSize > EntitiesOverviewWidget.MAX_PERSISTED_STATE_BYTES
    ) {
      console.warn(
        'EntitiesOverviewWidget: skipping large/invalid widget state persistence',
        { serializedSize },
      )
      return {
        version: EntitiesOverviewWidget.STATE_VERSION,
        filtersVisible: this.filtersVisible,
      }
    }
    return safeState
  }

  override restoreState(oldState: object): void {
    if (!oldState || typeof oldState !== 'object') {
      return
    }
    const rawState = oldState as Record<string, unknown>

    // Reject legacy TreeWidget snapshots containing serialized tree/model payload.
    if ('root' in rawState || 'model' in rawState || 'decorations' in rawState) {
      console.warn(
        'EntitiesOverviewWidget: discarded legacy persisted tree snapshot state',
      )
      return
    }

    const serializedSize = this.getSerializedSizeInBytes(rawState)
    if (
      serializedSize === undefined ||
      serializedSize > EntitiesOverviewWidget.MAX_PERSISTED_STATE_BYTES
    ) {
      console.warn(
        'EntitiesOverviewWidget: discarded oversized persisted widget state',
        { serializedSize },
      )
      return
    }

    if (typeof rawState.filtersVisible === 'boolean') {
      this.filtersVisible = rawState.filtersVisible
      this.appStateService.entitiesOverviewFiltersVisible = rawState.filtersVisible
      this.syncFiltersVisibleBodyClass()
    }

    if (rawState.filterMode === 'simple' || rawState.filterMode === 'advanced') {
      this.filterMode = rawState.filterMode
    }

    const simple = this.readFiltersFromStorage(rawState.simpleFilters)
    if (simple) {
      this.simpleFilters.entityNameFilter = simple.entityNameFilter
      this.simpleFilters.selectedTypeFilters = simple.selectedTypeFilters
      this.simpleFilters.validityFilter = simple.validityFilter
    }

    const advanced = this.readFiltersFromStorage(rawState.advancedFilters)
    if (advanced) {
      this.advancedFilters.entityNameFilter = advanced.entityNameFilter
      this.advancedFilters.selectedTypeFilters = advanced.selectedTypeFilters
      this.advancedFilters.validityFilter = advanced.validityFilter
    }

    this.applyFilters()
  }

  protected sanitizeFiltersForStorage(filters: {
    entityNameFilter: string
    selectedTypeFilters: string[]
    validityFilter: ValidityFilter
  }): PersistedEntityFilters {
    const entityNameFilter =
      typeof filters.entityNameFilter === 'string'
        ? filters.entityNameFilter.slice(0, EntitiesOverviewWidget.MAX_FILTER_TEXT_LENGTH)
        : ''
    const selectedTypeFilters = Array.from(
      new Set(
        (Array.isArray(filters.selectedTypeFilters) ? filters.selectedTypeFilters : [])
          .filter((type): type is string => typeof type === 'string')
          .map((type) => type.trim())
          .filter((type) => type.length > 0)
          .map((type) => type.slice(0, EntitiesOverviewWidget.MAX_TYPE_LABEL_LENGTH)),
      ).values(),
    ).slice(0, EntitiesOverviewWidget.MAX_SELECTED_TYPES)
    const validityFilter =
      filters.validityFilter === 'valid' ||
      filters.validityFilter === 'invalid' ||
      filters.validityFilter === 'all'
        ? filters.validityFilter
        : 'all'
    return { entityNameFilter, selectedTypeFilters, validityFilter }
  }

  protected readFiltersFromStorage(value: unknown): PersistedEntityFilters | undefined {
    if (!value || typeof value !== 'object') {
      return undefined
    }
    const raw = value as Partial<PersistedEntityFilters>
    return this.sanitizeFiltersForStorage({
      entityNameFilter: raw.entityNameFilter ?? '',
      selectedTypeFilters: raw.selectedTypeFilters ?? [],
      validityFilter: raw.validityFilter ?? 'all',
    })
  }

  protected getSerializedSizeInBytes(value: unknown): number | undefined {
    try {
      const serialized = JSON.stringify(value)
      return serialized ? serialized.length * 2 : 0
    } catch {
      return undefined
    }
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
    const existingOnKeyDown = attributes.onKeyDown
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
      onKeyDown: (event) => {
        if (typeof existingOnKeyDown === 'function') {
          existingOnKeyDown(event)
        }
        if (event.defaultPrevented || event.key !== 'Delete') {
          return
        }
        if (this.shouldIgnoreDeleteKeyEvent(event.target as HTMLElement | null)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        void this.deleteSelectedEntities()
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
    if (node && ExampleTreeLeaf.is(node)) {
      const entityId = node.data.entityId
      if (entityId) {
        const selectedIds = new Set(this.model.getSelectedEntityIds())
        if (!selectedIds.has(entityId)) {
          this.model.selectSingle(entityId)
        }
      }
      this.renderNodeContextMenu(node, event)
      return
    }
    if (node && ExampleTreeNode.is(node)) {
      this.renderNodeContextMenu(node, event)
      return
    }
    super.handleContextMenuEvent(node, event)
  }

  protected renderNodeContextMenu(
    node: TreeNode,
    event: React.MouseEvent<HTMLElement>,
  ): void {
    const contextMenuPath = this.props.contextMenuPath
    if (contextMenuPath) {
      const { x, y } = event.nativeEvent
      const args = SelectableTreeNode.is(node) ? this.toContextMenuArgs(node) : [node]
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
      this.roCrateHistoryService,
    )
    await dialog.open()
  }

  public canOpenEditFromContextMenu(): boolean {
    return this.model.getSelectedEntityIds().length > 0
  }

  public async openEditFromContextMenu(): Promise<void> {
    if (!this.canOpenEditFromContextMenu()) {
      return
    }
    await this.openMultiEditDialog()
  }

  public canDeleteFromContextMenu(): boolean {
    return this.getDeletableSelectedEntityIds().length > 0
  }

  public async deleteFromContextMenu(): Promise<void> {
    await this.deleteSelectedEntities()
  }

  protected async deleteSelectedEntities(): Promise<void> {
    const crate = this.appStateService.roCrate
    const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : undefined
    if (!crate || !graph) {
      return
    }

    const deletableEntityIds = this.getDeletableSelectedEntityIds()
    if (deletableEntityIds.length === 0) {
      return
    }

    const idsToRemove = this.resolveCascadeDeletionIds(
      graph,
      new Set(deletableEntityIds),
    )
    const updatedGraph = this.removeEntitiesAndReferences(graph, idsToRemove)
    const updatedCrate = { ...crate, '@graph': updatedGraph }
    const label = idsToRemove.size > 1 ? 'Delete entities' : 'Delete entity'
    const changed = this.roCrateHistoryService.applyRoCrateChange(updatedCrate, { label })
    if (!changed) {
      return
    }

    const selectedEntityId = this.appStateService.selectedEntityId
    if (selectedEntityId && idsToRemove.has(selectedEntityId)) {
      this.appStateService.selectedEntityId = EntitiesOverviewWidget.ROOT_DATASET_ENTITY_ID
    }
    this.model.clearSelection()
  }

  protected getDeletableSelectedEntityIds(): string[] {
    return this.model
      .getSelectedEntityIds()
      .filter((entityId) => entityId !== EntitiesOverviewWidget.ROOT_DATASET_ENTITY_ID)
  }

  protected resolveCascadeDeletionIds(
    graph: ReadonlyArray<Record<string, any>>,
    initialIdsToRemove: ReadonlySet<string>,
  ): Set<string> {
    const entityIds = new Set(
      graph
        .map((entity) => (typeof entity?.['@id'] === 'string' ? entity['@id'] : undefined))
        .filter((entityId): entityId is string => Boolean(entityId)),
    )
    const idsToRemove = new Set(
      Array.from(initialIdsToRemove).filter(
        (entityId) =>
          entityId !== EntitiesOverviewWidget.ROOT_DATASET_ENTITY_ID &&
          entityIds.has(entityId),
      ),
    )
    if (idsToRemove.size === 0) {
      return idsToRemove
    }

    const referrersByEntityId = this.buildReferrersByEntityId(graph, entityIds)
    let changed = true
    while (changed) {
      changed = false
      for (const entityId of entityIds) {
        if (
          entityId === EntitiesOverviewWidget.ROOT_DATASET_ENTITY_ID ||
          idsToRemove.has(entityId)
        ) {
          continue
        }

        const referrers = referrersByEntityId.get(entityId)
        if (!referrers || referrers.size === 0) {
          continue
        }
        const remainingReferrers = Array.from(referrers).filter(
          (referrerId) => !idsToRemove.has(referrerId),
        )
        if (remainingReferrers.length === 0) {
          idsToRemove.add(entityId)
          changed = true
        }
      }
    }

    return idsToRemove
  }

  protected buildReferrersByEntityId(
    graph: ReadonlyArray<Record<string, any>>,
    entityIds: ReadonlySet<string>,
  ): Map<string, Set<string>> {
    const referrersByEntityId = new Map<string, Set<string>>()
    for (const entity of graph) {
      const sourceId = typeof entity?.['@id'] === 'string' ? entity['@id'] : undefined
      if (!sourceId) {
        continue
      }

      const referencedEntityIds = new Set<string>()
      for (const [key, value] of Object.entries(entity)) {
        if (key === '@id' || key === 'id') {
          continue
        }
        this.collectReferencedEntityIds(value, entityIds, referencedEntityIds)
      }

      for (const targetId of referencedEntityIds) {
        if (targetId === sourceId) {
          continue
        }
        const referrers = referrersByEntityId.get(targetId) ?? new Set<string>()
        referrers.add(sourceId)
        referrersByEntityId.set(targetId, referrers)
      }
    }
    return referrersByEntityId
  }

  protected collectReferencedEntityIds(
    value: unknown,
    entityIds: ReadonlySet<string>,
    referencedEntityIds: Set<string>,
  ): void {
    if (typeof value === 'string') {
      if (entityIds.has(value)) {
        referencedEntityIds.add(value)
      }
      return
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.collectReferencedEntityIds(item, entityIds, referencedEntityIds)
      }
      return
    }

    if (value && typeof value === 'object') {
      const objectValue = value as Record<string, unknown>
      const referenceId = this.extractReferenceId(objectValue)
      if (referenceId && entityIds.has(referenceId)) {
        referencedEntityIds.add(referenceId)
      }
      for (const [key, child] of Object.entries(objectValue)) {
        if (key === '@id' || key === 'id') {
          continue
        }
        this.collectReferencedEntityIds(child, entityIds, referencedEntityIds)
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

  protected shouldIgnoreDeleteKeyEvent(target: HTMLElement | null): boolean {
    if (!target) {
      return false
    }
    return Boolean(
      target.closest(
        'input, textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
      ),
    )
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
