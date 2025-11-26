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
exports.ResourcePropertyDataService = void 0;
const tslib_1 = require("tslib");
const browser_1 = require("@theia/core/lib/browser");
const file_selection_1 = require("@theia/filesystem/lib/browser/file-selection");
const file_service_1 = require("@theia/filesystem/lib/browser/file-service");
const inversify_1 = require("@theia/core/shared/inversify");
/**
 * This data service provides property data for {@link FileSelection}s and selections of {@link Navigatable}s.
 */
let ResourcePropertyDataService = class ResourcePropertyDataService {
    constructor() {
        this.id = 'resources';
        this.label = 'ResourcePropertyDataService';
    }
    canHandleSelection(selection) {
        return (this.isFileSelection(selection) || this.isNavigatableSelection(selection)) ? 1 : 0;
    }
    isFileSelection(selection) {
        return !!selection && Array.isArray(selection) && file_selection_1.FileSelection.is(selection[0]);
    }
    isNavigatableSelection(selection) {
        return !!selection && browser_1.Navigatable.is(selection);
    }
    async getFileStat(uri) {
        return this.fileService.resolve(uri);
    }
    async providePropertyData(selection) {
        if (this.isFileSelection(selection) && Array.isArray(selection)) {
            return this.getFileStat(selection[0].fileStat.resource);
        }
        else if (this.isNavigatableSelection(selection)) {
            const navigatableUri = selection.getResourceUri();
            if (navigatableUri) {
                return this.getFileStat(navigatableUri);
            }
        }
        return undefined;
    }
};
exports.ResourcePropertyDataService = ResourcePropertyDataService;
tslib_1.__decorate([
    (0, inversify_1.inject)(file_service_1.FileService),
    tslib_1.__metadata("design:type", file_service_1.FileService)
], ResourcePropertyDataService.prototype, "fileService", void 0);
exports.ResourcePropertyDataService = ResourcePropertyDataService = tslib_1.__decorate([
    (0, inversify_1.injectable)()
], ResourcePropertyDataService);
//# sourceMappingURL=resource-property-data-service.js.map