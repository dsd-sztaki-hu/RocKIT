import { CompositeTreeNode, ExpandableTreeNode, SelectableTreeNode, TreeModelImpl, TreeNode } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Item, EntitiesOverviewTreeItemFactory } from './entities-overview-tree-item-factory';

// Entity interface with type and valid properties
export interface Entity {
    id: string;
    technicalName: string;
    description: string;
    type: string;
    valid: boolean;
}

// Mocked entities with type and valid properties
export const MOCKED_ENTITIES: Entity[] = [
    // --- Authors ---
    {
        id: 'auth-1',
        technicalName: 'Tóth, Zoltán',
        description: 'Author - (SZTAKI staff)',
        type: 'author',
        valid: true
    },
    {
        id: 'auth-2',
        technicalName: 'Nagy, Eszter',
        description: 'Author - (External Contributor)',
        type: 'author',
        valid: true
    },

    // --- Files (From your image) ---
    {
        id: 'file-1',
        technicalName: 'jargon.html',
        description: 'File - Documentation Glossary',
        type: 'file',
        valid: true
    },
    {
        id: 'file-2',
        technicalName: 'keyboard-interface.html',
        description: 'File - Accessibility Settings',
        type: 'file',
        valid: false
    },
    {
        id: 'file-3',
        technicalName: 'label.html',
        description: 'File - UI Label definitions',
        type: 'file',
        valid: true
    },
    {
        id: 'file-4',
        technicalName: 'large-scale.html',
        description: 'File - Scalability Tests',
        type: 'file',
        valid: false
    },

    // --- Datasets (Implicit from image) ---
    {
        id: 'data-1',
        technicalName: 'SZTAKI_Dataset_V1',
        description: 'Dataset - Raw sensor logs',
        type: 'dataset',
        valid: true
    },
    {
        id: 'data-2',
        technicalName: 'Export_2023_Q4',
        description: 'Dataset - Quarterly archive',
        type: 'dataset',
        valid: false
    },

    // --- Point of Contact (Implicit from image) ---
    {
        id: 'poc-1',
        technicalName: 'Tóth, Zoltán',
        description: 'Point of Contact - System Administrator',
        type: 'pointOfContact',
        valid: false
    },

    {
        id: 'poc-2',
        technicalName: 'Nagy, Eszter',
        description: 'Author - (External Contributor)',
        type: 'pointOfContact',
        valid: true
    }
];

// Function to extract unique entity types and capitalize the first letter
function getUniqueEntityTypes(): string[] {
    const types = new Set<string>();
    MOCKED_ENTITIES.forEach(entity => types.add(entity.type));
    return Array.from(types).map(type => type.charAt(0).toUpperCase() + type.slice(1));
}

// Function to create entities data dynamically based on unique types
function createEntitiesData(): Item[] {
    const uniqueTypes = getUniqueEntityTypes();

    return uniqueTypes.map(typeName => {
        const typeKey = typeName.charAt(0).toLowerCase() + typeName.slice(1);

        return {
            name: typeName,
            children: MOCKED_ENTITIES
                .filter(e => e.type === typeKey)
                .map(entity => ({
                    name: entity.technicalName,
                    id: entity.id,
                    description: entity.description,
                    valid: entity.valid
                }))
        };
    });
}

// Group entities by type dynamically
const ENTITIES_DATA: Item[] = createEntitiesData();

/** well-known ID for the root node in our tree */
export const ROOT_NODE_ID = 'entities-overview-root';

/** Interface for an container node (having children), along with a type-checking function */
export interface ExampleTreeNode extends ExpandableTreeNode, SelectableTreeNode {
    data: Item;
    type: 'node';
}
export namespace ExampleTreeNode {
    export function is(candidate: object): candidate is ExampleTreeNode {
        return ExpandableTreeNode.is(candidate) && 'type' in candidate && candidate.type === 'node';
    }
}

/**
 *  Interface for a leaf node, along with a type-checking function
 *
 *  The "quantityLabel" property could be used to display a different label for invalid nodes.
 *  It was originally used in the label-provider file's getName() function, still there commented out.
 */
export interface ExampleTreeLeaf extends TreeNode {
    data: Item;
    // quantityLabel?: string;
    type: 'leaf';
}
export namespace ExampleTreeLeaf {
    export function is(candidate: object): candidate is ExampleTreeLeaf {
        return TreeNode.is(candidate) && 'type' in candidate && candidate.type === 'leaf';
    }
}

/**
 * The Tree Model for the entities overview.
 *
 * This class contains the bridge between business model and tree model and realizes operations on the data.
 */
@injectable()
export class EntitiesOverviewModel extends TreeModelImpl {
    @inject(EntitiesOverviewTreeItemFactory) private readonly itemFactory: EntitiesOverviewTreeItemFactory;

    /**
     * Initialize the tree model from the business model
     */
    @postConstruct()
    protected override init(): void {
        super.init();

        // create the root node
        const root: CompositeTreeNode = {
            id: ROOT_NODE_ID,
            parent: undefined,
            children: [],
            visible: false // do not show the root node in the UI
        };

        // populate the direct children
        ENTITIES_DATA.map(item => this.itemFactory.toTreeNode(item))
            .forEach(node => CompositeTreeNode.addChild(root, node));

        // set the root node as root of the tree
        // This will also initialize the ID-node-map in the tree, so this should be called
        // after populating the children.
        this.tree.root = root;
    }

    /**
     * This is executed when a tree item's checkbox is checked/unchecked.
     *
     * For this example, the check state is applied to the business model (backOrdered property).
     *
     * @param node the affected node
     * @param checked the new state of the checkbox
     */
    override markAsChecked(node: TreeNode, checked: boolean): void {
        if (ExampleTreeLeaf.is(node)) {
            node.data.backOrdered = checked;
        }
        super.markAsChecked(node, checked);
    }

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
    public addItem(parent: TreeNode): void {
        if (ExampleTreeNode.is(parent)) {
            const newItem: Item = { name: 'New Entity', valid: true };
            parent.data.children?.push(newItem);
            // since we have modified the tree structure, we need to refresh the parent node
            this.tree.refresh(parent);
        }
    }

    /**
     * Logic to move an leaf node to a new container node.
     *
     * This is used in the Drag & Drop demonstration code to move a dragged item.
     *
     * @param nodeIdToReparent the node ID of the leaf node to move
     * @param targetNode the new parent of the leaf node
     */
    public reparent(nodeIdToReparent: string, targetNode: ExampleTreeNode): void {
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
    }
}