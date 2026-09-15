// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import {
    CompositeTreeNode,
    DepthFirstTreeIterator,
    ExpandableTreeNode,
    SelectableTreeNode,
    TreeModelImpl,
    TreeNode,
} from '@theia/core/lib/browser'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import { nls } from '@theia/core/lib/common/nls'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import {
    EntitiesOverviewTreeItemFactory,
    Item,
} from './entities-overview-tree-item-factory'
import { EntitiesOverviewTree } from './entities-overview-tree'

export type EntityMatcher = (entity: Record<string, unknown>) => boolean

function formatTypeLabel(rawType: string): string {
    const trimmed = rawType.trim()
    if (!trimmed) {
        return 'Unknown'
    }
    const tail = trimmed.includes('/') ? trimmed.split('/').pop() || trimmed : trimmed
    return tail.charAt(0).toUpperCase() + tail.slice(1)
}

/**
 * Returns the list of type labels for an entity, using:
 * - profile.localisation[tail] first
 * - then profile.classes[tail].label
 * - else falls back to formatTypeLabel(tail)
 *
 * IMPORTANT: localisation keys can be case-sensitive (e.g. dsDescription),
 * so we must lookup using the raw tail before formatting.
 */
type EntityTypeEntry = { key: string; label: string }

function getEntityTypeEntries(
    entity: Record<string, any>,
    profile?: Record<string, any>,
): EntityTypeEntry[] {
    const rawTypes = entity?.['@type']
    if (!rawTypes) {
        return [{ key: 'Unknown', label: nls.localize('rockit/entitiesOverview/unknown', 'Unknown') }]
    }

    const typeList = Array.isArray(rawTypes) ? rawTypes : [rawTypes]

    return typeList.map((type) => {
        const raw = String(type).trim()
        const tail = raw.includes('/') ? raw.split('/').pop()! : raw

        const localized = profile?.localisation?.[tail] ?? profile?.classes?.[tail]?.label

        return {
            // keep main's stable grouping key (raw type string)
            key: raw,
            label: localized?.trim() || formatTypeLabel(tail),
        }
    })
}

function hasType(entity: Record<string, any>, target: string): boolean {
    const rawTypes = entity?.['@type']
    if (!rawTypes) {
        return false
    }
    const typeList = Array.isArray(rawTypes) ? rawTypes : [rawTypes]
    return typeList.some((type) => {
        const value = String(type)
        return value === target || value.endsWith(`/${target}`)
    })
}

function getEntityName(entity: Record<string, any>): string {
    const name = entity?.name ?? entity?.title ?? entity?.['@id'] ?? ''
    return String(name)
}

function normalizeFilter(value: string): string {
    return value.trim().toLowerCase()
}

function getAvailableTypes(
    crate: Record<string, any> | undefined,
    profile?: Record<string, any>,
): string[] {
    const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
    const types = new Set<string>()
    for (const entry of graph) {
        if (!entry || typeof entry !== 'object') {
            continue
        }
        if (hasType(entry, 'CreativeWork')) {
            continue
        }
        for (const typeEntry of getEntityTypeEntries(entry, profile)) {
            types.add(typeEntry.label)
        }
    }
    return Array.from(types.values()).sort((a, b) => a.localeCompare(b))
}

