"use strict";
// *****************************************************************************
// Copyright (C) 2020 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
var EmptyPropertyViewWidgetProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmptyPropertyViewWidgetProvider = void 0;
const tslib_1 = require("tslib");
const nls_1 = require("@theia/core/lib/common/nls");
const browser_1 = require("@theia/core/lib/browser");
const inversify_1 = require("@theia/core/shared/inversify");
const React = require("@theia/core/shared/react");
const property_view_widget_provider_1 = require("./property-view-widget-provider");
/**
 * Property view widget that is shown if no property data or selection is available.
 * This widget is provided by the {@link EmptyPropertyViewWidgetProvider}.
 */
class EmptyPropertyViewWidget extends browser_1.ReactWidget {
    constructor() {
        super();
        this.emptyComponent = React.createElement("div", { className: 'theia-widget-noInfo' }, nls_1.nls.localize('theia/property-view/noProperties', 'No properties available.'));
        this.id = EmptyPropertyViewWidget.ID;
        this.title.label = EmptyPropertyViewWidget.LABEL;
        this.title.caption = EmptyPropertyViewWidget.LABEL;
        this.title.closable = false;
        this.node.tabIndex = 0;
    }
    updatePropertyViewContent() {
        this.update();
    }
    render() {
        return this.emptyComponent;
    }
}
EmptyPropertyViewWidget.ID = 'theia-empty-property-view';
EmptyPropertyViewWidget.LABEL = 'No Properties';
/**
 * `EmptyPropertyViewWidgetProvider` is implemented to provide the {@link EmptyPropertyViewWidget}
 *  if the given selection is undefined or no other provider can handle the given selection.
 */
let EmptyPropertyViewWidgetProvider = EmptyPropertyViewWidgetProvider_1 = class EmptyPropertyViewWidgetProvider extends property_view_widget_provider_1.DefaultPropertyViewWidgetProvider {
    constructor() {
        super();
        this.id = EmptyPropertyViewWidgetProvider_1.ID;
        this.label = 'DefaultPropertyViewWidgetProvider';
        this.emptyWidget = new EmptyPropertyViewWidget();
    }
    canHandle(selection) {
        return selection === undefined ? 1 : 0;
    }
    provideWidget(selection) {
        return Promise.resolve(this.emptyWidget);
    }
    updateContentWidget(selection) {
        this.emptyWidget.updatePropertyViewContent();
    }
};
exports.EmptyPropertyViewWidgetProvider = EmptyPropertyViewWidgetProvider;
EmptyPropertyViewWidgetProvider.ID = 'no-properties';
exports.EmptyPropertyViewWidgetProvider = EmptyPropertyViewWidgetProvider = EmptyPropertyViewWidgetProvider_1 = tslib_1.__decorate([
    (0, inversify_1.injectable)(),
    tslib_1.__metadata("design:paramtypes", [])
], EmptyPropertyViewWidgetProvider);
//# sourceMappingURL=empty-property-view-widget-provider.js.map