import { ExampleTreeLeaf, ExampleTreeNode } from './treeview-example-model';
/**
 * Interface for the "business model".
 *
 * (Note: this could be more elaborated, using different interfaces for containers and concrete items, but for this demonstration,
 * we keep the model like this...)
 */
export interface Item {
    name: string;
    children?: Item[];
    quantity?: number;
    backOrdered?: boolean;
}
/**
 * This class encapsulates the logic for mapping business model items to tree nodes.
 */
export declare class TreeViewExampleTreeItemFactory {
    /**
     * Counter that for each item name stores the next id number to assign for that name,
     * so that all tree items get a unique id
     */
    private readonly idCounter;
    /**
     * Create a new tree node for the tree model from the given item.
     *
     * @param item the item to map to a tree node
     * @returns the tree node representing the given item
     */
    toTreeNode(item: Item): ExampleTreeNode | ExampleTreeLeaf;
    /**
     * Calculate a unique id for a given tree item by using the item's name and appending a unique counter.
     *
     * @param item the item to calculate the id for
     * @returns the unique id for the given item in the form "{name}-{counter}"
     */
    private toTreeNodeId;
}
//# sourceMappingURL=treeview-example-tree-item-factory.d.ts.map