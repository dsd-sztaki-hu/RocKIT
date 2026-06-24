// *****************************************************************************
// Copyright (C) 2017 TypeFox and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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
  TreeSelection,
} from '@theia/core/lib/browser'
import { ThemeService } from '@theia/core/lib/browser/theming'
import { CommandService } from '@theia/core/lib/common'
import { Disposable } from '@theia/core/lib/common/disposable'
import { nls } from '@theia/core/lib/common/nls'
import URI from '@theia/core/lib/common/uri'
import { Message } from '@theia/core/shared/@lumino/messaging'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { DirNode, FileStatNode, FileStatNodeData } from '@theia/filesystem/lib/browser'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { FileSearchService } from '@theia/file-search/lib/common/file-search-service'
import { WorkspaceCommands, WorkspaceService } from '@theia/workspace/lib/browser'
import { Button, Select } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import {
  AntdThemeProvider,
  getSharedDatasetIconClass,
  getSharedFileIconClass,
} from 'rockit-common/lib/browser'
import { DataSourceService } from 'data-sources/lib/browser/data-source-service'
import { AbstractNavigatorTreeWidget } from './abstract-navigator-tree-widget'
import { NavigatorContextKeyService } from './navigator-context-key-service'
import { FileNavigatorFilter } from './navigator-filter'
import { FileNavigatorModel } from './navigator-model'
import {
  DataSourceRootNode,
  NavigatorHeaderNode,
  WorkspaceNode,
  WorkspaceRootNode,
} from './navigator-tree'
import { RoCrateIgnoredFilesService } from './ro-crate-ignored-files-service'

export const FILE_NAVIGATOR_ID = 'files'
export const LABEL = nls.localizeByDefault('Workspace')
export const CLASS = 'theia-Files'

@injectable()
export class FileNavigatorWidget extends AbstractNavigatorTreeWidget {
  static SEARCH_VISIBLE_CLASS = 'navigator-search-visible'
  static BODY_SEARCH_VISIBLE_CLASS = 'navigator-search-visible'
  @inject(CommandService) protected readonly commandService: CommandService
  @inject(NavigatorContextKeyService)
  protected readonly contextKeyService: NavigatorContextKeyService
  @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
  @inject(AppStateService) protected readonly appStateService: AppStateService
  @inject(FileNavigatorFilter) protected readonly fileNavigatorFilter: FileNavigatorFilter
  @inject(DataSourceService) protected readonly dataSourceService: DataSourceService
  @inject(ThemeService) protected readonly themeService: ThemeService
  @inject(FileSearchService) protected readonly fileSearchService: FileSearchService
  @inject(FileService) protected readonly fileService: FileService
  @inject(RoCrateIgnoredFilesService)
  protected readonly roCrateIgnoredFilesService: RoCrateIgnoredFilesService

  protected readonly filters: {
    fileNameFilter: string
    roCrateFilter: FileNavigatorFilter.RoCrateFilter
  } = {
    fileNameFilter: '',
    roCrateFilter: 'all',
  }

  protected searchVisible = false
  protected readonly fileNameInputRef = React.createRef<HTMLInputElement>()
  protected fileNameSelection: { start: number | null; end: number | null } | undefined
  protected filterKeydownListenerAttached = false
  protected suppressRootSelection = false
  protected roCratePathIndex: { files: Set<string>; directories: Set<string> } = {
    files: new Set(),
    directories: new Set(),
  }
  protected orphanFilePaths = new Set<string>()
  protected orphanDirectoryPaths = new Set<string>()
  protected orphanScanToken = 0
  protected workspaceFilesWatchDisposable?: Disposable
  protected workspaceFilesChangeDisposable?: Disposable
  protected workspaceFilesWatchRoot?: string
  protected workspaceFilesWatchRootUri?: URI
  protected pendingOrphanRefresh?: number

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
    this.searchVisible = this.appStateService.fileExplorerFiltersVisible

    const dataset = {
      ...this.title.dataset,
      visibilityCommandLabel: nls.localizeByDefault('Folders'),
    }
    this.title.dataset = dataset

    this.updateSelectionContextKeys()

