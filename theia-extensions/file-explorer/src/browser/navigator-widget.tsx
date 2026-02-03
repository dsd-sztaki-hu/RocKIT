import { environment, isOSX } from '@theia/core'
import {
  CompositeTreeNode,
  ContextMenuRenderer,
  ExpandableTreeNode,
  Key,
  NodeProps,
  TreeModel,
  TreeNode,
  TreeProps,
} from '@theia/core/lib/browser'
import { CommandService } from '@theia/core/lib/common'
import { nls } from '@theia/core/lib/common/nls'
import URI from '@theia/core/lib/common/uri'
import { Message } from '@theia/core/shared/@lumino/messaging'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { DirNode, FileStatNode, FileStatNodeData } from '@theia/filesystem/lib/browser'
import { WorkspaceCommands, WorkspaceService } from '@theia/workspace/lib/browser'
import { Button, Select } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { AbstractNavigatorTreeWidget } from './abstract-navigator-tree-widget'
import { NavigatorContextKeyService } from './navigator-context-key-service'
import { FileNavigatorFilter } from './navigator-filter'
import { FileNavigatorModel } from './navigator-model'
import { WorkspaceNode, WorkspaceRootNode } from './navigator-tree'

export const FILE_NAVIGATOR_ID = 'files'
export const LABEL = nls.localizeByDefault('No Folder Opened')
export const CLASS = 'theia-Files'

@injectable()
export class FileNavigatorWidget extends AbstractNavigatorTreeWidget {
  @inject(CommandService) protected readonly commandService: CommandService
  @inject(NavigatorContextKeyService)
  protected readonly contextKeyService: NavigatorContextKeyService
  @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
  @inject(AppStateService) protected readonly appStateService: AppStateService
  @inject(FileNavigatorFilter) protected readonly fileNavigatorFilter: FileNavigatorFilter

  protected readonly filters: {
    fileNameFilter: string
    roCrateFilter: FileNavigatorFilter.RoCrateFilter
  } = {
    fileNameFilter: '',
    roCrateFilter: 'all',
  }

  constructor(
    @inject(TreeProps) props: TreeProps,
    @inject(FileNavigatorModel) override readonly model: FileNavigatorModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
  ) {
    super(props, model, contextMenuRenderer)
    this.id = FILE_NAVIGATOR_ID
    this.addClass(CLASS)
  }

  @postConstruct()
  protected override init(): void {
    super.init()

    // This ensures that the context menu command to hide this widget receives the label 'Folders'
    // regardless of the name of workspace. See ViewContainer.updateToolbarItems.
    const dataset = {
      ...this.title.dataset,
      visibilityCommandLabel: nls.localizeByDefault('Folders'),
    }
    this.title.dataset = dataset

    this.updateSelectionContextKeys()

    this.toDispose.pushAll([
      this.model.onSelectionChanged(() => this.updateSelectionContextKeys()),
      this.model.onExpansionChanged((node) => {
        if (node.expanded && node.children.length === 1) {
          const child = node.children[0]
          if (ExpandableTreeNode.is(child) && !child.expanded) {
            this.model.expandNode(child)
          }
        }
      }),
      // refresh when crate changes (highlighting depends on it)
      this.appStateService.onDidChangeSelector((state) => state.roCrate)((_) => {
        void this.model.refresh()
        this.update()
      }),
      this.workspaceService.onWorkspaceChanged(() => {
        void this.model.refresh()
      }),
    ])
  }

  protected override doUpdateRows(): void {
    super.doUpdateRows()
    this.title.label = LABEL
    if (WorkspaceNode.is(this.model.root)) {
      if (this.model.root.name === WorkspaceNode.name) {
        const rootNode = this.model.root.children[0]
        if (WorkspaceRootNode.is(rootNode)) {
          this.title.label = this.toNodeName(rootNode)
          this.title.caption = this.labelProvider.getLongName(rootNode.uri)
        }
      } else {
        this.title.label = this.toNodeName(this.model.root)
        this.title.caption = this.title.label
      }
    } else {
      this.title.caption = this.title.label
    }
  }

  override getContainerTreeNode(): TreeNode | undefined {
    const root = this.model.root
    if (this.workspaceService.isMultiRootWorkspaceOpened) {
      return root
    }
    if (WorkspaceNode.is(root)) {
      return root.children[0]
    }
    return undefined
  }

  protected override renderTree(model: TreeModel): React.ReactNode {
    if (this.model.root && this.isEmptyMultiRootWorkspace(model)) {
      return this.renderEmptyMultiRootWorkspace()
    }
    return super.renderTree(model)
  }

