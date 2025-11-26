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
exports.ResourcePropertiesItemNode = exports.ResourcePropertiesCategoryNode = exports.ResourcePropertiesRoot = exports.ROOT_ID = void 0;
const browser_1 = require("@theia/core/lib/browser");
exports.ROOT_ID = 'ResourcePropertiesTree';
var ResourcePropertiesRoot;
(function (ResourcePropertiesRoot) {
    function is(node) {
        return browser_1.CompositeTreeNode.is(node) && node.id === exports.ROOT_ID;
    }
    ResourcePropertiesRoot.is = is;
})(ResourcePropertiesRoot || (exports.ResourcePropertiesRoot = ResourcePropertiesRoot = {}));
var ResourcePropertiesCategoryNode;
(function (ResourcePropertiesCategoryNode) {
    function is(node) {
        return browser_1.ExpandableTreeNode.is(node) && browser_1.SelectableTreeNode.is(node) && 'categoryId' in node;
    }
    ResourcePropertiesCategoryNode.is = is;
})(ResourcePropertiesCategoryNode || (exports.ResourcePropertiesCategoryNode = ResourcePropertiesCategoryNode = {}));
var ResourcePropertiesItemNode;
(function (ResourcePropertiesItemNode) {
    function is(node) {
        return !!node && browser_1.SelectableTreeNode.is(node) && 'property' in node;
    }
    ResourcePropertiesItemNode.is = is;
})(ResourcePropertiesItemNode || (exports.ResourcePropertiesItemNode = ResourcePropertiesItemNode = {}));
//# sourceMappingURL=resource-property-view-tree-items.js.map