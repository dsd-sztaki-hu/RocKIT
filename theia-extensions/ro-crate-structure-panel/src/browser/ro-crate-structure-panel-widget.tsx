import type { Disposable, MenuPath } from '@theia/core'
import {
    ApplicationShell,
    ConfirmDialog,
    ContextMenuRenderer,
    Widget,
    WidgetManager,
} from '@theia/core/lib/browser'
import { MessageService } from '@theia/core/lib/common'
import { ThemeService } from '@theia/core/lib/browser/theming'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import type { TreeDataNode } from 'antd'
import { Tooltip, Tree } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import {
    getSharedDatasetIconClass,
    getSharedFileIconClass,
    RoCrateEntityDeleteService,
} from 'rockit-common/lib/browser'
import { AntdThemeProvider } from 'rockit-common/lib/browser/antd-theme-provider'
import { MultiEditDialogService } from 'multi-edit/lib/browser/multi-edit-dialog-service'
import { inject, injectable } from 'inversify'
import * as mime from 'mime-types'
import * as React from 'react'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'
import { SchemaValidatorWidget } from 'schema-validator/lib/browser/schema-validator-widget'
import * as SparkMD5 from 'spark-md5'
import { RoCrateValidationErrorsDialog } from './ro-crate-validation-errors-dialog'

interface CrateNode {
    id: string
    name: string
    type: string
    children: CrateNode[]
    encodingFormat?: string
    conformsToUrls?: string[]
}

type StructureEntityDragPayload = {
    entityId?: string
    entityIds?: string[]
    entityName?: string
    entityNames?: string[]
    entityTypes?: string[][]
    source?: string
}

type DroppedFile = {
    relPath: string
    sourceUri?: URI
    parentKey?: string
}

export const RO_CRATE_STRUCTURE_PANEL_CONTEXT_MENU: MenuPath = [
    'ro-crate-structure-panel:context-menu',
]

@injectable()
export class RoCrateStructurePanelWidget extends ReactWidget {
    static readonly ID = 'dataset-panel:widget'
    protected instanceId: string = ''
    protected cachedCrateRef: Record<string, any> | undefined
    protected cachedRoot: CrateNode | undefined
    protected cachedTreeData: TreeDataNode[] | undefined
    protected cachedNodeKeyByEntityId = new Map<string, React.Key>()

    @inject(AppStateService)
    protected readonly appStateService: AppStateService
    @inject(RoCrateHistoryService)
    protected readonly roCrateHistoryService: RoCrateHistoryService
    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager
    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell
    @inject(ContextMenuRenderer)
    protected readonly contextMenuRenderer: ContextMenuRenderer
    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService
    @inject(FileService)
    protected readonly fileService: FileService
    @inject(ThemeService)
    protected readonly themeService: ThemeService
    @inject(MultiEditDialogService)
    protected readonly multiEditDialogService: MultiEditDialogService
    @inject(RoCrateEntityDeleteService)
    protected readonly roCrateEntityDeleteService: RoCrateEntityDeleteService
    @inject(MessageService)
    protected readonly messageService: MessageService

    protected crateSubscription?: Disposable
    protected validationSubscription?: Disposable
    protected shellFocusSubscription?: Disposable

    constructor() {
        super()
        this.addClass('dataset-panel')
        this.title.closable = true
        this.title.iconClass = 'fa fa-sitemap'
        this.node.style.width = '100%'
        this.node.style.height = '100%'
    }

    initialize(options: any = {}): void {
        this.instanceId =
            options.instanceId ??
            `${RoCrateStructurePanelWidget.ID}:${Math.random().toString(36).substring(2)}`

        this.id = this.instanceId
        this.title.label = `RO-Crate Structure panel (${this.instanceId})`

        this.crateSubscription = this.appStateService.onDidChangeSelector((s) => s.roCrate)(
            (_) => {
                this.invalidateTreeCache()
                this.update()
            },
        )

        this.invalidEntityIds = this.buildInvalidEntityIdSet(
            this.appStateService.validationErrors,
        )
        this.validationIssueCount = this.appStateService.validationErrors?.length ?? 0
        this.validationSubscription = this.appStateService.onDidChangeSelector(
            (s) => s.validationErrors,
        )((errors) => {
            const next = this.buildInvalidEntityIdSet(errors)
            const nextCount = errors?.length ?? 0
            if (
                this.validationIssueCount === nextCount &&
                this.sameEntityIdSet(this.invalidEntityIds, next)
            ) {
                return
            }
            this.invalidEntityIds = next
            this.validationIssueCount = nextCount
            this.update()
        })
        this.shellFocusSubscription = this.shell.onDidChangeCurrentWidget(({ newValue }) => {
            if (newValue && this.isRoCrateEditorWidget(newValue)) {
                this.markEditorFocused(newValue.id)
            }
        })

        this.update()
    }

    // (kept from original; currently unused, but harmless)
    protected dig = (path = '0', level = 3): TreeDataNode[] => {
        const list: TreeDataNode[] = []
        for (let i = 0; i < 10; i += 1) {
            const key = `${path}-${i}`
            const treeNode: TreeDataNode = { title: key, key }
            if (level > 0) {
                treeNode.children = this.dig(key, level - 1)
            }
            list.push(treeNode)
        }
        return list
    }
    protected treeData = this.dig()

    protected expandedKeys: string[] = []
    protected containerRef: React.RefObject<HTMLDivElement> = React.createRef()
    protected treeViewportRef: React.RefObject<HTMLDivElement> = React.createRef()
    protected treeHeight: number = 400
    protected dropTargetDatasetId?: string
    protected globalDragListenersAttached = false

    // validation + selection
    protected invalidEntityIds = new Set<string>()
    protected validationIssueCount = 0
    protected selectedEntityIds = new Set<string>()
    protected selectedKeys: React.Key[] = []
    protected lastSelectedEntityId: string | undefined
    protected readonly editorFocusOrder: string[] = []
    protected readonly openingEntities = new Set<string>()

    protected readonly handleGlobalDragEnd = (_event: DragEvent): void => {
        this.setDropTargetDatasetId(undefined)
    }

    protected readonly handleGlobalDrop = (_event: DragEvent): void => {
        this.setDropTargetDatasetId(undefined)
    }

    protected MemoTooltip: React.ComponentType<any> = React.memo(Tooltip as any)

    protected invalidateTreeCache(): void {
        this.cachedCrateRef = undefined
        this.cachedRoot = undefined
        this.cachedTreeData = undefined
        this.cachedNodeKeyByEntityId.clear()
    }

    public async openEditFromContextMenu(): Promise<void> {
        const entityIds = this.getEntityIdsForMultiEdit()
        await this.multiEditDialogService.open(entityIds)
    }

    public canDeleteFromContextMenu(): boolean {
        return this.getDeletableSelectedEntityIds().length > 0
    }

    public async deleteFromContextMenu(): Promise<void> {
        await this.deleteSelectedEntities()
    }

    protected async deleteSelectedEntities(): Promise<void> {
        const result = await this.roCrateEntityDeleteService.deleteSelectedEntities({
            selectedEntityIds: this.selectedEntityIds,
            rootEntityId: './',
            appStateService: this.appStateService,
            roCrateHistoryService: this.roCrateHistoryService,
            shell: this.shell,
        })

        if (!result.changed) {
            return
        }

        this.selectedEntityIds.clear()
        this.selectedKeys = []
        this.lastSelectedEntityId = undefined
        this.invalidateTreeCache()
        this.update()
    }

    protected getDeletableSelectedEntityIds(): string[] {
        return Array.from(
            this.roCrateEntityDeleteService.getDeletableEntityIds(
                this.selectedEntityIds,
                './',
            ),
        )
    }

    protected handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
        if (event.defaultPrevented || event.key !== 'Delete') {
            return
        }
        if (this.shouldIgnoreDeleteKeyEvent(event.target as HTMLElement | null)) {
            return
        }
        if (this.getDeletableSelectedEntityIds().length === 0) {
            return
        }