  protected override render(): React.ReactNode {
    const hasActiveFilters =
      this.filters.fileNameFilter.trim() !== '' || this.filters.roCrateFilter !== 'all'

    return (
      <div className="navigator-filter-panel">
        <div className="navigator-filters">
          <div className="navigator-filter-header">
            <span className="navigator-filter-title">Filters</span>
          </div>

          <div className="navigator-filter-fields">
            <label className="navigator-filter-row">
              <span className="navigator-filter-label">File name</span>
              <input
                className="navigator-filter-input"
                type="text"
                placeholder="Search file name"
                value={this.filters.fileNameFilter}
                onChange={(event) => this.onFileNameFilterChange(event)}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </label>

            <label className="navigator-filter-row">
              <span className="navigator-filter-label">RO-Crate descriptions</span>
              <div onKeyDown={(event) => event.stopPropagation()}>
                <Select
                  className="navigator-rocrate-select"
                  value={this.filters.roCrateFilter}
                  options={[
                    { value: 'all', label: 'All files' },
                    { value: 'with-description', label: 'With RO-Crate description' },
                    {
                      value: 'without-description',
                      label: 'Missing RO-Crate description',
                    },
                  ]}
                  onChange={(value) =>
                    this.onRoCrateFilterChange(value as FileNavigatorFilter.RoCrateFilter)
                  }
                  size="small"
                />
              </div>
            </label>
          </div>

          <div className="navigator-filter-actions">
            <Button
              className="navigator-filter-clear"
              danger
              ghost
              block
              disabled={!hasActiveFilters}
              onClick={() => this.clearFilters()}
              onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) =>
                event.stopPropagation()
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
        this.focusService.setFocus(undefined)
      },
    }
  }

  protected override shouldShowWelcomeView(): boolean {
    return this.model.root === undefined
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.addClipboardListener(this.node, 'copy', (e) => this.handleCopy(e))
    this.addClipboardListener(this.node, 'paste', (e) => this.handlePaste(e))
  }

  protected handleCopy(event: ClipboardEvent): void {
    const uris = this.model.selectedFileStatNodes.map((node) => node.uri.toString())
    if (uris.length > 0 && event.clipboardData) {
      event.clipboardData.setData('text/plain', uris.join('\n'))
      event.preventDefault()
    }
  }

  protected handlePaste(event: ClipboardEvent): void {
    if (event.clipboardData) {
      const raw = event.clipboardData.getData('text/plain')
      if (!raw) {
        return
      }
      const target = this.model.selectedFileStatNodes[0]
      if (!target) {
        return
      }
      for (const file of raw.split('\n')) {
        event.preventDefault()
        const source = new URI(file)
        this.model.copy(source, target)
      }
    }
  }

  protected canOpenWorkspaceFileAndFolder: boolean = isOSX || !environment.electron.is()

  protected readonly openWorkspace = () => this.doOpenWorkspace()
  protected doOpenWorkspace(): void {
    this.commandService.executeCommand(WorkspaceCommands.OPEN_WORKSPACE.id)
  }

  protected readonly openFolder = () => this.doOpenFolder()
  protected doOpenFolder(): void {
    this.commandService.executeCommand(WorkspaceCommands.OPEN_FOLDER.id)
  }

  protected readonly addFolder = () => this.doAddFolder()
  protected doAddFolder(): void {
    this.commandService.executeCommand(WorkspaceCommands.ADD_FOLDER.id)
  }

  protected readonly keyUpHandler = (e: React.KeyboardEvent) => {
    if (Key.ENTER.keyCode === e.keyCode) {
      ;(e.target as HTMLElement).click()
    }
  }

  /**
   * When a multi-root workspace is opened, a user can remove all the folders from it.
   * Instead of displaying an empty navigator tree, this will show a button to add more folders.
   */
  protected renderEmptyMultiRootWorkspace(): React.ReactNode {
    return (
      <div className="theia-navigator-container">
        <div className="center">
          {nls.localizeByDefault(
            'You have not yet added a folder to the workspace.\n{0}',
            '',
          )}
        </div>
        <div className="open-workspace-button-container">
          <button
            className="theia-button open-workspace-button"
            title={nls.localizeByDefault('Add Folder to Workspace')}
            onClick={this.addFolder}
            onKeyUp={this.keyUpHandler}
          >
            {nls.localizeByDefault('Open Folder')}
          </button>
        </div>
      </div>
    )
  }

  protected isEmptyMultiRootWorkspace(model: TreeModel): boolean {
    return WorkspaceNode.is(model.root) && model.root.children.length === 0
  }

  protected override tapNode(node?: TreeNode): void {
    if (FileStatNode.is(node)) {
      this.model.selectNode(node)
    }
    // DO NOT call this.model.previewNode(node) here.
    super.tapNode(node)
  }

  protected override onAfterShow(msg: Message): void {
    super.onAfterShow(msg)
    this.contextKeyService.explorerViewletVisible.set(true)
  }

  protected override onAfterHide(msg: Message): void {
    super.onAfterHide(msg)
    this.contextKeyService.explorerViewletVisible.set(false)
  }

  protected updateSelectionContextKeys(): void {
    this.contextKeyService.explorerResourceIsFolder.set(
      DirNode.is(this.model.selectedNodes[0]),
    )
    this.contextKeyService.isFileSystemResource.set(
      FileStatNodeData.is(this.model.selectedNodes[0]),
    )
  }

  /**
   * Overrides the method from FileTreeWidget to add custom CSS classes.
   */
  protected override createNodeAttributes(
    node: TreeNode,
    props: NodeProps,
  ): React.Attributes & React.HTMLAttributes<HTMLElement> {
    const attributes = super.createNodeAttributes(node, props)

    if (FileStatNode.is(node) && this.shouldHighlightFile(node)) {
      const existingClassName = attributes.className || ''
      attributes.className = `${existingClassName} not-in-ro-crate`.trim()
    }

    if (DirNode.is(node) && this.containsNotInRoCrate(node)) {
      const existingClassName = attributes.className || ''
      attributes.className = `${existingClassName} contains-not-in-ro-crate`.trim()
    }

    return attributes
  }

  private containsNotInRoCrate(node: TreeNode): boolean {
    if (FileStatNode.is(node) && this.shouldHighlightFile(node)) {
      return true
    }

    if (CompositeTreeNode.is(node) && node.children) {
      for (const child of node.children) {
        if (this.containsNotInRoCrate(child)) {
          return true
        }
      }
    }
    return false
  }

  /**
   * 26606 behavior: highlight files NOT present in RO-Crate by PATH (derived from @id).
   * (No dropdown gating. No description logic.)
   */
  private shouldHighlightFile(node: FileStatNode): boolean {
    const { files, directories } = this.getRoCrateEntityPathIndex()
    if (files.size === 0 && directories.length === 0) {
      return false
    }

    const relativePath = this.getNodeWorkspaceRelativePath(node)
    if (!relativePath) {
      return false
    }

    // file entity exists
    if (files.has(relativePath)) {
      return false
    }

    // file is under a directory entity
    for (const directory of directories) {
      if (!directory) {
        continue
      }
      if (relativePath === directory || relativePath.startsWith(`${directory}/`)) {
        return false
      }
    }

    return true
  }

  private getNodeWorkspaceRelativePath(node: FileStatNode): string | undefined {
    const rootUri = this.workspaceService.getWorkspaceRootUri(node.uri)
    if (!rootUri) {
      return undefined
    }
    const relative = rootUri.relative(node.uri)
    if (!relative) {
      return undefined
    }
    const normalized = this.normalizeRelativePath(relative.toString())
    return normalized ? normalized.toLowerCase() : undefined
  }

  private getRoCrateEntityPathIndex(): { files: Set<string>; directories: string[] } {
    const crate = this.appStateService.roCrate
    if (!crate) {
      return { files: new Set(), directories: [] }
    }

    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const files = new Set<string>()
    const directories = new Set<string>()

    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') {
        continue
      }

      const rawId =
        typeof (entry as any)['@id'] === 'string' ? (entry as any)['@id'].trim() : ''
      if (!rawId) {
        continue
      }

      const derived = this.deriveRelativePathFromEntityId(rawId)
      if (!derived || derived.path === '') {
        continue
      }

      if (derived.isDirectory) {
        directories.add(derived.path.toLowerCase())
      } else {
        files.add(derived.path.toLowerCase())
      }
    }

    return { files, directories: Array.from(directories) }
  }

  private deriveRelativePathFromEntityId(
    id: string,
  ): { path: string; isDirectory: boolean } | undefined {
    let candidate = id.trim()
    if (!candidate) {
      return undefined
    }

    const isDirectory = candidate.endsWith('/')

    if (candidate.startsWith('file://./')) {
      candidate = candidate.slice('file://./'.length)
    } else if (candidate.startsWith('file://')) {
      candidate = candidate.slice('file://'.length)
    }

    if (candidate.startsWith('./')) {
      candidate = candidate.slice(2)
    }

    candidate = candidate.trim()
    if (!candidate) {
      if (isDirectory) {
        return { path: '', isDirectory }
      }
      return undefined
    }

    const normalized = this.normalizeRelativePath(candidate)
    if (!normalized) {
      if (isDirectory) {
        return { path: '', isDirectory }
      }
      return undefined
    }

    return { path: normalized, isDirectory }
  }

  private normalizeRelativePath(path: string): string {
    let normalized = path.replace(/\\/g, '/')
    normalized = normalized.trim()
    while (normalized.startsWith('/')) {
      normalized = normalized.slice(1)
    }
    normalized = normalized.replace(/\/{2,}/g, '/')
    while (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  }

  // --- filter wiring (main) ---

  protected onFileNameFilterChange(event: React.ChangeEvent<HTMLInputElement>): void {
    this.filters.fileNameFilter = event.target.value
    this.applyFilters()
  }

  protected onRoCrateFilterChange(value: FileNavigatorFilter.RoCrateFilter): void {
    this.filters.roCrateFilter = value
    this.applyFilters()
  }

  protected applyFilters(): void {
    this.fileNavigatorFilter.setFilters(
      this.filters.fileNameFilter,
      this.filters.roCrateFilter,
    )
    this.update()
  }

  protected clearFilters(): void {
    this.filters.fileNameFilter = ''
    this.filters.roCrateFilter = 'all'
    this.applyFilters()
  }
}
