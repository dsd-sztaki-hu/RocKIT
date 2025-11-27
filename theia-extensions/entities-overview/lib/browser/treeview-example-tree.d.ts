import { CompositeTreeNode, TreeImpl, TreeNode } from '@theia/core/lib/browser';
/**
 * Tree implementation.
 *
 * We override this to enable lazy child node resolution on node expansion.
 */
export declare class TreeviewExampleTree extends TreeImpl {
    private readonly itemFactory;
    /**
     * Resolves children of the given parent node.
     *
     * @param parent the node for which to provide the children
     * @returns a new array of child tree nodes for the given parent node.
     */
    resolveChildren(parent: CompositeTreeNode): Promise<TreeNode[]>;
}
//# sourceMappingURL=treeview-example-tree.d.ts.map