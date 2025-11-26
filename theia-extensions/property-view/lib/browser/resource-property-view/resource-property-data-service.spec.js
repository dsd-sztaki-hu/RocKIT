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
const frontend_application_config_provider_1 = require("@theia/core/lib/browser/frontend-application-config-provider");
frontend_application_config_provider_1.FrontendApplicationConfigProvider.set({});
const chai_1 = require("chai");
const inversify_1 = require("@theia/core/shared/inversify");
const resource_property_data_service_1 = require("./resource-property-data-service");
const file_service_1 = require("@theia/filesystem/lib/browser/file-service");
const uri_1 = require("@theia/core/lib/common/uri");
const property_data_service_1 = require("../property-data-service");
disableJSDOM();
let resourcePropertyDataService;
const mockFileStat = {
    isFile: false,
    isDirectory: true,
    isSymbolicLink: false,
    isReadonly: false,
    resource: new uri_1.default('resource'),
    name: 'name'
};
describe('resource-property-data-service', () => {
    before(() => {
        disableJSDOM = (0, jsdom_1.enableJSDOM)();
        const container = new inversify_1.Container();
        container.bind(resource_property_data_service_1.ResourcePropertyDataService).toSelf().inSingletonScope();
        container.bind(file_service_1.FileService).toConstantValue({
            async resolve(uri) {
                return mockFileStat;
            }
        });
        container.bind(property_data_service_1.PropertyDataService).to(resource_property_data_service_1.ResourcePropertyDataService).inSingletonScope();
        resourcePropertyDataService = container.get(resource_property_data_service_1.ResourcePropertyDataService);
    });
    after(() => {
        disableJSDOM();
    });
    const navigatableSelection = {
        getResourceUri() {
            return new uri_1.default('resource-uri');
        },
        createMoveToUri() {
            return new uri_1.default('move-uri');
        }
    };
    const fileSelection = [
        { fileStat: mockFileStat }
    ];
    describe('#canHandle', () => {
        it('should not handle an empty object selection', () => {
            (0, chai_1.expect)(resourcePropertyDataService.canHandleSelection({})).eq(0);
        });
        it('should not handle an undefined selection', () => {
            (0, chai_1.expect)(resourcePropertyDataService.canHandleSelection(undefined)).eq(0);
        });
        it('should handle a file selection', () => {
            (0, chai_1.expect)(resourcePropertyDataService.canHandleSelection(fileSelection)).to.be.greaterThan(0);
        });
        it('should handle a navigatable selection', () => {
            (0, chai_1.expect)(resourcePropertyDataService.canHandleSelection(navigatableSelection)).to.be.greaterThan(0);
        });
    });
    describe('#providePropertyData', () => {
        it('should return the file-stat of a file selection', async () => {
            const data = await resourcePropertyDataService.providePropertyData(fileSelection);
            (0, chai_1.expect)(data).to.equal(mockFileStat);
        });
        it('should return the first file-stat for multiple file selections', async () => {
            const arrayFileSelection = [
                { fileStat: mockFileStat },
                { fileStat: { ...mockFileStat, resource: new uri_1.default('secondURI') } }
            ];
            const data = await resourcePropertyDataService.providePropertyData(arrayFileSelection);
            (0, chai_1.expect)(data).to.equal(arrayFileSelection[0].fileStat);
        });
        it('should return the file-stat for a navigatable selection', async () => {
            const data = await resourcePropertyDataService.providePropertyData(navigatableSelection);
            (0, chai_1.expect)(data).to.equal(mockFileStat);
        });
        it('should return undefined if the selection is undefined', async () => {
            const data = await resourcePropertyDataService.providePropertyData(undefined);
            (0, chai_1.expect)(data).to.equal(undefined);
        });
    });
});
//# sourceMappingURL=resource-property-data-service.spec.js.map