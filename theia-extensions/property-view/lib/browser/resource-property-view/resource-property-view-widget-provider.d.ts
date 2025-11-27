import { DefaultPropertyViewWidgetProvider } from '../property-view-widget-provider';
import { ResourcePropertyViewTreeWidget } from './resource-property-view-tree-widget';
/**
 * Provides the {@link ResourcePropertyViewTreeWidget} for
 * {@link FileSelection}s and selections of {@link Navigatable}s.
 */
export declare class ResourcePropertyViewWidgetProvider extends DefaultPropertyViewWidgetProvider {
    protected treeWidget: ResourcePropertyViewTreeWidget;
    readonly id = "resources";
    readonly label = "ResourcePropertyViewWidgetProvider";
    canHandle(selection: Object | undefined): number;
    protected isFileSelection(selection: Object | undefined): boolean;
    protected isNavigatableSelection(selection: Object | undefined): boolean;
    provideWidget(selection: Object | undefined): Promise<ResourcePropertyViewTreeWidget>;
    updateContentWidget(selection: Object | undefined): void;
}
//# sourceMappingURL=resource-property-view-widget-provider.d.ts.map