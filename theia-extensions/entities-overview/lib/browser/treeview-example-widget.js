"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var TreeViewExampleWidget_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TreeViewExampleWidget = exports.TREEVIEW_EXAMPLE_CONTEXT_MENU = void 0;
const core_1 = require("@theia/core");
const browser_1 = require("@theia/core/lib/browser");
const inversify_1 = require("@theia/core/shared/inversify");
const React = require("@theia/core/shared/react");
require("../../src/browser/styles/treeview-example-widget.css");
const treeview_example_model_1 = require("./treeview-example-model");
/** Well-known constant for the context menu path */
exports.TREEVIEW_EXAMPLE_CONTEXT_MENU = ['theia-examples:treeview-example-context-menu'];
/** Implementation of the Tree Widget */
let TreeViewExampleWidget = TreeViewExampleWidget_1 = class TreeViewExampleWidget extends browser_1.TreeWidget {
    constructor(props, model, contextMenuRenderer) {
        super(props, model, contextMenuRenderer);
        this.props = props;
        this.model = model;
        /** Used in Drag & Drop code to remember and cancel deferred expansion of hovered nodes */
        this.toCancelNodeExpansion = new core_1.DisposableCollection();
        // set the general properties for the view
        this.id = TreeViewExampleWidget_1.ID;
        this.title.label = TreeViewExampleWidget_1.LABEL;
        this.title.caption = TreeViewExampleWidget_1.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-list-ul';
        // register action on double-click / ENTER key
        this.toDispose.push(this.model.onOpenNode((node) => {
            if (treeview_example_model_1.ExampleTreeLeaf.is(node) || treeview_example_model_1.ExampleTreeNode.is(node)) {
                this.messageService.info(`Example node ${node.data.name} was opened.`);
            }
        }));
        this.toDispose.push(this.toCancelNodeExpansion);
    }
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
    renderIcon(node, props) {
        const icon = this.getIconClass(this.toNodeIcon(node));
        if (icon) {
            return React.createElement("div", { className: `${icon}` });
        }
        return super.renderIcon(node, props);
    }
    /**
     * Provide CSS class names for a given tree node.
     *
     * In our example, we append our own CSS class to all nodes. See/modify the included CSS file for the corresponding style.
     *
     * @param node the node to render
     * @param props the node props (currently transporting the depth of the item in the tree)
     * @returns the node's CSS classes
     */
    createNodeClassNames(node, props) {
        return super.createNodeClassNames(node, props).concat('theia-example-tree-node');
    }
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
    createNodeAttributes(node, props) {
        return Object.assign(Object.assign({}, super.createNodeAttributes(node, props)), this.getNodeDragHandlers(node));
    }
    /**
     * Returns HTML attributes to install Drag & Drop event handlers for the given tree node.
     *
     * Note: the Drag & Drop code has been taken and adapted from `file-tree-widget.tsx`
     *
     * @param node the tree node
     * @returns the drag event handlers to be used as additional HTML element attributes
     */
    getNodeDragHandlers(node) {
        return {
            onDragStart: event => this.handleDragStartEvent(node, event),
            onDragEnter: event => this.handleDragEnterEvent(node, event),
            onDragOver: event => this.handleDragOverEvent(node, event),
            onDragLeave: event => this.handleDragLeaveEvent(node, event),
            onDrop: event => this.handleDropEvent(node, event),
            draggable: treeview_example_model_1.ExampleTreeLeaf.is(node),
        };
    }
    /**
     * Handler for the _dragStart_ event.
     *
     * Stores the ID of the dragged tree node in the Drag & Drop data.
     *
     * @param node the tree node
     * @param event the event
     */
    handleDragStartEvent(node, event) {
        event.stopPropagation();
        if (event.dataTransfer) {
            event.dataTransfer.setData('tree-node', node.id);
        }
    }
    /**
     * Handler for the _dragOver_ event.
     *
     * Registers deferred tree expansion that shall be triggered if the user hovers over an expandable tree item for
     * some time.
     *
     * @param node the tree node
     * @param event the event
     */
    handleDragOverEvent(node, event) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        if (!this.toCancelNodeExpansion.disposed) {
            return;
        }
        const timer = setTimeout(() => {
            if (!!node && treeview_example_model_1.ExampleTreeNode.is(node) && !node.expanded) {
                this.model.expandNode(node);
            }
        }, 500);
        this.toCancelNodeExpansion.push(core_1.Disposable.create(() => clearTimeout(timer)));
    }
    /**
     * Handler for the _dragEnter_ event.
     *
     * Cancels any pending deferred tree extension, selects the current target node to highlight it in the UI, and
     * sets the Drag & Drop indicator to "move".
     *
     * @param node the tree node
     * @param event the event
     */
    handleDragEnterEvent(node, event) {
        event.preventDefault();
        event.stopPropagation();
        this.toCancelNodeExpansion.dispose();
        let target = node;
        if (target && treeview_example_model_1.ExampleTreeLeaf.is(target)) {
            target = target.parent;
        }
        if (!!target && treeview_example_model_1.ExampleTreeNode.is(target) && !target.selected) {
            this.model.selectNode(target);
        }
    }
    /**
     * Handler for the _dragLeave_ event.
     *
     * Cancels any pending deferred tree extension.
     *
     * @param node the tree node
     * @param event the event
     */
    handleDragLeaveEvent(node, event) {
        event.preventDefault();
        event.stopPropagation();
        this.toCancelNodeExpansion.dispose();
    }
    /**
     * Handler for the _drop_ event.
     *
     * Calls the code to move the dragged node to the new parent.
     *
     * @param node the tree node
     * @param event the event
     */
    async handleDropEvent(node, event) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        let target = node;
        if (target && treeview_example_model_1.ExampleTreeLeaf.is(target)) {
            target = target.parent;
        }
        if (!!target && treeview_example_model_1.ExampleTreeNode.is(target)) {
            const draggedNodeId = event.dataTransfer.getData('tree-node');
            this.model.reparent(draggedNodeId, target);
        }
    }
};
exports.TreeViewExampleWidget = TreeViewExampleWidget;
/** The ID of the view */
TreeViewExampleWidget.ID = 'theia-examples:treeview-example-view';
/** The label of the view */
TreeViewExampleWidget.LABEL = 'Example Tree View';
__decorate([
    (0, inversify_1.inject)(core_1.MessageService),
    __metadata("design:type", core_1.MessageService)
], TreeViewExampleWidget.prototype, "messageService", void 0);
exports.TreeViewExampleWidget = TreeViewExampleWidget = TreeViewExampleWidget_1 = __decorate([
    (0, inversify_1.injectable)(),
    __param(0, (0, inversify_1.inject)(browser_1.TreeProps)),
    __param(1, (0, inversify_1.inject)(browser_1.TreeModel)),
    __param(2, (0, inversify_1.inject)(browser_1.ContextMenuRenderer)),
    __metadata("design:paramtypes", [Object, treeview_example_model_1.TreeViewExampleModel,
        browser_1.ContextMenuRenderer])
], TreeViewExampleWidget);
//# sourceMappingURL=treeview-example-widget.js.map