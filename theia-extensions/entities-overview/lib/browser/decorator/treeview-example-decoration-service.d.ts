import { ContributionProvider } from '@theia/core';
import { AbstractTreeDecoratorService, TreeDecorator } from '@theia/core/lib/browser';
export declare const TreeviewExampleDecorator: unique symbol;
/**
 * The TreeDecoratorService which manages the TreeDecorator contributions for our tree widget implementation.
 * (Every tree widget has its own TreeDecoratorService instance to manage decorations specifically for that widget.)
 */
export declare class TreeviewExampleDecorationService extends AbstractTreeDecoratorService {
    protected readonly contributions: ContributionProvider<TreeDecorator>;
    constructor(contributions: ContributionProvider<TreeDecorator>);
}
//# sourceMappingURL=treeview-example-decoration-service.d.ts.map