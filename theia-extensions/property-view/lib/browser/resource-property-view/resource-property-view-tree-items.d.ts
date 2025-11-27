import { CompositeTreeNode, ExpandableTreeNode, SelectableTreeNode, TreeNode } from '@theia/core/lib/browser';
export declare const ROOT_ID = "ResourcePropertiesTree";
export interface ResourcePropertiesRoot extends CompositeTreeNode {
    children: ResourcePropertiesCategoryNode[];
}
export declare namespace ResourcePropertiesRoot {
    function is(node: unknown): node is ResourcePropertiesRoot;
}
export interface ResourcePropertiesCategoryNode extends ExpandableTreeNode, SelectableTreeNode {
    name: string;
    icon?: string;
    children: ResourcePropertiesItemNode[];
    parent: ResourcePropertiesRoot;
    categoryId: string;
}
export declare namespace ResourcePropertiesCategoryNode {
    function is(node: TreeNode | undefined): node is ResourcePropertiesCategoryNode;
}
export interface ResourcePropertiesItemNode extends SelectableTreeNode {
    name: string;
    icon?: string;
    parent: ResourcePropertiesCategoryNode;
    property: string;
}
export declare namespace ResourcePropertiesItemNode {
    function is(node: TreeNode | undefined): node is ResourcePropertiesItemNode;
}
//# sourceMappingURL=resource-property-view-tree-items.d.ts.map