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
var ResourcePropertyViewTreeWidget_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourcePropertyViewTreeWidget = void 0;
const tslib_1 = require("tslib");
const browser_1 = require("@theia/core/lib/browser");
const inversify_1 = require("@theia/core/shared/inversify");
const React = require("@theia/core/shared/react");
const resource_property_view_tree_items_1 = require("./resource-property-view-tree-items");
const nls_1 = require("@theia/core/lib/common/nls");
const file_service_1 = require("@theia/filesystem/lib/browser/file-service");
// Import Monaco Editor React component
const react_1 = require("@monaco-editor/react");
/**
 * This widget fetches the property data for {@link FileSelection}s and selections of {@link Navigatable}s
 * and renders that property data as a {@link TreeWidget}.
 * This widget is provided by the registered `ResourcePropertyViewWidgetProvider`.
 */
let ResourcePropertyViewTreeWidget = ResourcePropertyViewTreeWidget_1 = class ResourcePropertyViewTreeWidget extends browser_1.TreeWidget {
    constructor(props, model, contextMenuRenderer, fileService // Inject file service
    ) {
        super(props, model, contextMenuRenderer);
        this.fileService = fileService; // Store file service reference
        model.root = {
            id: resource_property_view_tree_items_1.ROOT_ID,
            name: ResourcePropertyViewTreeWidget_1.LABEL,
            parent: undefined,
            visible: false,
            children: []
        };
        this.propertiesTree = new Map();
    }
    init() {
        super.init();
        this.id = ResourcePropertyViewTreeWidget_1.ID + '-treeContainer';
        this.addClass('treeContainer');
        // Add custom class for styling
        this.addClass('resource-properties-widget');
        this.fillPropertiesTree();
    }
    updateNeeded(selection) {
        return this.currentSelection !== selection;
    }
    updatePropertyViewContent(propertyDataService, selection) {
        if (this.updateNeeded(selection)) {
            this.currentSelection = selection;
            if (propertyDataService) {
                propertyDataService.providePropertyData(selection).then((fileStatObject) => {
                    this.fillPropertiesTree(fileStatObject);
                });
            }
        }
    }
    async fillPropertiesTree(fileStatObject) {
        if (fileStatObject) {
            this.propertiesTree.clear();
            const infoNode = this.createCategoryNode('info', nls_1.nls.localizeByDefault('Info'));
            this.propertiesTree.set('info', infoNode);
            // Add file properties to Info node
            infoNode.children.push(this.createResultLineNode('isDirectory', nls_1.nls.localize('theia/property-view/directory', 'Directory'), fileStatObject.isDirectory, infoNode));
            infoNode.children.push(this.createResultLineNode('isFile', nls_1.nls.localizeByDefault('File'), fileStatObject.isFile, infoNode));
            infoNode.children.push(this.createResultLineNode('isSymbolicLink', nls_1.nls.localize('theia/property-view/symbolicLink', 'Symbolic link'), fileStatObject.isSymbolicLink, infoNode));
            infoNode.children.push(this.createResultLineNode('location', nls_1.nls.localize('theia/property-view/location', 'Location'), this.getLocationString(fileStatObject), infoNode));
            infoNode.children.push(this.createResultLineNode('name', nls_1.nls.localizeByDefault('Name'), this.getFileName(fileStatObject), infoNode));
            infoNode.children.push(this.createResultLineNode('path', nls_1.nls.localizeByDefault('Path'), this.getFilePath(fileStatObject), infoNode));
            infoNode.children.push(this.createResultLineNode('lastModification', nls_1.nls.localize('theia/property-view/lastModified', 'Last modified'), this.getLastModificationString(fileStatObject), infoNode));
            infoNode.children.push(this.createResultLineNode('created', nls_1.nls.localize('theia/property-view/created', 'Created'), this.getCreationTimeString(fileStatObject), infoNode));
            infoNode.children.push(this.createResultLineNode('size', nls_1.nls.localizeByDefault('Size'), this.getSizeString(fileStatObject), infoNode));
            // Add content preview as a separate node if it's a file
            if (fileStatObject.isFile) {
                const contentNode = await this.createContentNode(fileStatObject);
                if (contentNode) {
                    this.propertiesTree.set('content', contentNode);
                }
            }
            this.refreshModelChildren();
        }
    }
    async createContentNode(fileStat) {
        var _a;
        try {
            const content = await this.fileService.read(fileStat.resource);
            const contentString = content.value;
            const fileName = this.getFileName(fileStat);
            const fileExtension = ((_a = fileName.split('.').pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase()) || '';
            // Create content category node
            const contentNode = this.createCategoryNode('content', nls_1.nls.localizeByDefault('Content'));
            // Check if it's an image file
            const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
            if (imageExtensions.includes(fileExtension)) {
                // For images, create a special item node with image URI
                contentNode.children.push(this.createResultLineNode('imageContent', '', `IMAGE::${fileStat.resource.toString()}`, contentNode));
            }
            else {
                // For text files, create an item node with content and language info
                const language = this.guessLanguage(fileExtension);
                contentNode.children.push(this.createResultLineNode('textContent', '', `TEXT::${contentString}::${language}`, contentNode));
            }
            return contentNode;
        }
        catch (error) {
            console.error('Error reading file content:', error);
            const contentNode = this.createCategoryNode('content', nls_1.nls.localizeByDefault('Content'));
            contentNode.children.push(this.createResultLineNode('error', '', nls_1.nls.localizeByDefault('Could not read file content'), contentNode));
            return contentNode;
        }
    }
    guessLanguage(fileExtension) {
        const languageMap = {
            'js': 'javascript',
            'ts': 'typescript',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'xml': 'xml',
            'java': 'java',
            'py': 'python',
            'cpp': 'cpp',
            'c': 'c',
            'h': 'c',
            'hpp': 'cpp',
            'go': 'go',
            'rs': 'rust',
            'sh': 'shell',
            'yaml': 'yaml',
            'yml': 'yaml',
            'md': 'markdown',
            'txt': 'plaintext',
            'sql': 'sql',
            'php': 'php',
            'rb': 'ruby',
            'swift': 'swift',
            'kt': 'kotlin',
            'scala': 'scala',
            'cs': 'csharp'
        };
        return languageMap[fileExtension] || 'plaintext';
    }
    getLocationString(fileStat) {
        return fileStat.resource.path.fsPath();
    }
    getFileName(fileStat) {
        return this.labelProvider.getName(fileStat.resource);
    }
    getFilePath(fileStat) {
        return this.labelProvider.getLongName(fileStat.resource);
    }
    getLastModificationString(fileStat) {
        return fileStat.mtime ? new Date(fileStat.mtime).toLocaleString() : '';
    }
    getCreationTimeString(fileStat) {
        return fileStat.ctime ? new Date(fileStat.ctime).toLocaleString() : '';
    }
    getSizeString(fileStat) {
        return fileStat.size ? nls_1.nls.localizeByDefault('{0}B', fileStat.size.toString()) : '';
    }
    /*
    * Creating TreeNodes
    */
    createCategoryNode(categoryId, name) {
        return {
            id: categoryId,
            parent: this.model.root,
            name,
            children: [],
            categoryId,
            selected: false,
            expanded: true
        };
    }
    createResultLineNode(id, name, property, parent) {
        return {
            id: `${parent.id}::${id}`,
            parent,
            name: name,
            property: property !== undefined ? String(property) : '',
            selected: false
        };
    }
    /**
     * Rendering
     */
    async refreshModelChildren() {
        if (resource_property_view_tree_items_1.ResourcePropertiesRoot.is(this.model.root)) {
            this.model.root.children = Array.from(this.propertiesTree.values());
            this.model.refresh();
        }
    }
    renderCaption(node, props) {
        var _a;
        if (resource_property_view_tree_items_1.ResourcePropertiesCategoryNode.is(node)) {
            // Render category node (expandable node)
            return React.createElement(React.Fragment, null,
                React.createElement("div", { className: `theia-resource-tree-node-icon ${this.toNodeIcon(node)}` }),
                React.createElement("div", { className: 'theia-resource-tree-node-name theia-TreeNodeSegment theia-TreeNodeSegmentGrow' }, this.toNodeName(node)));
        }
        else if (resource_property_view_tree_items_1.ResourcePropertiesItemNode.is(node)) {
            // Special handling for content nodes - make them full width
            if (((_a = node.parent) === null || _a === void 0 ? void 0 : _a.id) === 'content') {
                return this.renderContentNode(node);
            }
            // Render regular item node
            return React.createElement(React.Fragment, null,
                React.createElement("div", { className: `theia-resource-tree-node-icon ${this.toNodeIcon(node)}` }),
                React.createElement("div", { className: 'theia-resource-tree-node-name theia-TreeNodeSegment theia-TreeNodeSegmentGrow' }, this.toNodeName(node)),
                React.createElement("div", { className: 'theia-resource-tree-node-property theia-TreeNodeSegment theia-TreeNodeSegmentGrow' }, this.toNodeDescription(node)));
        }
        return undefined;
    }
    renderContentNode(node) {
        if (node.property.startsWith('IMAGE::')) {
            const imageUrl = node.property.substring(7); // Remove 'IMAGE::' prefix
            return React.createElement("div", { className: "resource-content-image-container" },
                React.createElement("img", { src: imageUrl, alt: "Image Preview" }));
        }
        else if (node.property.startsWith('TEXT::')) {
            // Extract content and language from the property string
            const parts = node.property.split('::');
            const content = parts[1] || '';
            const language = parts[2] || 'plaintext';
            // For text content, render in a Monaco editor
            return React.createElement("div", { className: "resource-content-monaco-container" },
                React.createElement(react_1.default, { language: language, value: content, theme: "vs-light" // Will be adjusted by CSS for theme support
                    , options: {
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 12,
                        fontFamily: 'monospace',
                        wordWrap: 'on',
                        automaticLayout: true,
                        renderLineHighlight: 'none',
                        cursorBlinking: 'solid',
                        smoothScrolling: true,
                        mouseWheelZoom: false,
                        scrollbar: {
                            vertical: 'auto',
                            horizontal: 'auto'
                        }
                    } }));
        }
        else {
            // For error messages, fall back to regular text display
            return React.createElement("div", { className: "resource-content-preview", tabIndex: 0, contentEditable: false, onMouseDown: (e) => {
                    // Ensure the element gets focus when clicked
                    e.target.focus();
                } }, node.property);
        }
    }
    createNodeAttributes(node, props) {
        var _a;
        // For content nodes, modify the attributes to remove indentation and disable selection/hover
        if (resource_property_view_tree_items_1.ResourcePropertiesItemNode.is(node) && ((_a = node.parent) === null || _a === void 0 ? void 0 : _a.id) === 'content') {
            return {
                ...super.createNodeAttributes(node, props),
                className: 'no-select no-hover', // Add CSS classes to disable hover effects
                title: this.getNodeTooltip(node),
                // Disable click events on content nodes to prevent selection
                onClick: (e) => {
                    e.stopPropagation();
                    // Don't prevent default to allow focus to work
                },
                onMouseDown: (e) => {
                    e.stopPropagation();
                    // Allow the event to continue so focus can be set
                }
            };
        }
        return {
            ...super.createNodeAttributes(node, props),
            title: this.getNodeTooltip(node)
        };
    }
    getNodeTooltip(node) {
        var _a;
        if (resource_property_view_tree_items_1.ResourcePropertiesCategoryNode.is(node)) {
            return this.labelProvider.getName(node);
        }
        else if (resource_property_view_tree_items_1.ResourcePropertiesItemNode.is(node)) {
            if (((_a = node.parent) === null || _a === void 0 ? void 0 : _a.id) === 'content') {
                return this.labelProvider.getName(node);
            }
            return `${this.labelProvider.getName(node)}: ${this.labelProvider.getLongName(node)}`;
        }
        return undefined;
    }
};
exports.ResourcePropertyViewTreeWidget = ResourcePropertyViewTreeWidget;
ResourcePropertyViewTreeWidget.ID = 'resource-properties-tree-widget';
ResourcePropertyViewTreeWidget.LABEL = 'Resource Properties Tree';
tslib_1.__decorate([
    (0, inversify_1.postConstruct)(),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", void 0)
], ResourcePropertyViewTreeWidget.prototype, "init", null);
exports.ResourcePropertyViewTreeWidget = ResourcePropertyViewTreeWidget = ResourcePropertyViewTreeWidget_1 = tslib_1.__decorate([
    (0, inversify_1.injectable)(),
    tslib_1.__param(0, (0, inversify_1.inject)(browser_1.TreeProps)),
    tslib_1.__param(1, (0, inversify_1.inject)(browser_1.TreeModel)),
    tslib_1.__param(2, (0, inversify_1.inject)(browser_1.ContextMenuRenderer)),
    tslib_1.__param(3, (0, inversify_1.inject)(file_service_1.FileService)),
    tslib_1.__metadata("design:paramtypes", [Object, Object, browser_1.ContextMenuRenderer,
        file_service_1.FileService // Inject file service
    ])
], ResourcePropertyViewTreeWidget);
//# sourceMappingURL=resource-property-view-tree-widget.js.map