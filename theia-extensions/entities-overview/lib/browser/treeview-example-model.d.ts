import { ExpandableTreeNode, SelectableTreeNode, TreeModelImpl, TreeNode } from '@theia/core/lib/browser';
import { Item } from './treeview-example-tree-item-factory';
export interface Entity {
    id: string;
    technicalName: string;
    description: string;
    type: 'author' | 'file' | 'dataset' | 'pointOfContact';
}
export declare const MOCKED_ENTITIES: Entity[];
/** well-known ID for the root node in our tree */
export declare const ROOT_NODE_ID = "entities-overview-root";
/** Interface for an container node (having children), along with a type-checking function */
export interface ExampleTreeNode extends ExpandableTreeNode, SelectableTreeNode {
    data: Item;
    type: 'node';
}
export declare namespace ExampleTreeNode {
    function is(candidate: object): candidate is ExampleTreeNode;
}
/** Interface for a leaf node, along with a type-checking function */
export interface ExampleTreeLeaf extends TreeNode {
    data: Item;
    quantityLabel?: string;
    type: 'leaf';
}
export declare namespace ExampleTreeLeaf {
    function is(candidate: object): candidate is ExampleTreeLeaf;
}
/**
 * The Tree Model for the entities overview.
 *
 * This class contains the bridge between business model and tree model and realizes operations on the data.
 */
export declare class TreeViewExampleModel extends TreeModelImpl {
    private readonly itemFactory;
    /**
     * Initialize the tree model from the business model
     */
    protected init(): void;
    /**
     * This is executed when a tree item's checkbox is checked/unchecked.
     *
     * For this example, the check state is applied to the business model (backOrdered property).
     *
     * @param node the affected node
     * @param checked the new state of the checkbox
     */
    markAsChecked(node: TreeNode, checked: boolean): void;
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
    addItem(parent: TreeNode): void;
    /**
     * Logic to move an leaf node to a new container node.
     *
     * This is used in the Drag & Drop demonstration code to move a dragged item.
     *
     * @param nodeIdToReparent the node ID of the leaf node to move
     * @param targetNode the new parent of the leaf node
     */
    reparent(nodeIdToReparent: string, targetNode: ExampleTreeNode): void;
}
//# sourceMappingURL=treeview-example-model.d.ts.map