        event.preventDefault()
        event.stopPropagation()
        void this.deleteSelectedEntities()
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

    protected focusContainer(): void {
        this.containerRef.current?.focus()
    }

    protected getEntityIdsForMultiEdit(): string[] {
        const crate = this.appStateService.roCrate
        const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
        const selectedIds = this.selectedEntityIds

        const selectedEditableIds: string[] = []
        const allFileIds: string[] = []
        const allDatasetIds: string[] = []

        for (const entity of graph) {
            if (!entity || typeof entity !== 'object' || !entity['@id']) {
                continue
            }
            const id = String(entity['@id'])
            if (this.entityHasType(entity, 'File')) {
                allFileIds.push(id)
            }
            if (this.entityHasType(entity, 'Dataset')) {
                allDatasetIds.push(id)
            }
            if (selectedIds.has(id)) {
                if (this.entityHasType(entity, 'Dataset') || this.entityHasType(entity, 'File')) {
                    selectedEditableIds.push(id)
                }
            }
        }

        if (selectedEditableIds.length > 0) {
            return selectedEditableIds
        }

        return [...allDatasetIds, ...allFileIds]
    }

    protected readonly handleContextMenu = (
        event: React.MouseEvent<HTMLDivElement>,
    ): void => {
        event.preventDefault()
        event.stopPropagation()
        void this.shell.activateWidget(this.id)
        const { x, y } = event.nativeEvent
        this.contextMenuRenderer.render({
            menuPath: RO_CRATE_STRUCTURE_PANEL_CONTEXT_MENU,
            context: event.currentTarget,
            anchor: { x, y },
        })
    }

    protected buildCrateTree(
        crate: any,
        selectedEntity?: string,
    ): {
        root?: CrateNode
        selectedNodeId?: string
        expandedNodeIds: string[]
        parents: string[]
    } {
        if (!crate) {
            return {
                root: undefined,
                selectedNodeId: undefined,
                expandedNodeIds: [],
                parents: [],
            }
        }

        const map: Record<string, CrateNode> = {}
        const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []

        for (const item of graph) {
            const t = item['@type']
            const isDataset = t === 'Dataset' || (Array.isArray(t) && t.includes('Dataset'))
            const isFile = t === 'File' || (Array.isArray(t) && t.includes('File'))
            if (isDataset || isFile) {
                const id = item['@id']
                const name = item.title || item.name || ''
                const type = Array.isArray(t) ? t[0] : t
                const encodingFormat =
                    typeof item['encodingFormat'] === 'string' ? item['encodingFormat'] : undefined
                const conforms = item['conformsTo']
                const conformsToUrls = conforms
                    ? typeof conforms === 'string'
                        ? [conforms]
                        : conforms
                    : undefined
                map[id] = { id, name, type, children: [], encodingFormat, conformsToUrls }
            }
        }

        for (const item of graph) {
            const t = item['@type']
            const isDataset = t === 'Dataset' || (Array.isArray(t) && t.includes('Dataset'))
            if (isDataset && item.hasPart) {
                const parentId = item['@id']
                const parts = Array.isArray(item.hasPart) ? item.hasPart : [item.hasPart]
                const childIds = Array.from(
                    new Set(
                        parts
                            .map((part: any) => (typeof part === 'string' ? part : part?.['@id']))
                            .filter(Boolean),
                    ),
                ) as string[]
                for (const childId of childIds) {
                    if (map[childId] && map[parentId]) {
                        map[parentId].children.push(map[childId])
                    }
                }
            }
        }

        for (const node of Object.values(map)) {
            const seen = new Set<string>()
            node.children = node.children.filter((c) => {
                if (seen.has(c.id)) return false
                seen.add(c.id)
                return true
            })
            node.children.sort((a, b) => a.name.localeCompare(b.name))
        }

        const root = map['./']
        let selectedNodeId: string | undefined
        let expandedNodeIds: string[] = []
        let parents: string[] = []

        if (selectedEntity) {
            selectedNodeId = selectedEntity
            if (selectedEntity !== './') {
                parents = []
            }
        } else {
            selectedNodeId = ''
            expandedNodeIds = ['./']
        }

        return { root, selectedNodeId, expandedNodeIds, parents }
    }