function createEntitiesData(
    crate: Record<string, any> | undefined,
    profile: Record<string, any> | undefined,
    nameFilter: string,
    typeFilters: string[],
    validityFilter: ValidityFilter,
    invalidEntityIds: Set<string>,
    selectedEntityIds: Set<string>,
    advancedEntityMatcher?: EntityMatcher,
): Item[] {
    const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
    const byType = new Map<string, { label: string; items: Item[] }>()

    const normalizedNameFilter = normalizeFilter(nameFilter)
    const normalizedTypeFilters = new Set(
        typeFilters.map((type) => normalizeFilter(type)),
    )

    for (const entry of graph) {
        if (!entry || typeof entry !== 'object') {
            continue
        }
        if (hasType(entry, 'CreativeWork')) {
            continue
        }

        const entityId = entry?.['@id'] ? String(entry['@id']) : ''
        const name = getEntityName(entry).trim()
        const description =
            typeof entry?.description === 'string' ? String(entry.description) : undefined

        // keep main's validationErrors integration + branch's "name is required" notion
        const valid = Boolean(name) && !invalidEntityIds.has(entityId)

        const displayName = entityId === './' ? './' : name || entityId || '(unnamed)'

        const matchesName =
            !normalizedNameFilter || displayName.toLowerCase().includes(normalizedNameFilter)

        const matchesValidity =
            validityFilter === 'all' ||
            (validityFilter === 'valid' && valid) ||
            (validityFilter === 'invalid' && !valid)

        if (!matchesName || !matchesValidity) {
            continue
        }

        const typeEntries = getEntityTypeEntries(entry, profile)
        const entityTypes = typeEntries.map((typeEntry) => typeEntry.key)
        const encodingFormat =
            typeof entry?.encodingFormat === 'string' ? String(entry.encodingFormat) : undefined
        if (normalizedTypeFilters.size > 0) {
            const hasMatchingType = typeEntries.some((typeEntry) =>
                normalizedTypeFilters.has(typeEntry.label.toLowerCase()),
            )
            if (!hasMatchingType) {
                continue
            }
        }

        if (advancedEntityMatcher && !advancedEntityMatcher(entry)) {
            continue
        }

        for (const typeEntry of typeEntries) {
            const normalizedTypeLabel = typeEntry.label.toLowerCase()

            if (normalizedTypeFilters.size > 0 && !normalizedTypeFilters.has(normalizedTypeLabel)) {
                continue
            }

            const group = byType.get(typeEntry.key) ?? { label: typeEntry.label, items: [] }
            group.items.push({
                name: displayName,
                entityId,
                entityTypes,
                encodingFormat,
                description,
                valid,
                // keep main's stable ids
                treeId: `leaf:${typeEntry.key}:${entityId || displayName}`,
                // keep branch's selected flag
                selected: entityId ? selectedEntityIds.has(entityId) : false,
            })
            byType.set(typeEntry.key, group)
        }
    }

    return Array.from(byType.entries())
        .sort(([, a], [, b]) => a.label.localeCompare(b.label))
        .map(([typeKey, group]) => ({
            name: group.label,
            treeId: `type:${typeKey}`,
            children: group.items.sort((a, b) => a.name.localeCompare(b.name)),
        }))
}

/** well-known ID for the root node in our tree */
export const ROOT_NODE_ID = 'entities-overview-root'

/** Interface for an container node (having children), along with a type-checking function */
export interface ExampleTreeNode extends ExpandableTreeNode, SelectableTreeNode {
    data: Item
    type: 'node'
}
export namespace ExampleTreeNode {
    export function is(candidate: object): candidate is ExampleTreeNode {
        return (
            ExpandableTreeNode.is(candidate) && 'type' in candidate && candidate.type === 'node'
        )
    }
}

/**
 *  Interface for a leaf node, along with a type-checking function
 */
export interface ExampleTreeLeaf extends TreeNode {
    data: Item
    type: 'leaf'
}
export namespace ExampleTreeLeaf {
    export function is(candidate: object): candidate is ExampleTreeLeaf {
        return TreeNode.is(candidate) && 'type' in candidate && candidate.type === 'leaf'
    }
}

export type ValidityFilter = 'all' | 'valid' | 'invalid'

@injectable()
export class EntitiesOverviewModel extends TreeModelImpl {
    private static readonly INITIAL_RENDERED_CHILDREN = 150
    private static readonly RENDERED_CHILDREN_BATCH = 200

    @inject(EntitiesOverviewTreeItemFactory)
    private readonly itemFactory: EntitiesOverviewTreeItemFactory

    @inject(AppStateService)
    private readonly appStateService: AppStateService

    private currentCrate: Record<string, any> | undefined
    private entityNameFilter = ''
    private entityTypeFilters: string[] = []
    private validityFilter: ValidityFilter = 'all'
    private advancedEntityMatcher: EntityMatcher | undefined

