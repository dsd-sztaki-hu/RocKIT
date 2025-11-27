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
exports.PropertyViewContribution = void 0;
const tslib_1 = require("tslib");
const view_contribution_1 = require("@theia/core/lib/browser/shell/view-contribution");
const inversify_1 = require("@theia/core/shared/inversify");
const property_view_widget_1 = require("./property-view-widget");
let PropertyViewContribution = class PropertyViewContribution extends view_contribution_1.AbstractViewContribution {
    constructor() {
        super({
            widgetId: property_view_widget_1.PropertyViewWidget.ID,
            widgetName: property_view_widget_1.PropertyViewWidget.LABEL,
            defaultWidgetOptions: {
                area: 'bottom'
            },
            toggleCommandId: 'property-view:toggle',
            toggleKeybinding: 'shift+alt+p'
        });
    }
};
exports.PropertyViewContribution = PropertyViewContribution;
exports.PropertyViewContribution = PropertyViewContribution = tslib_1.__decorate([
    (0, inversify_1.injectable)(),
    tslib_1.__metadata("design:paramtypes", [])
], PropertyViewContribution);
//# sourceMappingURL=property-view-contribution.js.map