    protected crateNodeToTreeData(
        node: CrateNode,
        parentKey?: string,
        seen?: Set<string>,
    ): TreeDataNode {
        const idStr = String(node.id).replace(/`/g, '').trim()
        const key = parentKey ? `${parentKey}::${idStr}` : idStr
        if (!this.cachedNodeKeyByEntityId.has(node.id)) {
            this.cachedNodeKeyByEntityId.set(node.id, key)
        }
        const visited = seen ?? new Set<string>()

        if (visited.has(idStr)) {
            return {
                key,
                title: '',
                displayName: node.name || node.id,
                entityId: node.id,
                entityType: node.type,
                entityEncodingFormat: node.encodingFormat,
            } as TreeDataNode & {
                entityId: string
                entityType: string
                entityEncodingFormat?: string
            }
        }

        const nextSeen = new Set(visited)
        nextSeen.add(idStr)
        const children =
            node.children?.map((c) => this.crateNodeToTreeData(c, key, nextSeen)) || []

        return {
            key,
            title: '',
            displayName: node.name || node.id,
            entityId: node.id,
            entityType: node.type,
            entityEncodingFormat: node.encodingFormat,
            children,
        } as TreeDataNode & { entityId: string; entityType: string; entityEncodingFormat?: string }
    }

    protected buildTreeDataFromRoot(root: CrateNode | undefined): TreeDataNode[] {
        this.cachedNodeKeyByEntityId = new Map<string, React.Key>()
        return root ? [this.crateNodeToTreeData(root)] : []
    }

    // Windows Explorer-like selection behavior:
    // - single click: single select
    // - ctrl/cmd+click: toggle specific row
    // - shift+click: additive range selection across expanded rows
    protected handleTreeSelect = (_keys: React.Key[], info: any): void => {
        this.focusContainer()

        const entityId = info.node?.entityId
        if (!entityId) {
            return
        }

        const event = info?.nativeEvent as MouseEvent | undefined
        const nodeKey = info.node?.key as React.Key | undefined

        if (event?.shiftKey) {
            this.selectRange(entityId, nodeKey)
        } else if (event?.ctrlKey || event?.metaKey) {
            this.toggleSelection(entityId, nodeKey)
        } else {
            this.selectSingle(entityId, nodeKey)
        }

        if (event?.altKey) {
            void this.openRoCrateEditor(entityId, { forceNewWindow: true })
        }
    }

    protected handleEntityDoubleClick(
        entityId: string,
        event: React.MouseEvent,
        nodeKey?: React.Key,
    ): void {
        event.preventDefault()
        event.stopPropagation()
        if (event.altKey || event.shiftKey) {
            return
        }
        this.selectSingle(entityId, nodeKey)
        void this.openRoCrateEditor(entityId)
    }

    protected selectSingle(entityId: string, nodeKey?: React.Key): void {
        this.selectedEntityIds = new Set([entityId])
        this.selectedKeys = nodeKey !== undefined ? [nodeKey] : []
        if (nodeKey === undefined) {
            this.syncSelectedKeysFromEntityIds()
        }
        this.lastSelectedEntityId = entityId
        this.update()
    }

    protected toggleSelection(entityId: string, _nodeKey?: React.Key): void {
        if (this.selectedEntityIds.has(entityId)) {
            this.selectedEntityIds.delete(entityId)
            if (this.lastSelectedEntityId === entityId) {
                this.lastSelectedEntityId = Array.from(this.selectedEntityIds.values()).slice(-1)[0]
            }
        } else {
            this.selectedEntityIds.add(entityId)
            this.lastSelectedEntityId = entityId
        }

        this.syncSelectedKeysFromEntityIds()
        this.update()
    }

    protected selectRange(entityId: string, _nodeKey?: React.Key): void {
        const visibleRows = this.getVisibleEntityRows()
        const clickedIndex = visibleRows.findIndex((row) => row.entityId === entityId)
        if (clickedIndex < 0) {
            if (!this.selectedEntityIds.has(entityId)) {
                this.selectedEntityIds.add(entityId)
            }
            this.syncSelectedKeysFromEntityIds()
            this.lastSelectedEntityId = entityId
            this.update()
            return
        }

        const anchorId = this.lastSelectedEntityId
        const anchorIndex = anchorId
            ? visibleRows.findIndex((row) => row.entityId === anchorId)
            : -1
        if (!anchorId || anchorIndex < 0) {
            if (!this.selectedEntityIds.has(entityId)) {
                this.selectedEntityIds.add(entityId)
            }
            this.syncSelectedKeysFromEntityIds()
            this.lastSelectedEntityId = entityId
            this.update()
            return
        }

        const start = Math.min(anchorIndex, clickedIndex)
        const end = Math.max(anchorIndex, clickedIndex)
        const range = visibleRows.slice(start, end + 1)
        for (const row of range) {
            this.selectedEntityIds.add(row.entityId)
        }
        this.syncSelectedKeysFromEntityIds()
        this.lastSelectedEntityId = entityId
        this.update()
    }

    protected syncSelectedKeysFromEntityIds(): void {
        if (this.selectedEntityIds.size === 0) {
            this.selectedKeys = []
            return
        }

        const indexedSelectedKeys: React.Key[] = []
        let missingKey = false
        for (const entityId of this.selectedEntityIds) {
            const key = this.getNodeKeyForEntity(entityId)
            if (key === undefined) {
                missingKey = true
                break
            }
            indexedSelectedKeys.push(key)
        }

        if (!missingKey) {
            this.selectedKeys = indexedSelectedKeys
            return
        }

        const selectedKeys: React.Key[] = []
        const visit = (node: TreeDataNode): void => {
            const typedNode = node as TreeDataNode & {
                entityId?: string
                children?: TreeDataNode[]
            }
            if (
                typedNode.entityId &&
                node.key !== undefined &&
                this.selectedEntityIds.has(typedNode.entityId)
            ) {
                selectedKeys.push(node.key)
            }
            for (const child of typedNode.children ?? []) {
                visit(child)
            }
        }
        for (const rootNode of this.getCurrentTreeData()) {
            visit(rootNode)
        }
        this.selectedKeys = selectedKeys
    }

    protected getVisibleEntityRows(): Array<{ entityId: string; nodeKey: React.Key }> {
        const treeData = this.getCurrentTreeData()
        const rows: Array<{ entityId: string; nodeKey: React.Key }> = []
        const seen = new Set<string>()

        const expanded = new Set(this.expandedKeys.map((key) => String(key)))
        const visit = (node: TreeDataNode): void => {
            const typedNode = node as TreeDataNode & {
                entityId?: string
                children?: TreeDataNode[]
            }
            const entityId = typedNode.entityId
            const nodeKey = node.key

            if (entityId && nodeKey !== undefined && !seen.has(entityId)) {
                seen.add(entityId)
                rows.push({ entityId, nodeKey })
            }

            const children = typedNode.children ?? []
            if (!children.length) {
                return
            }
            if (!expanded.has(String(node.key))) {
                return
            }
            for (const child of children) {
                visit(child)
            }
        }
        for (const rootNode of treeData) {
            visit(rootNode)
        }

        return rows
    }

    protected getNodeKeyForEntity(entityId: string): React.Key | undefined {
        const indexedKey = this.cachedNodeKeyByEntityId.get(entityId)
        if (indexedKey !== undefined) {
            return indexedKey
        }

        const row = this.getVisibleEntityRows().find((value) => value.entityId === entityId)
        return row?.nodeKey
    }

    protected getCurrentTreeData(): TreeDataNode[] {
        const crate = this.appStateService.roCrate
        if (crate === this.cachedCrateRef && this.cachedTreeData) {
            return this.cachedTreeData
        }

        const built = this.buildCrateTree(crate)
        const treeData = this.buildTreeDataFromRoot(built.root)
        this.cachedCrateRef = crate
        this.cachedRoot = built.root
        this.cachedTreeData = treeData
        if (this.expandedKeys.length === 0 && treeData.length > 0) {
            this.expandedKeys = [String(treeData[0].key)]
        }
        return treeData
    }

    protected handleTreeExpand = (keys: React.Key[]): void => {
        this.expandedKeys = keys.map((key) => String(key))
        this.update()
    }

    protected renderEntityIcon(item: TreeDataNode, isExpanded: boolean): React.ReactNode {
        const typedItem = item as TreeDataNode & {
            entityType?: string
            entityId?: string
            displayName?: string
            entityEncodingFormat?: string
        }
        const entityType = typedItem.entityType
        const entityId = typeof typedItem.entityId === 'string' ? typedItem.entityId : ''
        const displayName =
            typeof typedItem.displayName === 'string' ? typedItem.displayName : ''
        const encodingFormat =
            typeof typedItem.entityEncodingFormat === 'string'
                ? typedItem.entityEncodingFormat
                : undefined

        if (entityType === 'Dataset') {
            return (
                <span
                    className={this.getDatasetIconClass(displayName, entityId, isExpanded)}
                    aria-hidden="true"
                />
            )
        }

        return (
            <span
                className={this.getFileIconClass(displayName, entityId, encodingFormat)}
                aria-hidden="true"
            />
        )
    }

    protected getDatasetIconClass(
        displayName: string,
        entityId: string,
        isExpanded: boolean,
    ): string {
        return getSharedDatasetIconClass(
            this.getEntityNameCandidate(displayName, entityId),
            isExpanded,
            {
                baseClass: 'ro-crate-entity-icon',
                fileClass: 'ro-crate-file-icon',
                folderClass: 'ro-crate-folder-icon',
                fileModifierPrefix: 'ro-crate-file-icon--',
                folderModifierPrefix: 'ro-crate-folder-icon--',
            },
        )
    }

    protected getFileIconClass(
        displayName: string,
        entityId: string,
        encodingFormat?: string,
    ): string {
        return getSharedFileIconClass(
            this.getEntityNameCandidate(displayName, entityId),
            encodingFormat,
            {
                baseClass: 'ro-crate-entity-icon',
                fileClass: 'ro-crate-file-icon',
                folderClass: 'ro-crate-folder-icon',
                fileModifierPrefix: 'ro-crate-file-icon--',
                folderModifierPrefix: 'ro-crate-folder-icon--',
            },
        )!
    }

    protected getEntityNameCandidate(displayName: string, entityId: string): string {
        const normalizedDisplayName = `${displayName ?? ''}`.trim()
        if (normalizedDisplayName) {
            return normalizedDisplayName
        }

        let candidate = `${entityId ?? ''}`.trim()
        if (candidate.startsWith('./')) {
            candidate = candidate.slice(2)
        }
        while (candidate.endsWith('/') && candidate.length > 1) {
            candidate = candidate.slice(0, -1)
        }
        const segments = candidate.split('/').filter(Boolean)
        return segments.length ? segments[segments.length - 1] : candidate
    }

    protected async openRoCrateEditor(
        entityId: string,
        options?: { forceNewWindow?: boolean },
    ): Promise<void> {
        if (!entityId) {
            return
        }
        const forceNewWindow = options?.forceNewWindow === true
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
                    const existing = this.shell.getWidgetById(existingWidgetId)
                    if (existing) {
                        this.ensureWidgetInMain(existing)
                        this.appStateService.registerEntityEditor(existingWidgetId, entityId)
                        await this.shell.activateWidget(existing.id)
                        this.markEditorFocused(existing.id)
                        return
                    }
                }

                const lastFocusedEditor = this.getPreferredRoCrateEditorWidget()
                if (lastFocusedEditor) {
                    this.ensureWidgetInMain(lastFocusedEditor)
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
                    addOptions.mode = 'tab-after'
                    addOptions.ref =
                        this.getRightmostWidgetInSameTabBar(referenceEditor) ?? referenceEditor
                } else {
                    addOptions.mode = 'split-right'
                    addOptions.ref = referenceEditor
                }
            }

            await this.shell.addWidget(widget, addOptions)
            this.appStateService.registerEntityEditor(widget.id, entityId)
            await this.shell.activateWidget(widget.id)
            this.markEditorFocused(widget.id)
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

    protected ensureWidgetInMain(widget: Widget): void {
        const mainWidgets = this.shell.getWidgets('main')
        if (mainWidgets.includes(widget)) {
            return
        }
        this.shell.addWidget(widget, { area: 'main' })
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

    onAfterAttach(msg: any): void {
        super.onAfterAttach(msg)
        this.computeHeightAndUpdate()
        this.attachGlobalDragListeners()
    }

    onResize(msg: any): void {
        super.onResize(msg)
        this.computeHeightAndUpdate()
    }

    protected computeHeightAndUpdate(): void {
        const viewportEl = this.treeViewportRef?.current
        const containerEl = this.containerRef?.current
        if (!viewportEl && !containerEl) {
            return
        }

        const h = viewportEl
            ? Math.max(0, Math.floor(viewportEl.getBoundingClientRect().height))
            : (() => {
                const rect = containerEl!.getBoundingClientRect()
                const style = window.getComputedStyle(containerEl!)
                const topPad = parseFloat(style.paddingTop || '0')
                const bottomPad = parseFloat(style.paddingBottom || '0')
                return Math.max(0, Math.floor(rect.height - topPad - bottomPad))
            })()

        if (h !== this.treeHeight) {
            this.treeHeight = h
            this.update()
        }
    }

    protected attachGlobalDragListeners(): void {
        if (this.globalDragListenersAttached) {
            return
        }
        document.addEventListener('dragend', this.handleGlobalDragEnd, true)
        document.addEventListener('drop', this.handleGlobalDrop, true)
        this.globalDragListenersAttached = true
    }

    protected detachGlobalDragListeners(): void {
        if (!this.globalDragListenersAttached) {
            return
        }
        document.removeEventListener('dragend', this.handleGlobalDragEnd, true)
        document.removeEventListener('drop', this.handleGlobalDrop, true)
        this.globalDragListenersAttached = false
    }

    render(): React.ReactNode {
        const crateToUse = this.appStateService.roCrate

        let root: CrateNode | undefined
        let treeData: TreeDataNode[] = []

        if (crateToUse === this.cachedCrateRef && this.cachedTreeData) {
            root = this.cachedRoot
            treeData = this.cachedTreeData
        } else {
            const built = this.buildCrateTree(crateToUse)
            root = built.root

            treeData = this.buildTreeDataFromRoot(root)

            this.cachedCrateRef = crateToUse
            this.cachedRoot = root
            this.cachedTreeData = treeData
        }

        if (this.expandedKeys.length === 0 && treeData.length) {
            const rootKey = treeData[0].key as string
            this.expandedKeys = [rootKey]
        }

        const validationIssueCount = this.appStateService.validationErrors?.length ?? 0

        const content = (
            <div
                ref={this.containerRef}
                className="ro-crate-structure-panel-body"
                style={{
                    padding: '1rem',
                    paddingTop: '6px',
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    boxSizing: 'border-box',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                }}
                onClick={(event) => {
                    this.focusContainer()
                    const target = event.target as HTMLElement | null
                    if (target?.closest?.('[data-entity-id]')) {
                        return
                    }
                    if (this.selectedEntityIds.size === 0 && this.selectedKeys.length === 0) {
                        return
                    }
                    this.selectedEntityIds.clear()
                    this.selectedKeys = []
                    this.lastSelectedEntityId = undefined
                    this.update()
                }}
                tabIndex={0}
                onKeyDown={(event) => this.handleKeyDown(event)}
                onDragOver={(event) => this.handleDragOver(event)}
                onDragLeave={(event) => this.handleDragLeave(event)}
                onDropCapture={(event) => this.handleDropCapture(event)}
                onDrop={(event) => this.handleDrop(event)}
                onContextMenu={this.handleContextMenu}
            >
                <button
                    className={`ro-crate-structure-validation-strip${
                        validationIssueCount > 0 ? ' is-visible' : ''
                    }`}
                    type="button"
                    disabled={validationIssueCount === 0}
                    aria-hidden={validationIssueCount === 0}
                    tabIndex={validationIssueCount === 0 ? -1 : 0}
                    onClick={() => this.openValidationErrorsDialog()}
                >
                    <span className="ro-crate-structure-validation-icon fa fa-exclamation-triangle" />
                    <span className="ro-crate-structure-validation-text">
            {validationIssueCount} validation error(s)
          </span>
                </button>

                <div ref={this.treeViewportRef} className="ro-crate-structure-tree-viewport">
                    <Tree
                        className="ro-crate-structure-tree"
                        style={{ minWidth: '100%' }}
                        treeData={treeData}
                        height={this.treeHeight}
                        showIcon
                        multiple
                        selectedKeys={this.selectedKeys}
                        expandedKeys={this.expandedKeys}
                        onExpand={this.handleTreeExpand}
                        onSelect={this.handleTreeSelect}
                        titleRender={(item) => {
                            const title = item.title as React.ReactNode
                            const displayName =
                                (item as any).displayName ?? (typeof title === 'string' ? title : '')
                            const entityId = (item as any).entityId as string | undefined
                            const isInvalid = Boolean(entityId && this.invalidEntityIds.has(entityId))
                            const isDatasetNode = (item as any).entityType === 'Dataset'
                            const isDropTargetDataset =
                                isDatasetNode && entityId === this.dropTargetDatasetId
                            const isExpanded = this.expandedKeys.includes(String(item.key))
                            const icon = this.renderEntityIcon(item, isExpanded)

                            return (
                                <this.MemoTooltip title={entityId ?? displayName} placement="right">
                  <span
                      className={`ro-crate-structure-node-title${
                          isDropTargetDataset ? ' is-drop-target' : ''
                      }`}
                      style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '2px 4px',
                          borderRadius: 4,
                          background:
                              isDropTargetDataset
                                  ? 'var(--ro-crate-structure-drop-target-bg, rgba(24, 144, 255, 0.14))'
                                  : 'transparent',
                          outline: 'none',
                          boxShadow:
                              isDropTargetDataset
                                  ? 'var(--ro-crate-structure-drop-target-shadow, 0 0 8px rgba(24, 144, 255, 0.35))'
                                  : 'none',
                      }}
                      data-entity-id={entityId}
                      data-node-key={String(item.key)}
                      title=""
                      draggable={Boolean(entityId && entityId !== './')}
                      onDragStart={(event) => {
                          if (!entityId || entityId === './') {
                              event.preventDefault()
                              return
                          }
                          this.handleEntityDragStart(entityId, event)
                      }}
                      onDragEnd={(event) => {
                          event.stopPropagation()
                          ;(globalThis as any).__rockitEntityDragPayload = undefined
                      }}
                      onDoubleClick={(event) => {
                          if (!entityId) {
                              return
                          }
                          this.handleEntityDoubleClick(entityId, event, item.key)
                      }}
                  >
                    {icon}
                      {isInvalid && (
                          <span
                              className="ro-crate-structure-invalid-icon fa fa-exclamation-triangle"
                              role="img"
                              aria-label="Invalid entity"
                              title="Invalid entity"
                          />
                      )}
                      {displayName}
                  </span>
                                </this.MemoTooltip>
                            )
                        }}
                    />
                </div>
            </div>
        )

        const result = (
            <AntdThemeProvider themeService={this.themeService}>{content}</AntdThemeProvider>
        )

        return result
    }

    protected handleDragOver(event: React.DragEvent): void {
        if (!event.dataTransfer) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = this.extractEntityDragPayload(event.dataTransfer)
            ? event.altKey
                ? 'copy'
                : 'move'
            : 'link'

        const crate = this.appStateService.roCrate
        if (!crate || !Array.isArray(crate['@graph'])) {
            this.setDropTargetDatasetId(undefined)
            return
        }

        const targetEntityId = this.resolveDropTargetEntityIdWithFallback(event)
        const datasetTargetEntityId = this.resolveDatasetTargetEntityId(
            crate,
            targetEntityId ?? './',
        )
        this.setDropTargetDatasetId(datasetTargetEntityId)
    }

    protected handleDragLeave(event: React.DragEvent): void {
        const currentTarget = event.currentTarget as Node | null
        const relatedTarget = event.relatedTarget as Node | null
        if (!currentTarget || (relatedTarget && currentTarget.contains(relatedTarget))) {
            return
        }
        this.setDropTargetDatasetId(undefined)
    }

    protected handleDropCapture(_event: React.DragEvent): void {
        // Clear highlight even if a child stops drop propagation.
        this.setDropTargetDatasetId(undefined)
    }

    protected handleDrop(event: React.DragEvent): void {
        event.preventDefault()
        event.stopPropagation()
        this.setDropTargetDatasetId(undefined)
        void this.handleDropAsync(event)
    }

    protected async handleDropAsync(event: React.DragEvent): Promise<void> {
        const dataTransfer = event.dataTransfer
        if (!dataTransfer) {
            return
        }

        const entityPayload = this.extractEntityDragPayload(dataTransfer)
        if (entityPayload) {
            await this.handleEntityDropAsync(event, entityPayload)
            return
        }

        const uris = this.extractUrisFromDataTransfer(dataTransfer)
        if (!uris.length) {
            return
        }

        const droppedFiles: DroppedFile[] = []
        for (const uriString of uris) {
            try {
                const uri = this.parseDroppedUri(uriString)
                if (!uri) {
                    continue
                }
                const rel = await this.workspaceService.getWorkspaceRelativePath(uri)
                if (rel) {
                    droppedFiles.push({ relPath: rel, sourceUri: uri })
                } else {
                }
            } catch (error) {
                console.warn('Failed to parse dropped URI', uriString, error)
            }
        }

        let uniqueDroppedFiles = this.dedupeDroppedFilesByPath(droppedFiles)
        if (!uniqueDroppedFiles.length) {
            return
        }

        const droppedDirectories = await this.findDroppedDirectories(uniqueDroppedFiles)
        if (droppedDirectories.length) {
            const folderLabel =
                droppedDirectories.length === 1
                    ? `the folder "${this.getDroppedFileName(droppedDirectories[0])}"`
                    : `${droppedDirectories.length} selected folders`
            const includeContents = await new ConfirmDialog({
                title: 'Include folder contents?',
                msg: `Do you want to add all files and subfolders inside ${folderLabel} recursively?`,
                ok: 'Include Contents',
                cancel: 'Folder Only',
            }).open()

            if (includeContents) {
                uniqueDroppedFiles = await this.expandDroppedDirectories(
                    uniqueDroppedFiles,
                    droppedDirectories,
                )
            }
        }

        const crate = this.appStateService.roCrate
        if (!crate || !Array.isArray(crate['@graph'])) {
            console.warn('No RO-Crate graph available for drop')
            return
        }

        const targetEntityId =
            this.resolveDropTargetEntityIdWithFallback(event) ??
            this.appStateService.selectedEntityId ??
            './'

        const datasetTargetEntityId = this.resolveDatasetTargetEntityId(crate, targetEntityId)

        const updatedCrate = await this.applyDroppedFilesToCrate(
            crate,
            datasetTargetEntityId,
            uniqueDroppedFiles,
        )

        this.roCrateHistoryService.applyRoCrateChange(updatedCrate, {
            label: 'Add dropped files to RO-Crate',
        })
        this.appStateService.dirty = this.appStateService.isRoCrateDirty(updatedCrate)
        this.update()
    }

    protected handleEntityDragStart(
        entityId: string,
        event: React.DragEvent<HTMLElement>,
    ): void {
        event.stopPropagation()

        const entityIds =
            this.selectedEntityIds.has(entityId) && this.selectedEntityIds.size > 0
                ? Array.from(this.selectedEntityIds).filter((id) => id !== './')
                : [entityId]
        if (!entityIds.length) {
            event.preventDefault()
            return
        }
        const crate = this.appStateService.roCrate
        const graph = Array.isArray(crate?.['@graph'])
            ? (crate['@graph'] as Record<string, any>[])
            : []
        const entityById = this.buildEntityById(graph)
        const entityNames: string[] = []
        const entityTypes: string[][] = []

        for (const id of entityIds) {
            const entity = entityById.get(id)
            entityNames.push(entity?.name ?? entity?.title ?? id)
            entityTypes.push(this.getEntityTypeNames(entity))
        }

        const payload: StructureEntityDragPayload = {
            entityIds,
            entityNames,
            entityTypes,
            source: 'ro-crate-structure-panel',
        }

        event.dataTransfer?.setData('application/x-rockit-entity-drag', JSON.stringify(payload))
        event.dataTransfer?.setData('text/plain', JSON.stringify(payload))
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'copyMove'
        }
        ;(globalThis as any).__rockitEntityDragPayload = payload
    }

    protected async handleEntityDropAsync(
        event: React.DragEvent,
        payload: StructureEntityDragPayload,
    ): Promise<void> {
        const crate = this.appStateService.roCrate
        if (!crate || !Array.isArray(crate['@graph'])) {
            return
        }

        const targetEntityId =
            this.resolveDropTargetEntityIdWithFallback(event) ??
            this.appStateService.selectedEntityId ??
            './'
        const datasetTargetEntityId = this.resolveDatasetTargetEntityId(crate, targetEntityId)
        const copyMode = event.altKey
        const result = this.applyDroppedEntitiesToCrate(
            crate,
            datasetTargetEntityId,
            payload,
            copyMode,
        )

        if (!result.changed) {
            if (result.message) {
                this.messageService.info(result.message, { timeout: 5000 })
            }
            return
        }

        this.roCrateHistoryService.applyRoCrateChange(result.crate, {
            label: copyMode
                ? 'Copy entities via drag-and-drop'
                : 'Move entities via drag-and-drop',
        })
        this.appStateService.dirty = this.appStateService.isRoCrateDirty(result.crate)
        this.invalidateTreeCache()
        this.update()
        this.messageService.info(result.message, { timeout: 5000 })
    }

    protected extractEntityDragPayload(
        dataTransfer: DataTransfer,
    ): StructureEntityDragPayload | undefined {
        const rawPayload =
            dataTransfer.getData('application/x-rockit-entity-drag') ||
            dataTransfer.getData('text/plain')
        const parsed = this.parseEntityDragPayload(rawPayload)
        if (parsed) {
            return parsed
        }
        return this.parseEntityDragPayload((globalThis as any).__rockitEntityDragPayload)
    }

    protected parseEntityDragPayload(value: unknown): StructureEntityDragPayload | undefined {
        if (!value) {
            return undefined
        }
        let payload = value
        if (typeof value === 'string') {
            try {
                payload = JSON.parse(value)
            } catch {
                return undefined
            }
        }
        if (!payload || typeof payload !== 'object') {
            return undefined
        }
        const record = payload as StructureEntityDragPayload
        const ids = this.getPayloadEntityIds(record)
        return ids.length > 0 ? record : undefined
    }

    protected getPayloadEntityIds(payload: StructureEntityDragPayload): string[] {
        const rawIds = Array.isArray(payload.entityIds)
            ? payload.entityIds
            : typeof payload.entityId === 'string'
              ? [payload.entityId]
              : []
        return Array.from(
            new Set(
                rawIds
                    .map((id) => (typeof id === 'string' ? id.trim() : ''))
                    .filter((id) => Boolean(id)),
            ),
        )
    }

    protected applyDroppedEntitiesToCrate(
        crate: Record<string, any>,
        targetDatasetId: string,
        payload: StructureEntityDragPayload,
        copyMode: boolean,
    ): { changed: boolean; crate: Record<string, any>; message: string } {
        const graph = Array.isArray(crate['@graph']) ? [...crate['@graph']] : []
        const entityIds = this.getPayloadEntityIds(payload)
        const entityById = this.buildEntityById(graph)
        const movableIds = entityIds.filter((id) => {
            const entity = entityById.get(id)
            return (
                id !== './' &&
                entity &&
                (this.entityHasType(entity, 'Dataset') || this.entityHasType(entity, 'File'))
            )
        })

        if (!movableIds.length) {
            return {
                changed: false,
                crate,
                message: 'No movable File or Dataset entities were dropped.',
            }
        }

        const targetEntity = entityById.get(targetDatasetId)
        if (!targetEntity || !this.entityHasType(targetEntity, 'Dataset')) {
            return {
                changed: false,
                crate,
                message: 'Drop target must be a Dataset entity.',
            }
        }

        if (movableIds.includes(targetDatasetId)) {
            return {
                changed: false,
                crate,
                message: 'Cannot drop an entity onto itself.',
            }
        }

        const existingTargetHasPartIds = new Set(
            this.normalizeHasPart(targetEntity.hasPart).map((part) => part['@id']),
        )
        const entityIdsToLink = movableIds.filter((id) => !existingTargetHasPartIds.has(id))

        if (!entityIdsToLink.length) {
            return {
                changed: false,
                crate,
                message: '',
            }
        }

        if (!copyMode) {
            const blockingSourceId = entityIdsToLink.find((id) =>
                this.isReachableViaHasPart(graph, id, targetDatasetId),
            )
            if (blockingSourceId) {
                return {
                    changed: false,
                    crate,
                    message:
                        'Move cancelled: the destination is only reachable through one of the dragged entities, so moving it there would split the RO-Crate graph.',
                }
            }
        }

        const targetIds = new Set(entityIdsToLink)
        const updatedGraph = graph.map((entity) => {
            if (!entity || typeof entity !== 'object') {
                return entity
            }

            const entityId = String(entity['@id'] ?? '')
            const isTarget = entityId === targetDatasetId
            const isDataset = this.entityHasType(entity, 'Dataset')
            if (!isDataset && !isTarget) {
                return entity
            }

            const originalHasPart = this.normalizeHasPart(entity.hasPart)
            let hasPart = [...originalHasPart]
            if (!copyMode && isDataset) {
                hasPart = hasPart.filter((part) => !targetIds.has(part['@id']))
            }
            if (isTarget) {
                const existingIds = new Set(hasPart.map((part) => part['@id']))
                for (const id of entityIdsToLink) {
                    if (!existingIds.has(id)) {
                        hasPart.push({ '@id': id })
                        existingIds.add(id)
                    }
                }
            }

            if (
                hasPart.length === originalHasPart.length &&
                hasPart.every((part, index) => part['@id'] === originalHasPart[index]?.['@id'])
            ) {
                return entity
            }

            return {
                ...entity,
                hasPart,
            }
        })

        const changed = JSON.stringify(graph) !== JSON.stringify(updatedGraph)
        const action = copyMode ? 'Copied' : 'Moved'
        const count = entityIdsToLink.length
        return {
            changed,
            crate: { ...crate, '@graph': updatedGraph },
            message: changed
                ? `${action} ${count} ${count === 1 ? 'entity' : 'entities'}.`
                : '',
        }
    }

    protected buildEntityById(graph: Record<string, any>[]): Map<string, Record<string, any>> {
        const entityById = new Map<string, Record<string, any>>()
        for (const entity of graph) {
            if (entity && typeof entity === 'object' && entity['@id']) {
                entityById.set(String(entity['@id']), entity)
            }
        }
        return entityById
    }

    protected getEntityTypeNames(entity: Record<string, any> | undefined): string[] {
        const rawType = entity?.['@type']
        if (!rawType) {
            return []
        }
        const values = Array.isArray(rawType) ? rawType : [rawType]
        return values
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.toLowerCase())
    }

    protected isReachableViaHasPart(
        graph: Record<string, any>[],
        sourceEntityId: string,
        targetEntityId: string,
    ): boolean {
        const entityById = this.buildEntityById(graph)
        const visited = new Set<string>()
        const queue = [sourceEntityId]

        while (queue.length) {
            const currentId = queue.shift()
            if (!currentId || visited.has(currentId)) {
                continue
            }
            visited.add(currentId)
            const entity = entityById.get(currentId)
            for (const part of this.normalizeHasPart(entity?.hasPart)) {
                const childId = part['@id']
                if (childId === targetEntityId) {
                    return true
                }
                if (!visited.has(childId)) {
                    queue.push(childId)
                }
            }
        }

        return false
    }

    protected extractUrisFromDataTransfer(dataTransfer: DataTransfer): string[] {
        // Prefer the more robust extraction from 26755 (handles multiple sources, null separators, and files[] fallback).
        const uriList =
            dataTransfer.getData('text/uri-list') ||
            dataTransfer.getData('application/vnd.code.uri-list') ||
            ''
        const text = dataTransfer.getData('text/plain') || ''

        const rawSources = [uriList, text].filter((value) => Boolean(value))
        const uris = new Set<string>()

        for (const raw of rawSources) {
            const chunks: string[] = []
            for (const line of raw.split(/[\r\n\0]+/)) {
                const trimmed = line.trim()
                if (!trimmed || trimmed.startsWith('#')) {
                    continue
                }
                chunks.push(trimmed)
            }

            if (!chunks.length && raw.trim()) {
                chunks.push(raw.trim())
            }

            for (const chunk of chunks) {
                if (!chunk) {
                    continue
                }

                const schemeMatches = chunk.match(/(?:file|https?):\/\//g) ?? []
                if (schemeMatches.length > 1) {
                    const split = chunk.split(/(?=file:\/\/|https?:\/\/)/g)
                    for (const part of split) {
                        const trimmed = part.trim()
                        if (trimmed) {
                            uris.add(trimmed)
                        }
                    }
                    continue
                }

                uris.add(chunk)
            }
        }

        if (dataTransfer.files?.length) {
            for (const file of Array.from(dataTransfer.files)) {
                const path = (file as any)?.path
                if (typeof path === 'string' && path.trim()) {
                    uris.add(path)
                }
            }
        }

        return Array.from(uris)
    }

    protected parseDroppedUri(raw: string): URI | undefined {
        const trimmed = raw.trim()
        if (!trimmed) {
            return undefined
        }
        if (trimmed.includes('://')) {
            return new URI(trimmed)
        }
        const normalized = trimmed.replace(/\\/g, '/')
        if (/^[a-zA-Z]:\//.test(normalized)) {
            return new URI(`file:///${normalized}`)
        }
        if (normalized.startsWith('/')) {
            return new URI(`file://${normalized}`)
        }
        return undefined
    }

