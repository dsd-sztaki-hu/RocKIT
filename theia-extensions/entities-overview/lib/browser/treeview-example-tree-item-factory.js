"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TreeViewExampleTreeItemFactory = void 0;
const inversify_1 = require("@theia/core/shared/inversify");
/**
 * This class encapsulates the logic for mapping business model items to tree nodes.
 */
let TreeViewExampleTreeItemFactory = class TreeViewExampleTreeItemFactory {
    constructor() {
        /**
         * Counter that for each item name stores the next id number to assign for that name,
         * so that all tree items get a unique id
         */
        this.idCounter = new Map();
    }
    /**
     * Create a new tree node for the tree model from the given item.
     *
     * @param item the item to map to a tree node
     * @returns the tree node representing the given item
     */
    toTreeNode(item) {
        if (item.children) {
            return {
                id: this.toTreeNodeId(item),
                data: item,
                expanded: false,
                children: [],
                parent: undefined,
                type: 'node',
                selected: false
            };
        }
        else {
            return {
                id: this.toTreeNodeId(item),
                data: item,
                parent: undefined,
                type: 'leaf',
                /* NOTE!
                 * The checkboxInfo property can be used to add a checkbox to the tree node.
                 * But at the moment (Theia 1.60.x), there is an issue with the UI in which the
                 * checkbox state is not properly reflected after the user clicks it.
                 * See https://github.com/eclipse-theia/theia/issues/15521 for details.
                 */
                /*checkboxInfo: {
                    checked: item.backOrdered,
                }*/
            };
        }
    }
    /**
     * Calculate a unique id for a given tree item by using the item's name and appending a unique counter.
     *
     * @param item the item to calculate the id for
     * @returns the unique id for the given item in the form "{name}-{counter}"
     */
    toTreeNodeId(item) {
        const key = item.name;
        // get the next counter for this item's name (or use 0 if this is the first occurrence)
        let count;
        if (this.idCounter.has(key)) {
            count = this.idCounter.get(key);
        }
        else {
            count = 0;
        }
        // store the new counter for this item's name
        this.idCounter.set(key, count + 1);
        // return the unique id in the form "{name}-{counter}"
        return `${key}-${count}`;
    }
};
exports.TreeViewExampleTreeItemFactory = TreeViewExampleTreeItemFactory;
exports.TreeViewExampleTreeItemFactory = TreeViewExampleTreeItemFactory = __decorate([
    (0, inversify_1.injectable)()
], TreeViewExampleTreeItemFactory);
//# sourceMappingURL=treeview-example-tree-item-factory.js.map