import { Widget } from '@theia/core/lib/browser/widgets/widget';
import { PropertyDataService } from './property-data-service';
/**
 * A widget that fetches the property data via the given {@link PropertyDataService} and the given selection
 * and renders that property data.
 * This widget can be provided by a registered `PropertyViewWidgetProvider`.
 */
export interface PropertyViewContentWidget extends Widget {
    updatePropertyViewContent(propertyDataService?: PropertyDataService, selection?: Object): void;
}
//# sourceMappingURL=property-view-content-widget.d.ts.map