    protected dedupeDroppedFilesByPath(
        droppedFiles: DroppedFile[],
    ): DroppedFile[] {
        const seen = new Set<string>()
        const unique: DroppedFile[] = []

        for (const file of droppedFiles) {
            const key = this.getDroppedFileKey(file)
            if (!key || seen.has(key)) {
                continue
            }
            seen.add(key)
            unique.push(file)
        }

        return unique
    }

    protected getDroppedFileKey(file: DroppedFile): string {
        return (
            file.sourceUri?.toString().toLowerCase() ??
            this.normalizeWorkspaceRelativePath(file.relPath).toLowerCase()
        )
    }

    protected getDroppedFileName(file: DroppedFile): string {
        return (
            file.sourceUri?.path?.base ||
            file.sourceUri?.path?.name ||
            this.normalizeWorkspaceRelativePath(file.relPath).split('/').pop() ||
            file.relPath
        )
    }

    protected async findDroppedDirectories(droppedFiles: DroppedFile[]): Promise<DroppedFile[]> {
        const resolved = await Promise.all(
            droppedFiles.map(async (file) => ({
                file,
                info: await this.resolveDroppedEntryInfo(file.relPath, file.sourceUri),
            })),
        )
        return resolved.filter(({ info }) => info.isDirectory).map(({ file }) => file)
    }