    this.toDispose.pushAll([
      this.model.onSelectionChanged(() => this.updateSelectionContextKeys()),
      this.model.onSelectionChanged(() => this.stripRootSelections()),
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
        this.roCratePathIndex = this.buildRoCrateEntityPathIndex(this.appStateService.roCrate)
        void this.refreshOrphanHighlights()
        void this.model.refresh()
        this.update()
      }),
      this.roCrateIgnoredFilesService.onDidChangeIgnoredPaths(() => {
        void this.refreshOrphanHighlights()
        void this.model.refresh()
        this.update()
      }),
      this.workspaceService.onWorkspaceChanged(() => {
        this.ensureWorkspaceFileWatch()
        void this.refreshOrphanHighlights()
        void this.model.refresh()
      }),
    ])
    this.toDispose.push({
      dispose: () => this.detachFilterKeydownInterceptor(),
    })
    this.toDispose.push({
      dispose: () =>
        document.body.classList.remove(FileNavigatorWidget.BODY_SEARCH_VISIBLE_CLASS),
    })
    this.toDispose.push({
      dispose: () => this.disposeWorkspaceFileWatch(),
    })
    this.roCratePathIndex = this.buildRoCrateEntityPathIndex(this.appStateService.roCrate)
    this.ensureWorkspaceFileWatch()
    void this.refreshOrphanHighlights()
    this.updateSearchVisibilityClass()
  }

  protected ensureWorkspaceFileWatch(): void {
    const rootUri = this.getPrimaryWorkspaceRootUri()
    if (!rootUri) {
      this.disposeWorkspaceFileWatch()
      return
    }

    const rootKey = rootUri.toString()
    if (
      this.workspaceFilesWatchRoot === rootKey &&
      this.workspaceFilesWatchDisposable &&
      this.workspaceFilesChangeDisposable
    ) {
      return
    }

    this.disposeWorkspaceFileWatch()
    this.workspaceFilesWatchRoot = rootKey
    this.workspaceFilesWatchRootUri = rootUri
    this.workspaceFilesWatchDisposable = this.fileService.watch(rootUri)
    this.workspaceFilesChangeDisposable = this.fileService.onDidFilesChange((event) => {
      const watchedRootUri = this.workspaceFilesWatchRootUri
      if (!watchedRootUri) {
        return
      }

      const changedInWatchedRoot = event.changes.some((change) =>
        watchedRootUri.isEqualOrParent(change.resource),
      )
      if (!changedInWatchedRoot) {
        return
      }

      this.scheduleOrphanRefresh()
    })
  }

  protected disposeWorkspaceFileWatch(): void {
    this.workspaceFilesWatchDisposable?.dispose()
    this.workspaceFilesChangeDisposable?.dispose()
    this.workspaceFilesWatchDisposable = undefined
    this.workspaceFilesChangeDisposable = undefined
    this.workspaceFilesWatchRoot = undefined
    this.workspaceFilesWatchRootUri = undefined
    this.cancelPendingOrphanRefresh()
  }

  protected scheduleOrphanRefresh(): void {
    this.cancelPendingOrphanRefresh()
    this.pendingOrphanRefresh = window.setTimeout(() => {
      this.pendingOrphanRefresh = undefined
      void this.refreshOrphanHighlights()
    }, 200)
  }

  protected cancelPendingOrphanRefresh(): void {
    if (this.pendingOrphanRefresh) {
      clearTimeout(this.pendingOrphanRefresh)
      this.pendingOrphanRefresh = undefined
    }
  }

  protected getPrimaryWorkspaceRootUri(): URI | undefined {
    const roots = this.workspaceService.tryGetRoots()
    return roots && roots.length > 0 ? roots[0].resource : undefined
  }

  protected override doUpdateRows(): void {
    super.doUpdateRows()
    this.title.label = LABEL
    this.title.caption = LABEL
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

    // keep behavior: if workspace isn't opened, show just tree container (from main)
    const content = !this.workspaceService.opened ? (
      <div className="navigator-filter-panel">
        <div {...this.createContainerAttributes()}>{this.renderTree(this.model)}</div>
      </div>
    ) : (
      <div className="navigator-filter-panel">
        <div
          className={`navigator-filter-content ${this.searchVisible ? 'expanded' : 'collapsed'}`}
        >
          <div className="navigator-filter-fields">
            <label className="navigator-filter-row">
              <span className="navigator-filter-label">File name</span>
              <input
                className="navigator-filter-input"
                type="text"
                placeholder="Search file name"
                ref={this.fileNameInputRef}
                value={this.filters.fileNameFilter}
                onChange={(event) => this.onFileNameFilterChange(event)}
                onFocus={() => this.attachFilterKeydownInterceptor()}
                onBlur={() => this.detachFilterKeydownInterceptor()}
                onKeyDownCapture={(event) => this.stopFilterKeyEvents(event)}
              />
            </label>

            <label className="navigator-filter-row">
              <span className="navigator-filter-label">RO-Crate descriptions</span>
              <div onKeyDownCapture={(event) => this.stopFilterKeyEvents(event)}>
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
                  classNames={{ popup: { root: 'navigator-filter-dropdown' } }}
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

    return (
      <AntdThemeProvider themeService={this.themeService}>{content}</AntdThemeProvider>
    )
  }

  protected override renderCaption(node: TreeNode, props: NodeProps): React.ReactNode {
    if (!DataSourceRootNode.is(node)) {
      return super.renderCaption(node, props)
    }

    const attrs = this.getCaptionAttributes(node, props)
    const children = this.getCaptionChildren(node, props)
    const className = `${attrs.className ?? ''} navigator-data-source-caption`.trim()

    return (
      <div {...attrs} className={className}>
        <span className="navigator-data-source-title">{children}</span>
        <button
          className="navigator-data-source-remove"
          type="button"
          title="Remove data source"
          aria-label="Remove data source"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void this.dataSourceService.remove(node.uri)
          }}
        >
          <span className="codicon codicon-trash" aria-hidden="true" />
        </button>
      </div>
    )
  }

  protected override toNodeIcon(node: TreeNode): string {
    const icon = super.toNodeIcon(node)
    if (!FileStatNode.is(node)) {
      return icon
    }

    if (DirNode.is(node)) {
      if (icon && !icon.includes('default-folder-icon')) {
        return icon
      }
      const mappedFolderIcon = this.getFolderIconClass(node)
      return mappedFolderIcon ?? icon
    }

    // Respect active icon themes that already provide a file-specific icon.
    if (icon && !icon.includes('default-file-icon')) {
      return icon
    }

    const mapped = this.getMimeIconClass(node)
    return mapped ?? icon
  }

  private getMimeIconClass(node: FileStatNode): string | undefined {
    const fileName = node.fileStat.resource.path.base.toLowerCase()
    return getSharedFileIconClass(
      fileName,
      undefined,
      {
        baseClass: '',
        fileClass: 'navigator-file-icon',
        folderClass: 'navigator-folder-icon',
        fileModifierPrefix: 'navigator-file-icon--',
        folderModifierPrefix: 'navigator-folder-icon--',
      },
      false,
    )
  }

  private getFolderIconClass(node: DirNode): string | undefined {
    const folderName = node.fileStat.resource.path.base.toLowerCase()
    if (!folderName) {
      return undefined
    }

    return getSharedDatasetIconClass(folderName, Boolean(node.expanded), {
      baseClass: '',
      fileClass: 'navigator-file-icon',
      folderClass: 'navigator-folder-icon',
      fileModifierPrefix: 'navigator-file-icon--',
      folderModifierPrefix: 'navigator-folder-icon--',
    })
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
   * Overrides the method from FileTreeWidget to add custom CSS classes + drag support.
   */
  protected override createNodeAttributes(
    node: TreeNode,
    props: NodeProps,
  ): React.Attributes & React.HTMLAttributes<HTMLElement> {
    const attributes = super.createNodeAttributes(node, props)
    const ignoredNode = FileStatNode.is(node) && this.isIgnoredNode(node)

    if (ignoredNode) {
      const existingClassName = attributes.className || ''
      attributes.className = `${existingClassName} omitted-from-ro-crate`.trim()
    } else if (FileStatNode.is(node) && this.shouldHighlightFile(node)) {
      const existingClassName = attributes.className || ''
      attributes.className = `${existingClassName} not-in-ro-crate`.trim()
    }

    if (DirNode.is(node) && !ignoredNode && this.containsNotInRoCrate(node)) {
      const existingClassName = attributes.className || ''
      attributes.className = `${existingClassName} contains-not-in-ro-crate`.trim()
    }

    if (NavigatorHeaderNode.is(node)) {
      const existingClassName = attributes.className || ''
      attributes.className = `${existingClassName} navigator-header-node`.trim()
    }
    if (DataSourceRootNode.is(node)) {
      const existingClassName = attributes.className || ''
      const withoutState = existingClassName
        .split(' ')
        .filter(
          (className) =>
            className &&
            className !== 'theia-mod-selected' &&
            className !== 'theia-mod-focus',
        )
        .join(' ')
      attributes.className = `${withoutState} navigator-data-source-root`.trim()
    }

    if (FileStatNode.is(node) && this.isNavigatorRootNode(node)) {
      attributes.onMouseDown = (event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
      }
      attributes.onClick = (event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    // drag support (from 26662)
    if (FileStatNode.is(node)) {
      attributes.draggable = true
      attributes.onDragStart = (event: React.DragEvent) =>
        this.handleNodeDragStart(node, event)
    }

    return attributes
  }

  protected override getPaddingLeft(node: TreeNode, props: NodeProps): number {
    if (NavigatorHeaderNode.is(node)) {
      return 5
    }
    return super.getPaddingLeft(node, props)
  }

  protected override getDepthPadding(depth: number): number {
    return Math.max(0, super.getDepthPadding(depth) - 10)
  }

  private containsNotInRoCrate(node: TreeNode): boolean {
    if (!DirNode.is(node)) {
      if (FileStatNode.is(node) && this.shouldHighlightFile(node)) {
        return true
      }
      return false
    }

    const relativePath = this.getNodeWorkspaceRelativePath(node)
    if (relativePath && this.orphanDirectoryPaths.has(relativePath)) {
      return true
    }

    // Fallback for stale caches: preserve previous recursive behavior for loaded children.
    if (CompositeTreeNode.is(node) && node.children) {
      for (const child of node.children) {
        if (this.containsNotInRoCrate(child)) {
          return true
        }
      }
    }
    return false
  }

  private isIgnoredNode(node: FileStatNode): boolean {
    const relativePath = this.getNodeWorkspaceRelativePath(node)
    if (!relativePath) {
      return false
    }
    return this.roCrateIgnoredFilesService.isIgnoredPath(relativePath)
  }

  /**
   * Highlight files NOT present in RO-Crate by workspace-relative path.
   */
  private shouldHighlightFile(node: FileStatNode): boolean {
    const { files, directories } = this.roCratePathIndex
    if (files.size === 0 && directories.size === 0) {
      return false
    }

    const relativePath = this.getNodeWorkspaceRelativePath(node)
    if (!relativePath) {
      return false
    }

    if (this.roCrateIgnoredFilesService.isIgnoredPath(relativePath)) {
      return false
    }

    if (!DirNode.is(node)) {
      return this.orphanFilePaths.has(relativePath)
    }

    if (files.has(relativePath)) {
      return false
    }

    // A directory entity only describes that directory node.
    // Descendant files still need their own explicit entities.
    return !(DirNode.is(node) && directories.has(relativePath))
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

  private buildRoCrateEntityPathIndex(
    crate: Record<string, any> | undefined,
  ): { files: Set<string>; directories: Set<string> } {
    if (!crate) {
      return { files: new Set(), directories: new Set() }
    }

    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const files = new Set<string>()
    const directories = new Set<string>()
    let hasSupportedLocalId = false
    let hasUnsupportedSchemeId = false

    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') {
        continue
      }

      const rawType = (entry as any)['@type']
      const types: string[] = Array.isArray(rawType)
        ? rawType.filter((t): t is string => typeof t === 'string')
        : typeof rawType === 'string'
          ? [rawType]
          : []

      const relevant = types.some((t) => t === 'File' || t === 'Dataset')
      if (!relevant) {
        continue
      }

      const rawId =
        typeof (entry as any)['@id'] === 'string' ? (entry as any)['@id'].trim() : ''
      if (!rawId) {
        continue
      }

      const derived = this.deriveRelativePathFromEntityId(rawId)
      if (!derived || derived.path === '') {
        if (this.hasUnsupportedEntityIdScheme(rawId)) {
          hasUnsupportedSchemeId = true
        }
        continue
      }

      hasSupportedLocalId = true
      if (derived.isDirectory) {
        directories.add(derived.path.toLowerCase())
      } else {
        files.add(derived.path.toLowerCase())
      }
    }

    // Only enable orphan highlighting for crates with a consistent local-path ID style.
    // Mixed/foreign scheme styles should not produce orphan decorations.
    if (!hasSupportedLocalId || hasUnsupportedSchemeId) {
      return { files: new Set(), directories: new Set() }
    }

    return { files, directories }
  }

  private hasUnsupportedEntityIdScheme(id: string): boolean {
    const candidate = id.trim()
    if (!candidate) {
      return false
    }

    if (candidate.startsWith('./')) {
      return false
    }

    return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)
  }

  private deriveRelativePathFromEntityId(
    id: string,
  ): { path: string; isDirectory: boolean } | undefined {
    let candidate = id.trim()
    if (!candidate) {
      return undefined
    }

    const isDirectory = candidate.endsWith('/')

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
      return undefined
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

  private async refreshOrphanHighlights(): Promise<void> {
    const token = ++this.orphanScanToken

    const { files, directories } = this.roCratePathIndex
    if (files.size === 0 && directories.size === 0) {
      this.orphanFilePaths.clear()
      this.orphanDirectoryPaths.clear()
      this.update()
      return
    }

    const roots = this.workspaceService.tryGetRoots()
    const rootUri = roots?.[0]?.resource
    if (!rootUri) {
      return
    }

    let allFileUris: string[]
    try {
      allFileUris = await this.fileSearchService.find('', {
        rootUris: [rootUri.toString()],
      })
    } catch (error) {
      console.warn('Failed to refresh orphan file highlights:', error)
      return
    }

    if (token !== this.orphanScanToken) {
      return
    }

    const nextOrphanFiles = new Set<string>()
    const nextOrphanDirectories = new Set<string>()

    for (const fileUriRaw of allFileUris) {
      let relativeRaw: string | undefined
      try {
        const relativePath = rootUri.relative(new URI(fileUriRaw))
        relativeRaw = relativePath?.toString()
      } catch {
        continue
      }
      if (!relativeRaw) {
        continue
      }

      const normalized = this.normalizeRelativePath(relativeRaw.toString()).toLowerCase()
      if (!normalized) {
        continue
      }

      if (this.roCrateIgnoredFilesService.isIgnoredPath(normalized)) {
        continue
      }

      if (files.has(normalized)) {
        continue
      }

      nextOrphanFiles.add(normalized)

      const segments = normalized.split('/').filter(Boolean)
      if (segments.length > 1) {
        for (let i = 1; i < segments.length; i++) {
          nextOrphanDirectories.add(segments.slice(0, i).join('/'))
        }
      }
    }

    this.orphanFilePaths = nextOrphanFiles
    this.orphanDirectoryPaths = nextOrphanDirectories
    this.update()
  }

  // --- filter wiring (kept simple, but with selection restore + event stop) ---

  protected onFileNameFilterChange(event: React.ChangeEvent<HTMLInputElement>): void {
    this.fileNameSelection = {
      start: event.target.selectionStart,
      end: event.target.selectionEnd,
    }
    this.filters.fileNameFilter = event.target.value
    this.applyFilters()
    this.restoreInputSelection(this.fileNameInputRef, this.fileNameSelection)
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

  protected stopFilterKeyEvents(event: React.KeyboardEvent): void {
    event.stopPropagation()
    if (typeof event.nativeEvent.stopImmediatePropagation === 'function') {
      event.nativeEvent.stopImmediatePropagation()
    }
  }

  protected readonly filterGlobalKeydownCapture = (event: KeyboardEvent): void => {
    const input = this.fileNameInputRef.current
    const active = document.activeElement as HTMLElement | null
    if (!input || !active) {
      return
    }
    if (active !== input) {
      return
    }
    if (event.key !== 'Delete') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (typeof (event as any).stopImmediatePropagation === 'function') {
      ;(event as any).stopImmediatePropagation()
    }
    this.deleteOneCharInInput(input)
  }

  protected deleteOneCharInInput(input: HTMLInputElement): void {
    if (input.readOnly || input.disabled) {
      return
    }
    const value = input.value ?? ''
    const start = input.selectionStart ?? value.length
    const end = input.selectionEnd ?? value.length
    let from = start
    let to = end
    if (start === end) {
      if (start >= value.length) {
        return
      }
      from = start
      to = start + 1
    }
    input.setRangeText('', from, to, 'end')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  protected attachFilterKeydownInterceptor(): void {
    if (this.filterKeydownListenerAttached) {
      return
    }
    window.addEventListener('keydown', this.filterGlobalKeydownCapture, true)
    this.filterKeydownListenerAttached = true
  }

  protected detachFilterKeydownInterceptor(): void {
    if (!this.filterKeydownListenerAttached) {
      return
    }
    window.removeEventListener('keydown', this.filterGlobalKeydownCapture, true)
    this.filterKeydownListenerAttached = false
  }

  isSearchVisible(): boolean {
    return this.searchVisible
  }

  toggleSearch(): void {
    this.searchVisible = !this.searchVisible
    this.appStateService.fileExplorerFiltersVisible = this.searchVisible
    this.updateSearchVisibilityClass()
    this.update()
    if (this.searchVisible) {
      window.requestAnimationFrame(() => this.fileNameInputRef.current?.focus())
    }
  }

  protected updateSearchVisibilityClass(): void {
    if (this.searchVisible) {
      this.addClass(FileNavigatorWidget.SEARCH_VISIBLE_CLASS)
      document.body.classList.add(FileNavigatorWidget.BODY_SEARCH_VISIBLE_CLASS)
    } else {
      this.removeClass(FileNavigatorWidget.SEARCH_VISIBLE_CLASS)
      document.body.classList.remove(FileNavigatorWidget.BODY_SEARCH_VISIBLE_CLASS)
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

  // --- drag support (from 26662) ---

  protected handleNodeDragStart(node: FileStatNode, event: React.DragEvent): void {
    if (!event.dataTransfer) {
      return
    }
    const selectedNodes = this.model.selectedFileStatNodes
    const selectionIncludesNode = selectedNodes.some((n) => n.id === node.id)
    let nodesToTransfer =
      selectionIncludesNode && selectedNodes.length > 1 ? selectedNodes : [node]

    nodesToTransfer = this.normalizeDragSelection(nodesToTransfer, node)
    if (!nodesToTransfer.length && !this.isNavigatorRootNode(node)) {
      nodesToTransfer = [node]
    }

    const uriList = nodesToTransfer.map((n) => n.uri.toString())

    const payload = uriList.join('\r\n')
    event.dataTransfer.setData('text/uri-list', payload)
    event.dataTransfer.setData('application/vnd.code.uri-list', payload)
    event.dataTransfer.setData('text/plain', payload)
    event.dataTransfer.effectAllowed = 'link'
  }

  protected isNavigatorRootNode(node: FileStatNode): boolean {
    return WorkspaceRootNode.is(node) || DataSourceRootNode.is(node)
  }

  protected normalizeDragSelection(
    selected: ReadonlyArray<FileStatNode>,
    anchor: FileStatNode,
  ): FileStatNode[] {
    if (this.isNavigatorRootNode(anchor)) {
      return selected.filter((n) => !this.isNavigatorRootNode(n))
    }

    const filtered = selected.filter((n) => !this.isNavigatorRootNode(n))
    const nextSelection = filtered.length ? filtered : [anchor]

    const ordered: FileStatNode[] = []
    const seen = new Set<string>()
    if (nextSelection.some((n) => n.id === anchor.id)) {
      ordered.push(anchor)
      seen.add(anchor.id)
    }
    for (const node of nextSelection) {
      if (!seen.has(node.id)) {
        ordered.push(node)
        seen.add(node.id)
      }
    }

    this.resetSelection(ordered)
    return ordered
  }

  protected resetSelection(nodes: ReadonlyArray<FileStatNode>): void {
    if (!nodes.length) {
      return
    }
    this.model.clearSelection()
    nodes.forEach((node, index) => {
      this.model.addSelection({
        node,
        type:
          index === 0
            ? TreeSelection.SelectionType.DEFAULT
            : TreeSelection.SelectionType.TOGGLE,
      })
    })
  }

  protected stripRootSelections(): void {
    if (this.suppressRootSelection) {
      return
    }

    const selected = this.model.selectedNodes
    if (!selected.length) {
      return
    }

    const roots = selected.filter(
      (node): node is FileStatNode =>
        FileStatNode.is(node) && this.isNavigatorRootNode(node),
    )
    if (!roots.length) {
      return
    }

    const nonRootSelected = selected.some(
      (node) => FileStatNode.is(node) && !this.isNavigatorRootNode(node),
    )

    this.suppressRootSelection = true
    try {
      if (!nonRootSelected) {
        this.model.clearSelection()
        return
      }

      for (const root of roots) {
        this.model.addSelection({ node: root, type: TreeSelection.SelectionType.TOGGLE })
      }
    } finally {
      this.suppressRootSelection = false
    }
  }
}