    // branch: multi-select tracked independently from tree selection
    private readonly selectedEntityIds = new Set<string>()
    private lastSelectedEntityId: string | undefined
    private leafNodesByEntityId = new Map<string, ExampleTreeLeaf[]>()

    getSelectedEntityIds(): string[] {
        return Array.from(this.selectedEntityIds)
    }

    getVisibleEntityIds(): string[] {
        const root = this.tree.root
        if (!root) {
            return []
        }
        const unique = new Set<string>()
        for (const node of new DepthFirstTreeIterator(root)) {
            if (ExampleTreeLeaf.is(node)) {
                const entityId = node.data.entityId
                if (entityId) {
                    unique.add(entityId)
                }
            }
        }
        return Array.from(unique)
    }

    async getVisibleEntityIdsAsync(
        onProgress?: (worked: number) => void,
    ): Promise<string[]> {
        const root = this.tree.root
        if (!root) {
            return []
        }
        const unique = new Set<string>()
        let processed = 0
        let sliceStarted = performance.now()
        for (const node of new DepthFirstTreeIterator(root)) {
            if (ExampleTreeLeaf.is(node)) {
                const entityId = node.data.entityId
                if (entityId) {
                    unique.add(entityId)
                }
            }
            processed += 1
            if (processed % 250 === 0 && performance.now() - sliceStarted >= 12) {
                onProgress?.(processed)
                await new Promise<void>((resolve) => setTimeout(resolve, 0))
                sliceStarted = performance.now()
            }
        }
        onProgress?.(processed)
        return Array.from(unique)
    }

    clearSelection(): void {
        if (this.selectedEntityIds.size === 0) return
        const ids = Array.from(this.selectedEntityIds)
        this.selectedEntityIds.clear()
        this.lastSelectedEntityId = undefined
        this.updateLeafSelection(ids)
    }

    selectSingle(entityId: string): void {
        const changed =
            this.selectedEntityIds.size !== 1 || !this.selectedEntityIds.has(entityId)
        if (!changed) return

        const previous = Array.from(this.selectedEntityIds)
        this.selectedEntityIds.clear()
        this.selectedEntityIds.add(entityId)
        this.lastSelectedEntityId = entityId
        this.updateLeafSelection([...previous, entityId])
    }

    toggleSelection(entityId: string): void {
        if (this.selectedEntityIds.has(entityId)) {
            this.selectedEntityIds.delete(entityId)
            if (this.lastSelectedEntityId === entityId) {
                this.lastSelectedEntityId = this.getSelectedEntityIds().slice(-1)[0]
            }
        } else {
            this.selectedEntityIds.add(entityId)
            this.lastSelectedEntityId = entityId
        }
        this.updateLeafSelection([entityId])
    }

    selectRangeTo(entityId: string): void {
        const visibleEntityIds = this.getVisibleEntityIds()
        const clickedIndex = visibleEntityIds.indexOf(entityId)
        if (clickedIndex < 0) {
            return
        }

        const anchorId = this.lastSelectedEntityId
        const anchorIndex = anchorId ? visibleEntityIds.indexOf(anchorId) : -1

        if (!anchorId || anchorIndex < 0) {
            if (!this.selectedEntityIds.has(entityId)) {
                this.selectedEntityIds.add(entityId)
                this.updateLeafSelection([entityId])
            }
            this.lastSelectedEntityId = entityId
            return
        }

        const start = Math.min(anchorIndex, clickedIndex)
        const end = Math.max(anchorIndex, clickedIndex)
        const rangeIds = visibleEntityIds.slice(start, end + 1)
        const changed: string[] = []
        for (const id of rangeIds) {
            if (!this.selectedEntityIds.has(id)) {
                this.selectedEntityIds.add(id)
                changed.push(id)
            }
        }

        this.lastSelectedEntityId = entityId
        if (changed.length > 0) {
            this.updateLeafSelection(changed)
        }
    }

