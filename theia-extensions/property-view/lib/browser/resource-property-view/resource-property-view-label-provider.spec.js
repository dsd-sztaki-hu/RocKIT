"use strict";
// *****************************************************************************
// Copyright (C) 2021 Ericsson and others.
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
const jsdom_1 = require("@theia/core/lib/browser/test/jsdom");
let disableJSDOM = (0, jsdom_1.enableJSDOM)();
const chai_1 = require("chai");
const frontend_application_config_provider_1 = require("@theia/core/lib/browser/frontend-application-config-provider");
frontend_application_config_provider_1.FrontendApplicationConfigProvider.set({});
const inversify_1 = require("@theia/core/shared/inversify");
const resource_property_view_label_provider_1 = require("./resource-property-view-label-provider");
const label_provider_1 = require("@theia/core/lib/browser/label-provider");
const common_1 = require("@theia/core/lib/common");
disableJSDOM();
let resourcePropertiesLabelProvider;
describe('resource-property-view-label', () => {
    before(() => {
        disableJSDOM = (0, jsdom_1.enableJSDOM)();
        const container = new inversify_1.Container();
        container.bind(resource_property_view_label_provider_1.ResourcePropertiesLabelProvider).toSelf().inSingletonScope();
        container.bind(label_provider_1.LabelProvider).toSelf().inSingletonScope();
        container.bind(common_1.ContributionProvider)
            .toConstantValue({
            getContributions: () => [],
        })
            .whenTargetNamed(label_provider_1.LabelProviderContribution);
        resourcePropertiesLabelProvider = container.get(resource_property_view_label_provider_1.ResourcePropertiesLabelProvider);
    });
    after(() => {
        disableJSDOM();
    });
    const categoryNode = {
        name: 'category',
        id: '',
        icon: 'iconCategory',
        children: [],
        parent: {
            id: '',
            parent: undefined,
            children: []
        },
        categoryId: '',
        expanded: false,
        selected: false,
    };
    const itemNode = {
        name: 'item',
        id: '',
        icon: 'iconItem',
        selected: false,
        parent: {
            name: 'category',
            id: '',
            icon: '',
            children: [],
            parent: {
                id: '',
                parent: undefined,
                children: []
            },
            categoryId: '',
            expanded: false,
            selected: false,
        },
        property: 'property'
    };
    describe('#canHandle', () => {
        it('should handle a category node', () => {
            (0, chai_1.expect)(resourcePropertiesLabelProvider.canHandle(categoryNode)).to.be.greaterThan(0);
        });
        it('should handle an item node', () => {
            (0, chai_1.expect)(resourcePropertiesLabelProvider.canHandle(itemNode)).to.be.greaterThan(0);
        });
        it('should not handle a tree node (not an item nor a category)', () => {
            const node = {
                id: '',
                parent: undefined
            };
            (0, chai_1.expect)(resourcePropertiesLabelProvider.canHandle(node)).eq(0);
        });
    });
    describe('#getIcon', () => {
        it('should get the icon of a category node', () => {
            (0, chai_1.expect)(resourcePropertiesLabelProvider.getIcon(categoryNode)).eq('iconCategory');
        });
        it('should get the default icon if a category node has an undefined icon field', () => {
            const emptyIconCategory = categoryNode;
            emptyIconCategory.icon = undefined;
            (0, chai_1.expect)(resourcePropertiesLabelProvider.getIcon(emptyIconCategory)).eq(resource_property_view_label_provider_1.DEFAULT_INFO_ICON);
        });
        it('should get the icon of an item node', () => {
            (0, chai_1.expect)(resourcePropertiesLabelProvider.getIcon(itemNode)).eq('iconItem');
        });
        it('should get an empty string if an item node has an undefined icon field', () => {
            const emptyIconItem = itemNode;
            emptyIconItem.icon = undefined;
            (0, chai_1.expect)(resourcePropertiesLabelProvider.getIcon(emptyIconItem)).eq('');
        });
    });
    describe('#getName', () => {
        it('should get the name of a category node', () => {
            (0, chai_1.expect)(resourcePropertiesLabelProvider.getName(categoryNode)).eq('category');
        });
        it('should get the name of an item node', () => {
            (0, chai_1.expect)(resourcePropertiesLabelProvider.getName(itemNode)).eq('item');
        });
    });
    describe('#getLongName', () => {
        it('should get the property of an item node', () => {
            (0, chai_1.expect)(resourcePropertiesLabelProvider.getLongName(itemNode)).eq('property');
        });
        it('should get the name of a category node', () => {
            (0, chai_1.expect)(resourcePropertiesLabelProvider.getLongName(categoryNode)).eq('category');
        });
    });
});
//# sourceMappingURL=resource-property-view-label-provider.spec.js.map