import {
  CompositeTreeNode,
  ExpandableTreeNode,
  SelectableTreeNode,
  TreeModelImpl,
  TreeNode,
} from '@theia/core/lib/browser'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import {
  EntitiesOverviewTreeItemFactory,
  Item,
} from './entities-overview-tree-item-factory'

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
function getEntityTypes(
  entity: Record<string, any>,
  profile?: Record<string, any>,
): string[] {
  const rawTypes = entity?.['@type']
  if (!rawTypes) {
    return ['Unknown']
  }

  const typeList = Array.isArray(rawTypes) ? rawTypes : [rawTypes]

  return typeList.map((type) => {
    const raw = String(type).trim()
    const tail = raw.includes('/') ? raw.split('/').pop()! : raw

    const localized = profile?.localisation?.[tail] ?? profile?.classes?.[tail]?.label

    return localized?.trim() || formatTypeLabel(tail)
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
    for (const typeLabel of getEntityTypes(entry, profile)) {
      types.add(typeLabel)
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
  selectedEntityIds: Set<string>,
): Item[] {
  const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
  const byType = new Map<string, Item[]>()

  const normalizedNameFilter = normalizeFilter(nameFilter)
  const normalizedTypeFilters = typeFilters.map((type) => normalizeFilter(type))

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
    const valid = Boolean(name)
    const displayName = entityId === './' ? './' : name || entityId || '(unnamed)'

    const matchesName =
      !normalizedNameFilter || displayName.toLowerCase().includes(normalizedNameFilter)

    const matchesValidity =
      validityFilter === 'all' ||
      (validityFilter === 'valid' && valid) ||
      (validityFilter === 'invalid' && !valid)

    // NOTE: type labels here must match what getAvailableTypes returns
    for (const typeLabel of getEntityTypes(entry, profile)) {
      const normalizedTypeLabel = typeLabel.toLowerCase()

      if (
        normalizedTypeFilters.length > 0 &&
        !normalizedTypeFilters.some((type) => type === normalizedTypeLabel)
      ) {
        continue
      }
      if (!matchesName) {
        continue
      }
      if (!matchesValidity) {
        continue
      }

      const list = byType.get(typeLabel) ?? []
      list.push({
        name: displayName,
        entityId,
        description,
        valid,
        selected: entityId ? selectedEntityIds.has(entityId) : false,
      })
      byType.set(typeLabel, list)
    }
  }

  return Array.from(byType.entries()).map(([typeName, children]) => ({
    name: typeName,
    children: children.sort((a, b) => a.name.localeCompare(b.name)),
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
  @inject(EntitiesOverviewTreeItemFactory)
  private readonly itemFactory: EntitiesOverviewTreeItemFactory

  @inject(AppStateService)
  private readonly appStateService: AppStateService

  private currentCrate: Record<string, any> | undefined
  private entityNameFilter = ''
  private entityTypeFilters: string[] = []
  private validityFilter: ValidityFilter = 'all'

  private readonly selectedEntityIds = new Set<string>()

  getSelectedEntityIds(): string[] {
    return Array.from(this.selectedEntityIds)
  }

  clearSelection(): void {
    if (this.selectedEntityIds.size === 0) return
    this.selectedEntityIds.clear()
    this.refreshFilteredTree()
  }

  selectSingle(entityId: string): void {
    const changed =
      this.selectedEntityIds.size !== 1 || !this.selectedEntityIds.has(entityId)
    if (!changed) return

    this.selectedEntityIds.clear()
    this.selectedEntityIds.add(entityId)
    this.refreshFilteredTree()
  }

  toggleSelection(entityId: string): void {
    if (this.selectedEntityIds.has(entityId)) {
      this.selectedEntityIds.delete(entityId)
    } else {
      this.selectedEntityIds.add(entityId)
    }
    this.refreshFilteredTree()
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

  getAvailableTypes(): string[] {
    // IMPORTANT: use the same profile-based type labels as the tree itself,
    // otherwise filtering by type won't match what the user sees.
    return getAvailableTypes(this.currentCrate, this.appStateService.completeProfile)
  }

  private refreshFilteredTree(): void {
    const root: CompositeTreeNode = {
      id: ROOT_NODE_ID,
      parent: undefined,
      children: [],
      visible: false,
    }

    const shouldExpand = Boolean(
      this.entityNameFilter.trim() ||
        this.entityTypeFilters.length > 0 ||
        this.validityFilter !== 'all',
    )

    const selected = new Set(this.selectedEntityIds)

    createEntitiesData(
      this.currentCrate,
      this.appStateService.completeProfile,
      this.entityNameFilter,
      this.entityTypeFilters,
      this.validityFilter,
      selected,
    )
      .map((item) => {
        const node = this.itemFactory.toTreeNode(item)
        if (shouldExpand && ExampleTreeNode.is(node)) {
          node.expanded = true
        }
        return node
      })
      .forEach((node) => CompositeTreeNode.addChild(root, node))

    this.tree.root = root
  }
}
