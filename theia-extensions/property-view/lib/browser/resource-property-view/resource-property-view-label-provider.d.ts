import { LabelProvider, LabelProviderContribution, TreeNode } from '@theia/core/lib/browser';
import { ResourcePropertiesCategoryNode, ResourcePropertiesItemNode } from './resource-property-view-tree-items';
export declare const DEFAULT_INFO_ICON: string;
export declare class ResourcePropertiesLabelProvider implements LabelProviderContribution {
    protected readonly labelProvider: LabelProvider;
    canHandle(element: TreeNode): number;
    getIcon(node: ResourcePropertiesCategoryNode | ResourcePropertiesItemNode): string;
    getName(node: ResourcePropertiesCategoryNode | ResourcePropertiesItemNode): string;
    getLongName(node: ResourcePropertiesCategoryNode | ResourcePropertiesItemNode): string;
}
//# sourceMappingURL=resource-property-view-label-provider.d.ts.map