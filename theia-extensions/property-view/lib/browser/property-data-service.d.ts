export declare const PropertyDataService: unique symbol;
/**
 * `PropertyDataService` should be implemented to provide property data for the given selection.
 */
export interface PropertyDataService {
    /**
     * A unique id for this provider.
     */
    readonly id: string;
    /**
     * A human-readable name for this provider.
     */
    readonly label?: string;
    /**
     * Test whether this provider can provide property data for the given selection.
     * Return a nonzero number if this provider can provide; otherwise it cannot.
     * Never reject.
     *
     * A returned value indicating a priority of this provider.
     */
    canHandleSelection(selection: Object | undefined): number;
    /**
     * Provide property data for the given selection.
     * Resolve to a property view content widget.
     * Never reject if `canHandle` returns a positive number; otherwise should reject.
     */
    providePropertyData(selection: Object | undefined): Promise<Object | undefined>;
}
//# sourceMappingURL=property-data-service.d.ts.map