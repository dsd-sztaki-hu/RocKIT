"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TreeviewExampleDemoDecorator = void 0;
const core_1 = require("@theia/core");
const browser_1 = require("@theia/core/lib/browser");
const widget_decoration_1 = require("@theia/core/lib/browser/widget-decoration");
const inversify_1 = require("@theia/core/shared/inversify");
const treeview_example_model_1 = require("../treeview-example-model");
/**
 * Example TreeDecorator implementation for our tree widget.
 */
let TreeviewExampleDemoDecorator = class TreeviewExampleDemoDecorator {
    constructor() {
        /** Decorator id - required by the TreeDecorator interface */
        this.id = 'TreeviewExampleDecorator';
        /** Event Emitter for when the decorations change - required by the TreeDecorator interface */
        this.emitter = new core_1.Emitter();
    }
    get onDidChangeDecorations() {
        return this.emitter.event;
    }
    /**
     * The actual decoration calculation.
     *
     * In contrast to label providers, decorators provide decorations for the complete tree at once.
     *
     * @param tree the tree to decorate.
     * @returns a Map of node IDs mapped to decorations.
     */
    decorations(tree) {
        const result = new Map();
        if (tree.root === undefined) {
            return result;
        }
        // iterate the tree
        for (const treeNode of new browser_1.DepthFirstTreeIterator(tree.root)) {
            // in our case, we only decorate leaf nodes
            if (treeview_example_model_1.ExampleTreeLeaf.is(treeNode)) {
                // we distinguish between high and low stock levels based on the quantity
                const amount = treeNode.data.quantity || 0;
                if (amount > 4) {
                    // we use a green checkmark icon decoration for high stock levels
                    result.set(treeNode.id, {
                        iconOverlay: {
                            position: widget_decoration_1.WidgetDecoration.IconOverlayPosition.BOTTOM_RIGHT,
                            iconClass: ['fa', 'fa-check-circle'],
                            color: 'green'
                        }
                    });
                }
                else {
                    // for low stock levels, we use a red background color and a warning text suffix
                    result.set(treeNode.id, {
                        backgroundColor: 'red',
                        captionSuffixes: [{ data: 'Warning: low stock', fontData: { style: 'italic' } }]
                    });
                }
            }
        }
        return result;
    }
};
exports.TreeviewExampleDemoDecorator = TreeviewExampleDemoDecorator;
exports.TreeviewExampleDemoDecorator = TreeviewExampleDemoDecorator = __decorate([
    (0, inversify_1.injectable)()
], TreeviewExampleDemoDecorator);
//# sourceMappingURL=treeview-example-demo-decorator.js.map