import { Emitter, Event } from '@theia/core';
import { DidChangeLabelEvent, LabelProviderContribution, TreeNode } from '@theia/core/lib/browser';
/**
 * Provider for labels and icons for the `TreeViewExampleWidget`
 */
export declare class TreeViewExampleLabelProvider implements LabelProviderContribution {
    /**
     * Emitter for the event that is emitted when the label of a tree item changes.
     */
    protected readonly onDidChangeEmitter: Emitter<DidChangeLabelEvent>;
    /**
     * Decides whether this label provider can provide labels for the given object (in this case only
     * nodes in the TreeViewExampleWidget tree).
     *
     * @param element the element to consider
     * @returns 0 if this label provider cannot handle the element, otherwise a positive integer indicating a
     *   priority. The framework chooses the provider with the highest priority for the given element.
     */
    canHandle(element: object): number;
    /**
     * Provides the name for the given tree node.
     *
     * This example demonstrates a name that is partially resolved asynchronously.
     * Whenever a name is requested for an `ExampleTreeLeaf` for the first time, a timer
     * is scheduled. After the timer resolves, the quantity from the model is reported.
     * In the meantime, a "calculating..." label is shown.
     *
     * This works by emitting a label change event when the Promise is resolved.
     *
     * @param element the element for which the name shall be retrieved
     * @returns the name of this element
     */
    getName(element: object): string | undefined;
    /**
     * Provides an icon (in this case, a fontawesome icon name without the fa- prefix, as the TreeWidget provides built-in support
     * for fontawesome icons).
     *
     * @param element the element for which to provide the icon
     * @returns the icon
     */
    getIcon(element: object): string | undefined;
    /**
     * Fire the node change event.
     *
     * @param node the node that has been changed
     */
    fireNodeChange(node: TreeNode): void;
    /**
     * Accessor for the emitter (defined by the LabelProviderContribution interface)
     */
    get onDidChange(): Event<DidChangeLabelEvent>;
}
//# sourceMappingURL=treeview-example-label-provider.d.ts.map