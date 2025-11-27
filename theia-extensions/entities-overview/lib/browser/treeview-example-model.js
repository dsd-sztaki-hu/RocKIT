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
exports.TreeViewExampleModel = exports.ExampleTreeLeaf = exports.ExampleTreeNode = exports.ROOT_NODE_ID = exports.MOCKED_ENTITIES = void 0;
const browser_1 = require("@theia/core/lib/browser");
const inversify_1 = require("@theia/core/shared/inversify");
const treeview_example_tree_item_factory_1 = require("./treeview-example-tree-item-factory");
// Mocked entities with type property
exports.MOCKED_ENTITIES = [
    // --- Authors ---
    {
        id: 'auth-1',
        technicalName: 'Tóth, Zoltán',
        description: 'Author - (SZTAKI staff)',
        type: 'author'
    },
    {
        id: 'auth-2',
        technicalName: 'Nagy, Eszter',
        description: 'Author - (External Contributor)',
        type: 'author'
    },
    // --- Files (From your image) ---
    {
        id: 'file-1',
        technicalName: 'jargon.html',
        description: 'File - Documentation Glossary',
        type: 'file'
    },
    {
        id: 'file-2',
        technicalName: 'keyboard-interface.html',
        description: 'File - Accessibility Settings',
        type: 'file'
    },
    {
        id: 'file-3',
        technicalName: 'label.html',
        description: 'File - UI Label definitions',
        type: 'file'
    },
    {
        id: 'file-4',
        technicalName: 'large-scale.html',
        description: 'File - Scalability Tests',
        type: 'file'
    },
    // --- Datasets (Implicit from image) ---
    {
        id: 'data-1',
        technicalName: 'SZTAKI_Dataset_V1',
        description: 'Dataset - Raw sensor logs',
        type: 'dataset'
    },
    {
        id: 'data-2',
        technicalName: 'Export_2023_Q4',
        description: 'Dataset - Quarterly archive',
        type: 'dataset'
    },
    // --- Point of Contact (Implicit from image) ---
    {
        id: 'poc-1',
        technicalName: 'sysadmin@sztaki.hu',
        description: 'Point of Contact - System Administrator',
        type: 'pointOfContact'
    }
];
// Group entities by type
const ENTITIES_DATA = [
    {
        name: 'Authors',
        children: exports.MOCKED_ENTITIES.filter(e => e.type === 'author').map(entity => ({
            name: entity.technicalName,
            id: entity.id,
            description: entity.description
        }))
    },
    {
        name: 'Files',
        children: exports.MOCKED_ENTITIES.filter(e => e.type === 'file').map(entity => ({
            name: entity.technicalName,
            id: entity.id,
            description: entity.description
        }))
    },
    {
        name: 'Datasets',
        children: exports.MOCKED_ENTITIES.filter(e => e.type === 'dataset').map(entity => ({
            name: entity.technicalName,
            id: entity.id,
            description: entity.description
        }))
    },
    {
        name: 'Points of Contact',
        children: exports.MOCKED_ENTITIES.filter(e => e.type === 'pointOfContact').map(entity => ({
            name: entity.technicalName,
            id: entity.id,
            description: entity.description
        }))
    }
];
/** well-known ID for the root node in our tree */
exports.ROOT_NODE_ID = 'entities-overview-root';
var ExampleTreeNode;
(function (ExampleTreeNode) {
    function is(candidate) {
        return browser_1.ExpandableTreeNode.is(candidate) && 'type' in candidate && candidate.type === 'node';
    }
    ExampleTreeNode.is = is;
})(ExampleTreeNode || (exports.ExampleTreeNode = ExampleTreeNode = {}));
var ExampleTreeLeaf;
(function (ExampleTreeLeaf) {
    function is(candidate) {
        return browser_1.TreeNode.is(candidate) && 'type' in candidate && candidate.type === 'leaf';
    }
    ExampleTreeLeaf.is = is;
})(ExampleTreeLeaf || (exports.ExampleTreeLeaf = ExampleTreeLeaf = {}));
/**
 * The Tree Model for the entities overview.
 *
 * This class contains the bridge between business model and tree model and realizes operations on the data.
 */