    protected async expandDroppedDirectories(
        droppedFiles: DroppedFile[],
        droppedDirectories: DroppedFile[],
    ): Promise<DroppedFile[]> {
        const expanded = [...droppedFiles]
        const entryByKey = new Map(expanded.map((file) => [this.getDroppedFileKey(file), file]))
        const queue = [...droppedDirectories]
        const visitedDirectories = new Set<string>()

        while (queue.length) {
            const directory = queue.shift()
            if (!directory) {
                continue
            }
            const directoryKey = this.getDroppedFileKey(directory)
            if (!directoryKey || visitedDirectories.has(directoryKey)) {
                continue
            }
            visitedDirectories.add(directoryKey)

            const directoryUri =
                directory.sourceUri ?? this.resolveWorkspaceRelativeUri(directory.relPath)
            if (!directoryUri) {
                continue
            }

            try {
                const stat = await this.fileService.resolve(directoryUri)
                if (!stat.isDirectory || stat.isSymbolicLink) {
                    continue
                }
                for (const child of stat.children ?? []) {
                    const relPath = await this.workspaceService.getWorkspaceRelativePath(
                        child.resource,
                    )
                    const childFile: DroppedFile = {
                        relPath,
                        sourceUri: child.resource,
                        parentKey: directoryKey,
                    }
                    const childKey = this.getDroppedFileKey(childFile)
                    const existing = entryByKey.get(childKey)
                    if (existing) {
                        existing.parentKey = directoryKey
                    } else {
                        expanded.push(childFile)
                        entryByKey.set(childKey, childFile)
                    }
                    if (child.isDirectory && !child.isSymbolicLink) {
                        queue.push(existing ?? childFile)
                    }
                }
            } catch (error) {
                console.warn('Failed to read dropped folder contents', directory.relPath, error)
            }
        }

        const ordered: DroppedFile[] = []
        const pending = [...expanded]
        const addedKeys = new Set<string>()
        while (pending.length) {
            const readyIndex = pending.findIndex(
                (file) => !file.parentKey || addedKeys.has(file.parentKey),
            )
            const nextIndex = readyIndex >= 0 ? readyIndex : 0
            const [next] = pending.splice(nextIndex, 1)
            ordered.push(next)
            addedKeys.add(this.getDroppedFileKey(next))
        }

        return ordered
    }

