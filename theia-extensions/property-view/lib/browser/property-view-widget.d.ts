import { Message } from '@theia/core/shared/@lumino/messaging';
import { SelectionService } from '@theia/core';
import { BaseWidget, Widget } from '@theia/core/lib/browser/widgets/widget';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { PropertyViewContentWidget } from './property-view-content-widget';
import { PropertyViewService } from './property-view-service';
/**
 * The main container for the selection-specific property widgets.
 * Based on the given selection, the registered `PropertyViewWidgetProvider` provides the
 * content widget that displays the corresponding properties.
 */
export declare class PropertyViewWidget extends BaseWidget {
    static readonly ID = "property-view";
    static readonly LABEL: string;
    protected contentWidget: PropertyViewContentWidget;
    protected toDisposeOnDetach: DisposableCollection;
    protected readonly propertyViewService: PropertyViewService;
    protected readonly selectionService: SelectionService;
    init(): void;
    protected initializeContentWidget(selection: Object | undefined): void;
    protected replaceContentWidget(newContentWidget: PropertyViewContentWidget): void;
    protected attachContentWidget(newContentWidget: PropertyViewContentWidget): void;
    protected onAfterAttach(msg: Message): void;
    protected onActivateRequest(msg: Message): void;
    protected onResize(msg: Widget.ResizeMessage): void;
}
//# sourceMappingURL=property-view-widget.d.ts.map