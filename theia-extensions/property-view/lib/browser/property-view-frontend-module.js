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
const browser_1 = require("@theia/core/lib/browser");
const contribution_provider_1 = require("@theia/core/lib/common/contribution-provider");
const inversify_1 = require("@theia/core/shared/inversify");
const empty_property_view_widget_provider_1 = require("./empty-property-view-widget-provider");
const property_data_service_1 = require("./property-data-service");
const property_view_contribution_1 = require("./property-view-contribution");
const property_view_service_1 = require("./property-view-service");
const property_view_widget_1 = require("./property-view-widget");
const property_view_widget_provider_1 = require("./property-view-widget-provider");
const resource_property_view_1 = require("./resource-property-view");
require("../../src/browser/style/property-view.css");
exports.default = new inversify_1.ContainerModule(bind => {
    console.log('✅ USING LOCAL PROPERTY-VIEW MODULE (1.65.2-custom)');
    bind(property_view_service_1.PropertyViewService).toSelf().inSingletonScope();
    (0, contribution_provider_1.bindContributionProvider)(bind, property_data_service_1.PropertyDataService);
    (0, contribution_provider_1.bindContributionProvider)(bind, property_view_widget_provider_1.PropertyViewWidgetProvider);
    bind(empty_property_view_widget_provider_1.EmptyPropertyViewWidgetProvider).toSelf().inSingletonScope();
    bind(property_view_widget_provider_1.PropertyViewWidgetProvider).to(empty_property_view_widget_provider_1.EmptyPropertyViewWidgetProvider);
    bind(property_view_widget_1.PropertyViewWidget).toSelf();
    bind(browser_1.WidgetFactory).toDynamicValue(({ container }) => ({
        id: property_view_widget_1.PropertyViewWidget.ID,
        createWidget: () => container.get(property_view_widget_1.PropertyViewWidget)
    })).inSingletonScope();
    (0, browser_1.bindViewContribution)(bind, property_view_contribution_1.PropertyViewContribution);
    (0, resource_property_view_1.bindResourcePropertyView)(bind);
});
//# sourceMappingURL=property-view-frontend-module.js.map