/// <reference types="react" />
import { ReactWidget } from '@theia/core/lib/browser';
import * as React from '@theia/core/shared/react';
import { PropertyViewContentWidget } from './property-view-content-widget';
import { DefaultPropertyViewWidgetProvider } from './property-view-widget-provider';
/**
 * Property view widget that is shown if no property data or selection is available.
 * This widget is provided by the {@link EmptyPropertyViewWidgetProvider}.
 */
declare class EmptyPropertyViewWidget extends ReactWidget implements PropertyViewContentWidget {
    static readonly ID = "theia-empty-property-view";
    static readonly LABEL = "No Properties";
    constructor();
    updatePropertyViewContent(): void;
    protected render(): React.ReactNode;
    protected emptyComponent: JSX.Element;
}
/**
 * `EmptyPropertyViewWidgetProvider` is implemented to provide the {@link EmptyPropertyViewWidget}
 *  if the given selection is undefined or no other provider can handle the given selection.
 */
export declare class EmptyPropertyViewWidgetProvider extends DefaultPropertyViewWidgetProvider {
    static readonly ID = "no-properties";
    readonly id = "no-properties";
    readonly label = "DefaultPropertyViewWidgetProvider";
    private emptyWidget;
    constructor();
    canHandle(selection: Object | undefined): number;
    provideWidget(selection: Object | undefined): Promise<EmptyPropertyViewWidget>;
    updateContentWidget(selection: Object | undefined): void;
}
export {};
//# sourceMappingURL=empty-property-view-widget-provider.d.ts.map