    @postConstruct()
    protected override init(): void {
        super.init()

        this.updateEntitiesFromCrate(this.appStateService.roCrate)
        this.toDispose.push(
            this.appStateService.onDidChangeSelector((state) => state.roCrate)((crate) => {
                this.updateEntitiesFromCrate(crate)
            }),
        )
        this.toDispose.push(
            this.appStateService.onDidChangeSelector((state) => state.completeProfile)(() => {
                this.refreshFilteredTree()
            }),
        )
        // main: refresh on validation changes
        this.toDispose.push(
            this.appStateService.onDidChangeSelector((state) => state.validationErrors)(() => {
                this.refreshFilteredTree()
            }),
        )
    }

    protected updateEntitiesFromCrate(crate: Record<string, any> | undefined): void {
        this.currentCrate = crate
        this.refreshFilteredTree()
    }

    setFilters(
        entityNameFilter: string,
        entityTypeFilters: string[],
        validityFilter: ValidityFilter,
    ): void {
        if (
            entityNameFilter === this.entityNameFilter &&
            entityTypeFilters.length === this.entityTypeFilters.length &&
            entityTypeFilters.every(
                (value, index) => value === this.entityTypeFilters[index],
            ) &&
            validityFilter === this.validityFilter
        ) {
            return
        }
        this.entityNameFilter = entityNameFilter
        this.entityTypeFilters = [...entityTypeFilters]
        this.validityFilter = validityFilter
        this.refreshFilteredTree()
    }

    setAdvancedEntityMatcher(matcher: EntityMatcher | undefined): void {
        if (this.advancedEntityMatcher === matcher) {
            return
        }
        this.advancedEntityMatcher = matcher
        this.refreshFilteredTree()
    }

    getAvailableTypes(): string[] {
        return getAvailableTypes(this.currentCrate, this.appStateService.completeProfile)
    }

    protected override handleExpansion(node: Readonly<ExpandableTreeNode>): void {
        super.handleExpansion(node)
        if (!ExampleTreeNode.is(node)) {
            return
        }

        this.rebuildLeafIndex(this.tree.root)
        this.updateLeafSelection(Array.from(this.selectedEntityIds))
    }

    async loadMoreVisibleChildren(
        batchSize = EntitiesOverviewModel.RENDERED_CHILDREN_BATCH,
    ): Promise<boolean> {
        const root = this.tree.root
        if (!root) {
            return false
        }

        for (const node of new DepthFirstTreeIterator(root)) {
            if (!ExampleTreeNode.is(node) || !node.expanded || !this.hasMoreChildren(node)) {
                continue
            }

            this.appendChildren(node, batchSize)
            this.rebuildLeafIndex(root)
            await this.refresh(node)
            return true
        }

        return false
    }

    private refreshFilteredTree(): void {
        // main: keep nodes stable between refreshes
        const existingNodes = new Map<string, TreeNode>()
        if (this.tree.root) {
            for (const treeNode of new DepthFirstTreeIterator(this.tree.root)) {
                existingNodes.set(treeNode.id, treeNode)
            }
        }

        const root: CompositeTreeNode = {
            id: ROOT_NODE_ID,
            parent: undefined,
            children: [],
            visible: false,
        }

        const shouldExpand = Boolean(
            this.entityNameFilter.trim() ||
            this.entityTypeFilters.length > 0 ||
            this.validityFilter !== 'all' ||
            this.advancedEntityMatcher,
        )

        const invalidEntityIds = new Set(
            (this.appStateService.validationErrors ?? [])
                .map((error) => error?.entityId)
                .filter((entityId): entityId is string => Boolean(entityId)),
        )

        const selected = new Set(this.selectedEntityIds)
        const groupedItems = createEntitiesData(
            this.currentCrate,
            this.appStateService.completeProfile,
            this.entityNameFilter,
            this.entityTypeFilters,
            this.validityFilter,
            invalidEntityIds,
            selected,
            this.advancedEntityMatcher,
        )
        groupedItems
            .map((item) => this.buildTreeNode(item, root, existingNodes, shouldExpand))
            .forEach((node) => CompositeTreeNode.addChild(root, node))
        this.tree.root = root
        this.rebuildLeafIndex(root)

        // keep leaf "selected" flags in sync after rebuild
        this.updateLeafSelection(Array.from(this.selectedEntityIds))
    }

