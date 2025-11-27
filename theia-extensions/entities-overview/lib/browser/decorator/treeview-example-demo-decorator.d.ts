import { Emitter, MaybePromise } from '@theia/core';
import { Tree, TreeDecorator } from '@theia/core/lib/browser';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { Event } from '@theia/core/lib/common';
/**
 * Example TreeDecorator implementation for our tree widget.
 */
export declare class TreeviewExampleDemoDecorator implements TreeDecorator {
    /** Decorator id - required by the TreeDecorator interface */
    id: string;
    /** Event Emitter for when the decorations change - required by the TreeDecorator interface */
    protected readonly emitter: Emitter<(tree: Tree) => Map<string, WidgetDecoration.Data>>;
    get onDidChangeDecorations(): Event<(tree: Tree) => Map<string, WidgetDecoration.Data>>;
    /**
     * The actual decoration calculation.
     *
     * In contrast to label providers, decorators provide decorations for the complete tree at once.
     *
     * @param tree the tree to decorate.
     * @returns a Map of node IDs mapped to decorations.
     */
    decorations(tree: Tree): MaybePromise<Map<string, WidgetDecoration.Data>>;
}
//# sourceMappingURL=treeview-example-demo-decorator.d.ts.map