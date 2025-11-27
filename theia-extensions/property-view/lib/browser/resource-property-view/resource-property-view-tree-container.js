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
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindResourcePropertyView = void 0;
const browser_1 = require("@theia/core/lib/browser");
const property_data_service_1 = require("../property-data-service");
const property_view_widget_provider_1 = require("../property-view-widget-provider");
const resource_property_data_service_1 = require("./resource-property-data-service");
const resource_property_view_label_provider_1 = require("./resource-property-view-label-provider");
const resource_property_view_tree_widget_1 = require("./resource-property-view-tree-widget");
const resource_property_view_widget_provider_1 = require("./resource-property-view-widget-provider");
const RESOURCE_PROPERTY_VIEW_TREE_PROPS = {
    multiSelect: true,
    search: true,
};
function createResourcePropertyViewTreeWidget(parent) {
    const child = (0, browser_1.createTreeContainer)(parent, {
        props: RESOURCE_PROPERTY_VIEW_TREE_PROPS,
        widget: resource_property_view_tree_widget_1.ResourcePropertyViewTreeWidget,
    });
    return child.get(resource_property_view_tree_widget_1.ResourcePropertyViewTreeWidget);
}
function bindResourcePropertyView(bind) {
    bind(browser_1.LabelProviderContribution).to(resource_property_view_label_provider_1.ResourcePropertiesLabelProvider).inSingletonScope();
    bind(property_data_service_1.PropertyDataService).to(resource_property_data_service_1.ResourcePropertyDataService).inSingletonScope();
    bind(property_view_widget_provider_1.PropertyViewWidgetProvider).to(resource_property_view_widget_provider_1.ResourcePropertyViewWidgetProvider).inSingletonScope();
    bind(resource_property_view_tree_widget_1.ResourcePropertyViewTreeWidget).toDynamicValue(ctx => createResourcePropertyViewTreeWidget(ctx.container));
}
exports.bindResourcePropertyView = bindResourcePropertyView;
//# sourceMappingURL=resource-property-view-tree-container.js.map