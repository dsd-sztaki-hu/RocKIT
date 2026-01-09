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

function getEntityTypes(entity: Record<string, any>): string[] {
  const rawTypes = entity?.['@type']
  if (!rawTypes) {
    return ['Unknown']
  }
  const typeList = Array.isArray(rawTypes) ? rawTypes : [rawTypes]
  return typeList.map((type) => formatTypeLabel(String(type)))
}

function getEntityName(entity: Record<string, any>): string {
  const name = entity?.name ?? entity?.title ?? entity?.['@id'] ?? ''
  return String(name)
}

function createEntitiesData(crate: Record<string, any> | undefined): Item[] {
  const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
  const byType = new Map<string, Item[]>()

  for (const entry of graph) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const entityId = entry?.['@id'] ? String(entry['@id']) : ''
    const name = getEntityName(entry).trim()
    const description =
      typeof entry?.description === 'string' ? String(entry.description) : undefined
    const valid = Boolean(name)
    const displayName = name || entityId || '(unnamed)'

    for (const typeLabel of getEntityTypes(entry)) {
      const list = byType.get(typeLabel) ?? []
      list.push({
        name: displayName,
        entityId,
        description,
        valid,
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
 *
 *  The "quantityLabel" property could be used to display a different label for invalid nodes.
 *  It was originally used in the label-provider file's getName() function, still there commented out.
 */
export interface ExampleTreeLeaf extends TreeNode {
  data: Item
  // quantityLabel?: string;
  type: 'leaf'
}
export namespace ExampleTreeLeaf {
  export function is(candidate: object): candidate is ExampleTreeLeaf {
    return TreeNode.is(candidate) && 'type' in candidate && candidate.type === 'leaf'
  }
}

/**
 * The Tree Model for the entities overview.
 *
 * This class contains the bridge between business model and tree model and realizes operations on the data.
 */
@injectable()
export class EntitiesOverviewModel extends TreeModelImpl {
  @inject(EntitiesOverviewTreeItemFactory)
  private readonly itemFactory: EntitiesOverviewTreeItemFactory
  @inject(AppStateService)
  private readonly appStateService: AppStateService

  /**
   * Initialize the tree model from the business model
   */
  @postConstruct()
  protected override init(): void {
    super.init()

    this.updateEntitiesFromCrate(this.appStateService.roCrate)
    this.toDispose.push(
      this.appStateService.onDidChangeSelector((state) => state.roCrate)((crate) => {
        this.updateEntitiesFromCrate(crate)
      }),
    )
  }

  protected updateEntitiesFromCrate(crate: Record<string, any> | undefined): void {
    // create the root node
    const root: CompositeTreeNode = {
      id: ROOT_NODE_ID,
      parent: undefined,
      children: [],
      visible: false, // do not show the root node in the UI
    }

    // populate the direct children
    createEntitiesData(crate)
      .map((item) => this.itemFactory.toTreeNode(item))
      .forEach((node) => CompositeTreeNode.addChild(root, node))

    // set the root node as root of the tree
    // This will also initialize the ID-node-map in the tree, so this should be called
    // after populating the children.
    this.tree.root = root
  }

  /**
   * This is executed when a tree item's checkbox is checked/unchecked.
   *
   * For this example, the check state is applied to the business model (backOrdered property).
   *
   * @param node the affected node
   * @param checked the new state of the checkbox
   */
  /*override markAsChecked(node: TreeNode, checked: boolean): void {
        if (ExampleTreeLeaf.is(node)) {
            node.data.backOrdered = checked;
        }
        super.markAsChecked(node, checked);
    }*/

  /**
   * Logic to add a new child item to the given parent.
   *
   * For simplicity, we use a static/constant child, so we don't have to implement UI to ask the user for the name etc.
   * Note that because of the TreeNode.id initialization to Item.name, this method should only be called once. Otherwise
   * we end up with multiple tree items with the same ID, which is not desirable.
   *
   * So in practice, the id should be calculated in a better way...
   *
   * @param parent the parent of the new item
   */
  /*public addItem(parent: TreeNode): void {
        if (ExampleTreeNode.is(parent)) {
            const newItem: Item = { name: 'New Entity', valid: true };
            parent.data.children?.push(newItem);
            // since we have modified the tree structure, we need to refresh the parent node
            this.tree.refresh(parent);
        }
    }*/

  /**
   * Logic to move an leaf node to a new container node.
   *
   * This is used in the Drag & Drop demonstration code to move a dragged item.
   *
   * @param nodeIdToReparent the node ID of the leaf node to move
   * @param targetNode the new parent of the leaf node
   */
  /*public reparent(nodeIdToReparent: string, targetNode: ExampleTreeNode): void {
        // resolve the ID to the actual node (using the ID-to-node map of the tree)
        const nodeToReparent = this.tree.getNode(nodeIdToReparent);

        // get the original parent
        const sourceParent = nodeToReparent?.parent;
        if (nodeToReparent && ExampleTreeLeaf.is(nodeToReparent)
            && sourceParent && ExampleTreeNode.is(sourceParent)) {
            // find the nodeToReparent in the sourceParent's children
            const indexInCurrentParent = sourceParent.data.children!.indexOf(nodeToReparent.data);
            if (indexInCurrentParent !== -1) {
                // remove the node from its old location (in the business model)
                sourceParent.data.children?.splice(indexInCurrentParent, 1);
                // add the node to its new location (in the business model)
                targetNode.data.children?.push(nodeToReparent.data);
                // trigger refreshes so that the tree is updated according to the structural changes made
                this.tree.refresh(sourceParent);
                this.tree.refresh(targetNode);
            }
        }
    }*/
}