    // main: stable tree nodes
    private buildTreeNode(
        item: Item,
        parent: CompositeTreeNode,
        existingNodes: Map<string, TreeNode>,
        shouldExpand: boolean,
    ): TreeNode {
        const freshNode = this.itemFactory.toTreeNode(item)
        const existing = existingNodes.get(freshNode.id)
        const node =
            existing && this.isSameNodeType(existing, freshNode) ? existing : freshNode
        this.setParent(node, parent)
        ;(node as ExampleTreeNode | ExampleTreeLeaf).data = item

        if (ExampleTreeNode.is(node)) {
            const sourceChildren = item.children ?? []
            const existingChildCount =
                existing && ExampleTreeNode.is(existing) ? existing.children.length : 0
            const childLimit = shouldExpand
                ? Math.min(
                      sourceChildren.length,
                      Math.max(
                          existingChildCount,
                          EntitiesOverviewModel.INITIAL_RENDERED_CHILDREN,
                      ),
                  )
                : 0
            const children = sourceChildren
                .slice(0, childLimit)
                .map((child) => this.buildTreeNode(child, node, existingNodes, shouldExpand))
            node.children = children
            if (!existing || !ExampleTreeNode.is(existing)) {
                node.expanded = shouldExpand
            }
        }

        return node
    }

    private isSameNodeType(a: TreeNode, b: TreeNode): boolean {
        return (
            (ExampleTreeNode.is(a) && ExampleTreeNode.is(b)) ||
            (ExampleTreeLeaf.is(a) && ExampleTreeLeaf.is(b))
        )
    }

    private setParent(node: TreeNode, parent: CompositeTreeNode): void {
        ;(node as { parent: CompositeTreeNode | undefined }).parent = parent
    }

    private hasMoreChildren(node: ExampleTreeNode): boolean {
        return node.children.length < (node.data.children?.length ?? 0)
    }

    private appendChildren(node: ExampleTreeNode, batchSize: number): TreeNode[] {
        const sourceChildren = node.data.children ?? []
        const start = node.children.length
        const end = Math.min(sourceChildren.length, start + batchSize)
        if (start >= end) {
            return []
        }

        const children = node.children as TreeNode[]
        const added = sourceChildren.slice(start, end).map((item) => {
            const child = this.itemFactory.toTreeNode(item)
            if (ExampleTreeLeaf.is(child) && child.data.entityId) {
                child.data.selected = this.selectedEntityIds.has(child.data.entityId)
            }
            this.setParent(child, node)
            return child
        })
        children.push(...added)
        return added
    }

    // branch: update leaf node selection (requires EntitiesOverviewTree.notifyUpdated)
    private updateLeafSelection(entityIds: string[]): void {
        if (entityIds.length === 0) return
        const tree = this.tree as EntitiesOverviewTree
        const updated: TreeNode[] = []
        for (const entityId of entityIds) {
            const nodes = this.leafNodesByEntityId.get(entityId) ?? []
            if (nodes.length === 0) {
                continue
            }
            for (const node of nodes) {
                node.data.selected = this.selectedEntityIds.has(entityId)
                updated.push(node)
            }
        }
        if (updated.length > 0) {
            tree.notifyUpdated(updated)
        }
    }

    private rebuildLeafIndex(root: TreeNode | undefined): void {
        const next = new Map<string, ExampleTreeLeaf[]>()
        if (!root) {
            this.leafNodesByEntityId = next
            return
        }
        for (const node of new DepthFirstTreeIterator(root)) {
            if (!ExampleTreeLeaf.is(node)) {
                continue
            }
            const entityId = node.data.entityId
            if (!entityId) {
                continue
            }
            const bucket = next.get(entityId) ?? []
            bucket.push(node)
            next.set(entityId, bucket)
        }
        this.leafNodesByEntityId = next
    }
}