let TreeViewExampleModel = class TreeViewExampleModel extends browser_1.TreeModelImpl {
    /**
     * Initialize the tree model from the business model
     */
    init() {
        super.init();
        // create the root node
        const root = {
            id: exports.ROOT_NODE_ID,
            parent: undefined,
            children: [],
            visible: false // do not show the root node in the UI
        };
        // populate the direct children
        ENTITIES_DATA.map(item => this.itemFactory.toTreeNode(item))
            .forEach(node => browser_1.CompositeTreeNode.addChild(root, node));
        // set the root node as root of the tree
        // This will also initialize the ID-node-map in the tree, so this should be called
        // after populating the children.
        this.tree.root = root;
    }
    /**
     * This is executed when a tree item's checkbox is checked/unchecked.
     *
     * For this example, the check state is applied to the business model (backOrdered property).
     *
     * @param node the affected node
     * @param checked the new state of the checkbox
     */
    markAsChecked(node, checked) {
        if (ExampleTreeLeaf.is(node)) {
            node.data.backOrdered = checked;
        }
        super.markAsChecked(node, checked);
    }
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
    addItem(parent) {
        var _a;
        if (ExampleTreeNode.is(parent)) {
            const newItem = { name: 'New Entity' };
            (_a = parent.data.children) === null || _a === void 0 ? void 0 : _a.push(newItem);
            // since we have modified the tree structure, we need to refresh the parent node
            this.tree.refresh(parent);
        }
    }
    /**
     * Logic to move an leaf node to a new container node.
     *
     * This is used in the Drag & Drop demonstration code to move a dragged item.
     *
     * @param nodeIdToReparent the node ID of the leaf node to move
     * @param targetNode the new parent of the leaf node
     */
    reparent(nodeIdToReparent, targetNode) {
        var _a, _b;
        // resolve the ID to the actual node (using the ID-to-node map of the tree)
        const nodeToReparent = this.tree.getNode(nodeIdToReparent);
        // get the original parent
        const sourceParent = nodeToReparent === null || nodeToReparent === void 0 ? void 0 : nodeToReparent.parent;
        if (nodeToReparent && ExampleTreeLeaf.is(nodeToReparent)
            && sourceParent && ExampleTreeNode.is(sourceParent)) {
            // find the nodeToReparent in the sourceParent's children
            const indexInCurrentParent = sourceParent.data.children.indexOf(nodeToReparent.data);
            if (indexInCurrentParent !== -1) {
                // remove the node from its old location (in the business model)
                (_a = sourceParent.data.children) === null || _a === void 0 ? void 0 : _a.splice(indexInCurrentParent, 1);
                // add the node to its new location (in the business model)
                (_b = targetNode.data.children) === null || _b === void 0 ? void 0 : _b.push(nodeToReparent.data);
                // trigger refreshes so that the tree is updated according to the structural changes made
                this.tree.refresh(sourceParent);
                this.tree.refresh(targetNode);
            }
        }
    }
};
exports.TreeViewExampleModel = TreeViewExampleModel;
__decorate([
    (0, inversify_1.inject)(treeview_example_tree_item_factory_1.TreeViewExampleTreeItemFactory),
    __metadata("design:type", treeview_example_tree_item_factory_1.TreeViewExampleTreeItemFactory)
], TreeViewExampleModel.prototype, "itemFactory", void 0);
__decorate([
    (0, inversify_1.postConstruct)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TreeViewExampleModel.prototype, "init", null);
exports.TreeViewExampleModel = TreeViewExampleModel = __decorate([
    (0, inversify_1.injectable)()
], TreeViewExampleModel);
//# sourceMappingURL=treeview-example-model.js.map