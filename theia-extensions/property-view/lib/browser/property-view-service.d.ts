import { PropertyViewWidgetProvider } from './property-view-widget-provider';
/**
 * `PropertyViewService` provides an access to existing property view widget providers.
 */
export declare class PropertyViewService {
    private readonly contributions;
    private readonly emptyWidgetProvider;
    private providers;
    init(): void;
    /**
     * Return a property view widget provider with the highest priority for the given selection.
     * Never reject, return the default provider ({@link EmptyPropertyViewWidgetProvider};
     * displays `No properties available`) if there are no other matches.
     */
    getProvider(selection: Object | undefined): Promise<PropertyViewWidgetProvider>;
    protected prioritize(selection: Object | undefined): Promise<PropertyViewWidgetProvider | undefined>;
}
//# sourceMappingURL=property-view-service.d.ts.map