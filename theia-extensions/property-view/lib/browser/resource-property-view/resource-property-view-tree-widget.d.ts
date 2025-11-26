/// <reference types="react" />
import { ContextMenuRenderer, NodeProps, TreeModel, TreeNode, TreeProps, TreeWidget } from '@theia/core/lib/browser';
import { FileStat } from '@theia/filesystem/lib/common/files';
import * as React from '@theia/core/shared/react';
import { PropertyDataService } from '../property-data-service';
import { PropertyViewContentWidget } from '../property-view-content-widget';
import { ResourcePropertiesCategoryNode, ResourcePropertiesItemNode } from './resource-property-view-tree-items';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
/**
 * This widget fetches the property data for {@link FileSelection}s and selections of {@link Navigatable}s
 * and renders that property data as a {@link TreeWidget}.
 * This widget is provided by the registered `ResourcePropertyViewWidgetProvider`.
 */
export declare class ResourcePropertyViewTreeWidget extends TreeWidget implements PropertyViewContentWidget {
    static readonly ID = "resource-properties-tree-widget";
    static readonly LABEL = "Resource Properties Tree";
    protected propertiesTree: Map<string, ResourcePropertiesCategoryNode>;
    protected currentSelection: Object | undefined;
    protected fileService: FileService;
    constructor(props: TreeProps, model: TreeModel, contextMenuRenderer: ContextMenuRenderer, fileService: FileService);
    protected init(): void;
    protected updateNeeded(selection: Object | undefined): boolean;
    updatePropertyViewContent(propertyDataService?: PropertyDataService, selection?: Object | undefined): void;
    protected fillPropertiesTree(fileStatObject?: FileStat): Promise<void>;
    protected createContentNode(fileStat: FileStat): Promise<ResourcePropertiesCategoryNode | null>;
    protected guessLanguage(fileExtension: string): string;
    protected getLocationString(fileStat: FileStat): string;
    protected getFileName(fileStat: FileStat): string;
    protected getFilePath(fileStat: FileStat): string;
    protected getLastModificationString(fileStat: FileStat): string;
    protected getCreationTimeString(fileStat: FileStat): string;
    protected getSizeString(fileStat: FileStat): string;
    protected createCategoryNode(categoryId: string, name: string): ResourcePropertiesCategoryNode;
    protected createResultLineNode(id: string, name: string, property: boolean | string | undefined, parent: ResourcePropertiesCategoryNode): ResourcePropertiesItemNode;
    /**
     * Rendering
     */
    protected refreshModelChildren(): Promise<void>;
    protected renderCaption(node: TreeNode, props: NodeProps): React.ReactNode;
    protected renderContentNode(node: ResourcePropertiesItemNode): React.ReactNode;
    protected createNodeAttributes(node: TreeNode, props: NodeProps): React.Attributes & React.HTMLAttributes<HTMLElement>;
    protected getNodeTooltip(node: TreeNode): string | undefined;
}
//# sourceMappingURL=resource-property-view-tree-widget.d.ts.map