    protected resolveDropTargetEntityId(event: React.DragEvent): string | undefined {
        const target = event.target as HTMLElement | null
        if (!target) {
            console.warn('RO-Crate Structure: drop target missing')
            return undefined
        }
        const el = target.closest('[data-entity-id]') as HTMLElement | null
        const id = el?.getAttribute('data-entity-id')
        return id ? id : undefined
    }

    protected resolveDropTargetEntityIdWithFallback(
        event: React.DragEvent,
    ): string | undefined {
        const direct = this.resolveDropTargetEntityId(event)
        if (direct) {
            return direct
        }

        const pointTarget = document.elementFromPoint(
            event.clientX,
            event.clientY,
        ) as HTMLElement | null
        const pointEntityId = pointTarget
            ?.closest?.('[data-entity-id]')
            ?.getAttribute('data-entity-id')
        if (pointEntityId) {
            return pointEntityId
        }

        return this.findNearestEntityIdInTree(event)
    }

    protected findNearestEntityIdInTree(event: React.DragEvent): string | undefined {
        const container = this.containerRef?.current
        if (!container) {
            return undefined
        }
        const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-entity-id]'))
        if (!nodes.length) {
            return undefined
        }

        let bestId: string | undefined
        let bestDistance = Number.POSITIVE_INFINITY

