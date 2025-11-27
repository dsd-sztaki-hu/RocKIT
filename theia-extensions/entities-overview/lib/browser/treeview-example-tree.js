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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TreeviewExampleTree = void 0;
const browser_1 = require("@theia/core/lib/browser");
const promise_util_1 = require("@theia/core/lib/common/promise-util");
const inversify_1 = require("@theia/core/shared/inversify");
const treeview_example_model_1 = require("./treeview-example-model");
const treeview_example_tree_item_factory_1 = require("./treeview-example-tree-item-factory");
/**
 * Tree implementation.
 *
 * We override this to enable lazy child node resolution on node expansion.
 */
class TreeviewExampleTree extends browser_1.TreeImpl {
    /**
     * Resolves children of the given parent node.
     *
     * @param parent the node for which to provide the children
     * @returns a new array of child tree nodes for the given parent node.
     */
    async resolveChildren(parent) {
        var _a, _b;
        // root children are initialized once and never change, so we just return a copy of the original children
        if (parent.id === treeview_example_model_1.ROOT_NODE_ID) {
            return [...parent.children];
        }
        // non-container nodes do not have children, so we return an empty array
        if (!treeview_example_model_1.ExampleTreeNode.is(parent)) {
            return [];
        }
        // performance optimization - if the children are resolved already and the number of children is still correct
        // we reuse the already resolved items.
        // Note: In a real application this comparison might require more logic, because if a child is replaced by a
        // different one or if children are reordered, this code would not work...
        if (parent.children.length === ((_a = parent.data.children) === null || _a === void 0 ? void 0 : _a.length)) {
            return [...parent.children];
        }
        // simulate asynchronous loading of children. In the UI we can see a busy marker when we expand a node because of this.
        // (in practice, we would call an expensive function to fetch the children and return the corresponding promise)
        await (0, promise_util_1.wait)(2000);
        return ((_b = parent.data.children) !== null && _b !== void 0 ? _b : []).map(i => this.itemFactory.toTreeNode(i));
    }
}
exports.TreeviewExampleTree = TreeviewExampleTree;
__decorate([
    (0, inversify_1.inject)(treeview_example_tree_item_factory_1.TreeViewExampleTreeItemFactory),
    __metadata("design:type", treeview_example_tree_item_factory_1.TreeViewExampleTreeItemFactory)
], TreeviewExampleTree.prototype, "itemFactory", void 0);
//# sourceMappingURL=treeview-example-tree.js.map