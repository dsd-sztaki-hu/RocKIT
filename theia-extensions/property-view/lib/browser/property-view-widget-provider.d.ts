import { ContributionProvider, MaybePromise } from '@theia/core';
import { PropertyDataService } from './property-data-service';
import { PropertyViewContentWidget } from './property-view-content-widget';
export declare const PropertyViewWidgetProvider: unique symbol;
/**
 * The `PropertyViewWidgetProvider` should be implemented to provide a property view content widget for the given selection..
 */
export interface PropertyViewWidgetProvider {
    /**
     * A unique id for this provider.
     */
    id: string;
    /**
     * A human-readable name for this provider.
     */
    label?: string;
    /**
     * Test whether this provider can provide a widget for the given selection.
     * A returned value indicating a priority of this provider.
     *
     * @param selection the global selection object
     * @returns a nonzero number if this provider can provide; otherwise it cannot; never reject
     */
    canHandle(selection: Object | undefined): MaybePromise<number>;
    /**
     * Provide a widget for the given selection.
     * Never reject if `canHandle` return a positive number; otherwise should reject.
     *
     * @param selection the global selection object
     * @returns a resolved property view content widget.
     */
    provideWidget(selection: Object | undefined): Promise<PropertyViewContentWidget>;
    /**
     * Update the widget with the given selection.
     * Never reject if `canHandle` return a positive number; otherwise should reject.
     *
     * @param selection the global selection object
     * @returns a resolved property view content widget.
     */
    updateContentWidget(selection: Object | undefined): void;
}
/**
 * The `DefaultPropertyViewWidgetProvider` is the default abstract implementation of the {@link PropertyViewWidgetProvider}
 * and should be extended to provide a property view content widget for the given selection.
 */
export declare abstract class DefaultPropertyViewWidgetProvider implements PropertyViewWidgetProvider {
    protected readonly contributions: ContributionProvider<PropertyDataService>;
    protected propertyDataServices: PropertyDataService[];
    id: string;
    label: string;
    init(): void;
    canHandle(selection: Object | undefined): MaybePromise<number>;
    provideWidget(selection: Object | undefined): Promise<PropertyViewContentWidget>;
    updateContentWidget(selection: Object | undefined): void;
    protected getPropertyDataService(selection: Object | undefined): Promise<PropertyDataService>;
    protected prioritize(selection: Object | undefined): Promise<PropertyDataService | undefined>;
}
//# sourceMappingURL=property-view-widget-provider.d.ts.map