        for (const node of nodes) {
            const rect = node.getBoundingClientRect()
            const centerY = rect.top + rect.height / 2
            const distance = Math.abs(event.clientY - centerY)
            if (distance < bestDistance) {
                bestDistance = distance
                bestId = node.getAttribute('data-entity-id') || undefined
            }
        }

        return bestId
    }

    protected setDropTargetDatasetId(id?: string): void {
        if (this.dropTargetDatasetId === id) {
            return
        }
        this.dropTargetDatasetId = id
        this.update()
    }

    protected resolveDatasetTargetEntityId(
        crate: Record<string, any>,
        targetEntityId: string,
    ): string {
        const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
        const entityById = new Map<string, any>()
        for (const entity of graph) {
            if (entity && typeof entity === 'object' && entity['@id']) {
                entityById.set(String(entity['@id']), entity)
            }
        }

        const targetEntity = entityById.get(targetEntityId)
        if (!targetEntity) {
            return './'
        }
        if (this.entityHasType(targetEntity, 'Dataset')) {
            return targetEntityId
        }
        if (!this.entityHasType(targetEntity, 'File')) {
            return './'
        }

        for (const entity of graph) {
            if (!entity || typeof entity !== 'object' || !entity['@id']) {
                continue
            }
            if (!this.entityHasType(entity, 'Dataset')) {
                continue
            }
            const parts = this.normalizeHasPart(entity.hasPart)
            if (parts.some((part) => part['@id'] === targetEntityId)) {
                return String(entity['@id'])
            }
        }

        return './'
    }

    protected entityHasType(entity: Record<string, any>, type: string): boolean {
        const rawType = entity['@type']
        if (!rawType) {
            return false
        }
        if (Array.isArray(rawType)) {
            return rawType.includes(type)
        }
        return rawType === type
    }

    protected async applyDroppedFilesToCrate(
        crate: Record<string, any>,
        targetEntityId: string,
        droppedFiles: DroppedFile[],
    ): Promise<Record<string, any>> {
        const graph = Array.isArray(crate['@graph']) ? [...crate['@graph']] : []
        const indexById = new Map<string, number>()
        for (let i = 0; i < graph.length; i += 1) {
            const entity = graph[i]
            if (entity && typeof entity === 'object' && entity['@id']) {
                indexById.set(String(entity['@id']), i)
            }
        }

        if (!indexById.has(targetEntityId) && !indexById.has('./')) {
            console.warn('No target entity found for drop', targetEntityId)
            return crate
        }

        const entityIdByDroppedFileKey = new Map<string, string>()

        for (const { relPath, sourceUri, parentKey } of droppedFiles) {
            if (!relPath) {
                continue
            }
            const normalizedRelPath = this.normalizeWorkspaceRelativePath(relPath)
            const { isDirectory, fileUri } = await this.resolveDroppedEntryInfo(relPath, sourceUri)
            const baseNewId = this.toFileEntityId(normalizedRelPath, sourceUri)
            const baseWorkspaceId = this.toFileEntityId(normalizedRelPath, undefined)
            const legacyWorkspaceId = this.toLegacyWorkspaceFileEntityId(normalizedRelPath)
            const newId = isDirectory ? this.toDatasetEntityId(baseNewId) : baseNewId
            const workspaceId = isDirectory
                ? this.toDatasetEntityId(baseWorkspaceId)
                : baseWorkspaceId
            const legacyId = relPath

            const candidateIds = [
                newId,
                ...(isDirectory ? this.getDatasetIdVariants(baseNewId) : []),
                legacyId,
                sourceUri?.toString(),
                sourceUri ? this.formatAbsoluteFileUri(sourceUri) : undefined,
                workspaceId,
                legacyWorkspaceId,
                isDirectory ? this.toDatasetEntityId(legacyWorkspaceId) : undefined,
                ...(isDirectory ? this.getDatasetIdVariants(baseWorkspaceId) : []),
            ].filter((value): value is string => Boolean(value))

            const existingId = candidateIds.find((candidate) => indexById.has(candidate))
            const id = existingId ?? newId

            if (!indexById.has(id)) {
                const droppedEntity = await this.buildDroppedEntityFromPath(
                    relPath,
                    sourceUri,
                    isDirectory,
                    fileUri,
                )
                graph.push(droppedEntity)
                indexById.set(id, graph.length - 1)
            } else if (isDirectory) {
                const existingIndex = indexById.get(id)
                if (existingIndex !== undefined) {
                    const existingEntity = graph[existingIndex]
                    if (existingEntity && !this.entityHasType(existingEntity, 'Dataset')) {
                        const rawType = existingEntity['@type']
                        const nextTypes = Array.isArray(rawType) ? [...rawType] : rawType ? [rawType] : []
                        if (!nextTypes.includes('Dataset')) {
                            nextTypes.push('Dataset')
                        }
                        graph[existingIndex] = {
                            ...existingEntity,
                            '@type': nextTypes,
                        }
                    }
                }
            }

            entityIdByDroppedFileKey.set(this.getDroppedFileKey({ relPath, sourceUri }), id)

            const requestedParentId = parentKey
                ? entityIdByDroppedFileKey.get(parentKey)
                : targetEntityId
            const targetIndex = requestedParentId
                ? indexById.get(requestedParentId)
                : undefined
            const effectiveTargetIndex =
                targetIndex ?? (parentKey ? undefined : indexById.get('./'))
            if (effectiveTargetIndex === undefined) {
                console.warn('No parent Dataset entity found for dropped entry', relPath)
                continue
            }

            const targetEntity = { ...graph[effectiveTargetIndex] }
            const existingHasPart = this.normalizeHasPart(targetEntity.hasPart)
            const existingHasPartIds = new Set(existingHasPart.map((part) => part['@id']))
            const hasExistingPart =
                existingHasPartIds.has(id) ||
                (isDirectory &&
                    this.getDatasetIdVariants(id).some((variantId) =>
                        existingHasPartIds.has(variantId),
                    ))
            if (!hasExistingPart) {
                existingHasPart.push({ '@id': id })
            }
            if (existingHasPart.length) {
                targetEntity.hasPart = existingHasPart
            }
            graph[effectiveTargetIndex] = targetEntity
        }

        return { ...crate, '@graph': graph }
    }

    protected async resolveDroppedEntryInfo(
        relPath: string,
        sourceUri?: URI,
    ): Promise<{ fileUri?: URI; isDirectory: boolean }> {
        const fileUri = sourceUri ?? this.resolveWorkspaceRelativeUri(relPath)
        if (!fileUri) {
            return { fileUri: undefined, isDirectory: false }
        }
        try {
            const fileStat = await this.fileService.resolve(fileUri, { resolveMetadata: true })
            return { fileUri, isDirectory: Boolean(fileStat.isDirectory) }
        } catch (error) {
            console.warn('Failed to resolve dropped file metadata', relPath, error)
            return { fileUri, isDirectory: false }
        }
    }

    protected async buildDroppedEntityFromPath(
        relPath: string,
        sourceUri: URI | undefined,
        isDirectory: boolean,
        fileUri: URI | undefined,
    ): Promise<Record<string, any>> {
        const name =
            sourceUri?.path?.base ||
            sourceUri?.path?.name ||
            relPath.split('/').pop() ||
            relPath

        const baseEntityId = this.toFileEntityId(
            this.normalizeWorkspaceRelativePath(relPath),
            sourceUri,
        )
        const entityId = isDirectory ? this.toDatasetEntityId(baseEntityId) : baseEntityId

        if (isDirectory) {
            return {
                '@id': entityId,
                '@type': 'Dataset',
                name,
            }
        }

        const mimeType = mime.lookup(name) || 'application/octet-stream'
        const fileEntity: Record<string, any> = {
            '@id': entityId,
            '@type': 'File',
            name,
            encodingFormat: mimeType,
        }

        if (!fileUri) {
            return fileEntity
        }

        try {
            const fileStat = await this.fileService.resolve(fileUri, { resolveMetadata: true })
            fileEntity.contentSize = fileStat.size ? `${fileStat.size}` : undefined
            try {
                const content = await this.fileService.read(fileUri)
                fileEntity.hash = SparkMD5.hash(content.value)
            } catch (error) {
                console.warn('Failed to read dropped file for hash', relPath, error)
            }
        } catch (error) {
            console.warn('Failed to resolve dropped file metadata', relPath, error)
        }

        return fileEntity
    }

    protected resolveWorkspaceRelativeUri(relPath: string): URI | undefined {
        const roots = this.workspaceService.tryGetRoots()
        if (!roots || roots.length === 0) {
            return undefined
        }
        const rootUri = roots[0].resource
        return rootUri.resolve(relPath)
    }

    protected normalizeWorkspaceRelativePath(relPath: string): string {
        return relPath.replace(/\\/g, '/').replace(/^\.?\//, '')
    }

    protected toFileEntityId(relPath: string, sourceUri?: URI): string {
        if (sourceUri && !this.isWorkspaceUri(sourceUri)) {
            return this.formatAbsoluteFileUri(sourceUri)
        }
        return relPath
    }

    protected toLegacyWorkspaceFileEntityId(relPath: string): string {
        return `file://./${relPath}`
    }

    protected toDatasetEntityId(entityId: string): string {
        return entityId
    }

    protected getDatasetIdVariants(entityId: string): string[] {
        const withSlash = entityId.endsWith('/') ? entityId : `${entityId}/`
        const withoutSlash = withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash
        return Array.from(new Set([entityId, withSlash, withoutSlash]))
    }

    protected formatAbsoluteFileUri(uri: URI): string {
        if (uri.scheme !== 'file') {
            return uri.toString()
        }
        const rawPath = uri.path.toString()
        const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
        return `file://${encodeURI(normalizedPath)}`
    }

    protected isWorkspaceUri(uri: URI): boolean {
        const roots = this.workspaceService.tryGetRoots()
        if (!roots || roots.length === 0) {
            return false
        }
        const uriPath = uri.path.toString().toLowerCase()
        for (const root of roots) {
            const rootPath = root.resource.path.toString().toLowerCase()
            const rootPrefix = rootPath.endsWith('/') ? rootPath : `${rootPath}/`
            if (uriPath === rootPath || uriPath.startsWith(rootPrefix)) {
                return true
            }
        }
        return false
    }

    protected normalizeHasPart(value: any): { '@id': string }[] {
        if (!value) {
            return []
        }
        const raw = Array.isArray(value) ? value : [value]
        const normalized: { '@id': string }[] = []
        for (const entry of raw) {
            if (!entry) {
                continue
            }
            if (typeof entry === 'string') {
                normalized.push({ '@id': entry })
            } else if (typeof entry === 'object') {
                const id = (entry as any)['@id'] ?? (entry as any).id
                if (typeof id === 'string') {
                    normalized.push({ '@id': id })
                }
            }
        }
        return normalized
    }

    protected buildInvalidEntityIdSet(errors: any[] | undefined): Set<string> {
        return new Set(
            (errors ?? [])
                .map((error) => error?.entityId)
                .filter((entityId): entityId is string => Boolean(entityId)),
        )
    }

    protected sameEntityIdSet(a: Set<string>, b: Set<string>): boolean {
        if (a.size !== b.size) {
            return false
        }
        for (const id of a) {
            if (!b.has(id)) {
                return false
            }
        }
        return true
    }

    protected async openValidationErrorsDialog(): Promise<void> {
        const errors = this.appStateService.validationErrors ?? []
        const dialog = new RoCrateValidationErrorsDialog(
            errors,
            (entityId) => {
                void this.openRoCrateEditor(entityId)
            },
            () => {
                void this.openSchemaValidatorWidget()
            },
        )
        await dialog.open()
    }

    protected async openSchemaValidatorWidget(): Promise<void> {
        const existing = this.widgetManager.tryGetWidget(SchemaValidatorWidget.ID)
        if (existing) {
            this.ensureWidgetInSideArea(existing, 'left')
            await this.shell.activateWidget(existing.id)
            return
        }
        const widget = await this.widgetManager.getOrCreateWidget(SchemaValidatorWidget.ID)
        this.ensureWidgetInSideArea(widget, 'left')
        await this.shell.activateWidget(widget.id)
    }

    protected ensureWidgetInSideArea(widget: Widget, area: 'left' | 'right'): void {
        const sideWidgets = this.shell.getWidgets(area)
        if (sideWidgets.includes(widget)) {
            return
        }
        this.shell.addWidget(widget, { area })
    }

    dispose(): void {
        this.detachGlobalDragListeners()
        super.dispose()
        this.crateSubscription?.dispose()
        this.validationSubscription?.dispose()
        this.shellFocusSubscription?.dispose()
    }
}
