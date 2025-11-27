/// <reference types="react" />
import { DisposableCollection, MenuPath } from '@theia/core';
import { ContextMenuRenderer, NodeProps, TreeNode, TreeProps, TreeWidget } from '@theia/core/lib/browser';
import * as React from '@theia/core/shared/react';
import '../../src/browser/styles/treeview-example-widget.css';
import { TreeViewExampleModel } from './treeview-example-model';
/** Well-known constant for the context menu path */
export declare const TREEVIEW_EXAMPLE_CONTEXT_MENU: MenuPath;
/** Implementation of the Tree Widget */
export declare class TreeViewExampleWidget extends TreeWidget {
    readonly props: TreeProps;
    readonly model: TreeViewExampleModel;
    /** The ID of the view */
    static readonly ID = "theia-examples:treeview-example-view";
    /** The label of the view */
    static readonly LABEL = "Example Tree View";
    /** Used in Drag & Drop code to remember and cancel deferred expansion of hovered nodes */
    protected readonly toCancelNodeExpansion: DisposableCollection;
    /** The MessageService to demonstrate the action when a user opens (double-clicks) a node */
    private readonly messageService;
    constructor(props: TreeProps, model: TreeViewExampleModel, contextMenuRenderer: ContextMenuRenderer);
    /**
     * Enable icon rendering.
     *
     * The super implementation is currently empty.
     * This implementation is taken from `file-tree-widget.tsx`.
     *
     * @param node the node to render
     * @param props the node props (currently transporting the depth of the item in the tree)
     * @returns
     */
    protected renderIcon(node: TreeNode, props: NodeProps): React.ReactNode;
    /**
     * Provide CSS class names for a given tree node.
     *
     * In our example, we append our own CSS class to all nodes. See/modify the included CSS file for the corresponding style.
     *
     * @param node the node to render
     * @param props the node props (currently transporting the depth of the item in the tree)
     * @returns the node's CSS classes
     */
    protected createNodeClassNames(node: TreeNode, props: NodeProps): string[];
    /**
     * Provide node element attributes for a given tree node.
     *
     * In our example, we use this to add Drag & Drop event handlers to the tree nodes.
     *
     * Note: the Drag & Drop code has been taken and adapted from `file-tree-widget.tsx`
     *
     * @param node the node to render
     * @param props the node props (currently transporting the depth of the item in the tree)
     * @returns the HTML element attributes.
     */
    protected createNodeAttributes(node: TreeNode, props: NodeProps): React.Attributes & React.HTMLAttributes<HTMLElement>;
    /**
     * Returns HTML attributes to install Drag & Drop event handlers for the given tree node.
     *
     * Note: the Drag & Drop code has been taken and adapted from `file-tree-widget.tsx`
     *
     * @param node the tree node
     * @returns the drag event handlers to be used as additional HTML element attributes
     */
    protected getNodeDragHandlers(node: TreeNode): React.Attributes & React.HtmlHTMLAttributes<HTMLElement>;
    /**
     * Handler for the _dragStart_ event.
     *
     * Stores the ID of the dragged tree node in the Drag & Drop data.
     *
     * @param node the tree node
     * @param event the event
     */
    protected handleDragStartEvent(node: TreeNode, event: React.DragEvent): void;
    /**
     * Handler for the _dragOver_ event.
     *
     * Registers deferred tree expansion that shall be triggered if the user hovers over an expandable tree item for
     * some time.
     *
     * @param node the tree node
     * @param event the event
     */
    protected handleDragOverEvent(node: TreeNode | undefined, event: React.DragEvent): void;
    /**
     * Handler for the _dragEnter_ event.
     *
     * Cancels any pending deferred tree extension, selects the current target node to highlight it in the UI, and
     * sets the Drag & Drop indicator to "move".
     *
     * @param node the tree node
     * @param event the event
     */
    protected handleDragEnterEvent(node: TreeNode | undefined, event: React.DragEvent): void;
    /**
     * Handler for the _dragLeave_ event.
     *
     * Cancels any pending deferred tree extension.
     *
     * @param node the tree node
     * @param event the event
     */
    protected handleDragLeaveEvent(node: TreeNode | undefined, event: React.DragEvent): void;
    /**
     * Handler for the _drop_ event.
     *
     * Calls the code to move the dragged node to the new parent.
     *
     * @param node the tree node
     * @param event the event
     */
    protected handleDropEvent(node: TreeNode | undefined, event: React.DragEvent): Promise<void>;
}
//# sourceMappingURL=treeview-example-widget.d.ts.map