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

// Import Monaco Editor React component
import Editor from '@monaco-editor/react'
import {
  ContextMenuRenderer,
  type NodeProps,
  TreeModel,
  type TreeNode,
  TreeProps,
  TreeWidget,
} from '@theia/core/lib/browser'
import { nls } from '@theia/core/lib/common/nls'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import type { FileStat } from '@theia/filesystem/lib/common/files'
import type { PropertyDataService } from '../property-data-service'
import type { PropertyViewContentWidget } from '../property-view-content-widget'
import {
  ResourcePropertiesCategoryNode,
  ResourcePropertiesItemNode,
  ResourcePropertiesRoot,
  ROOT_ID,
} from './resource-property-view-tree-items'

/**
 * This widget fetches the property data for {@link FileSelection}s and selections of {@link Navigatable}s
 * and renders that property data as a {@link TreeWidget}.
 * This widget is provided by the registered `ResourcePropertyViewWidgetProvider`.
 */
@injectable()
export class ResourcePropertyViewTreeWidget
  extends TreeWidget
  implements PropertyViewContentWidget
{
  static readonly ID = 'resource-properties-tree-widget'
  static readonly LABEL = 'Resource Properties Tree'

  protected propertiesTree: Map<string, ResourcePropertiesCategoryNode>
  protected currentSelection: Object | undefined
  protected fileService: FileService // Add file service for reading file content

  constructor(
    @inject(TreeProps) props: TreeProps,
    @inject(TreeModel) model: TreeModel,
    @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
    @inject(FileService) fileService: FileService, // Inject file service
  ) {
    super(props, model, contextMenuRenderer)
    this.fileService = fileService // Store file service reference

    model.root = {
      id: ROOT_ID,
      name: ResourcePropertyViewTreeWidget.LABEL,
      parent: undefined,
      visible: false,
      children: [],
    } as ResourcePropertiesRoot

    this.propertiesTree = new Map<string, ResourcePropertiesCategoryNode>()
  }

  @postConstruct()
  protected override init(): void {
    super.init()

    this.id = ResourcePropertyViewTreeWidget.ID + '-treeContainer'
    this.addClass('treeContainer')

    // Add custom class for styling
    this.addClass('resource-properties-widget')

    this.fillPropertiesTree()
  }

  protected updateNeeded(selection: Object | undefined): boolean {
    return this.currentSelection !== selection
  }

  updatePropertyViewContent(
    propertyDataService?: PropertyDataService,
    selection?: Object | undefined,
  ): void {
    if (this.updateNeeded(selection)) {
      this.currentSelection = selection
      if (propertyDataService) {
        propertyDataService
          .providePropertyData(selection)
          .then((fileStatObject?: FileStat) => {
            this.fillPropertiesTree(fileStatObject)
          })
      }
    }
  }

  protected async fillPropertiesTree(fileStatObject?: FileStat): Promise<void> {
    if (fileStatObject) {
      this.propertiesTree.clear()
      const infoNode = this.createCategoryNode(
        'info',
        nls.localize('rockit/filePreview/fileInfo', 'File Info'),
      )
      this.propertiesTree.set('info', infoNode)

      // Add file properties to Info node
      infoNode.children.push(
        this.createResultLineNode(
          'isDirectory',
          nls.localize('rockit/filePreview/directory', 'Directory'),
          fileStatObject.isDirectory,
          infoNode,
        ),
      )
      infoNode.children.push(
        this.createResultLineNode(
          'isFile',
          nls.localize('rockit/filePreview/file', 'File'),
          fileStatObject.isFile,
          infoNode,
        ),
      )
      infoNode.children.push(
        this.createResultLineNode(
          'isSymbolicLink',
          nls.localize('rockit/filePreview/symbolicLink', 'Symbolic link'),
          fileStatObject.isSymbolicLink,
          infoNode,
        ),
      )
      infoNode.children.push(
        this.createResultLineNode(
          'location',
          nls.localize('rockit/filePreview/location', 'Location'),
          this.getLocationString(fileStatObject),
          infoNode,
        ),
      )
      infoNode.children.push(
        this.createResultLineNode(
          'name',
          nls.localize('rockit/filePreview/name', 'Name'),
          this.getFileName(fileStatObject),
          infoNode,
        ),
      )
      infoNode.children.push(
        this.createResultLineNode(
          'path',
          nls.localize('rockit/filePreview/path', 'Path'),
          this.getFilePath(fileStatObject),
          infoNode,
        ),
      )
      infoNode.children.push(
        this.createResultLineNode(
          'lastModification',
          nls.localize('rockit/filePreview/lastModified', 'Last modified'),
          this.getLastModificationString(fileStatObject),
          infoNode,
        ),
      )
      infoNode.children.push(
        this.createResultLineNode(
          'created',
          nls.localize('rockit/filePreview/created', 'Created'),
          this.getCreationTimeString(fileStatObject),
          infoNode,
        ),
      )
      infoNode.children.push(
        this.createResultLineNode(
          'size',
          nls.localize('rockit/filePreview/size', 'Size'),
          this.getSizeString(fileStatObject),
          infoNode,
        ),
      )

      // Add content preview as a separate node if it's a file
      if (fileStatObject.isFile) {
        const contentNode = await this.createContentNode(fileStatObject)
        if (contentNode) {
          this.propertiesTree.set('content', contentNode)
        }
      }

      this.refreshModelChildren()
    }
  }

  protected async createContentNode(
    fileStat: FileStat,
  ): Promise<ResourcePropertiesCategoryNode | null> {
    try {
      const content = await this.fileService.read(fileStat.resource)
      const contentString = content.value
      const fileName = this.getFileName(fileStat)
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || ''

      // Create content category node
      const contentNode = this.createCategoryNode(
        'content',
        nls.localize('rockit/filePreview/title', 'File Preview'),
      )

      // Check if it's an image file
      const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp']
      if (imageExtensions.includes(fileExtension)) {
        // For images, create a special item node with image URI
        contentNode.children.push(
          this.createResultLineNode(
            'imageContent',
            '',
            `IMAGE::${fileStat.resource.toString()}`,
            contentNode,
          ),
        )
      } else {
        // For text files, create an item node with content and language info
        const language = this.guessLanguage(fileExtension)
        contentNode.children.push(
          this.createResultLineNode(
            'textContent',
            '',
            `TEXT::${contentString}::${language}`,
            contentNode,
          ),
        )
      }

      return contentNode
    } catch (error) {
      console.error('Error reading file content:', error)
      const contentNode = this.createCategoryNode(
        'content',
        nls.localize('rockit/filePreview/content', 'Content'),
      )
      contentNode.children.push(
        this.createResultLineNode(
          'error',
          '',
          nls.localize(
            'rockit/filePreview/readFailed',
            'Could not read file content',
          ),
          contentNode,
        ),
      )
      return contentNode
    }
  }

  protected guessLanguage(fileExtension: string): string {
    const languageMap: { [key: string]: string } = {
      js: 'javascript',
      ts: 'typescript',
      html: 'html',
      css: 'css',
      json: 'json',
      xml: 'xml',
      java: 'java',
      py: 'python',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      go: 'go',
      rs: 'rust',
      sh: 'shell',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      txt: 'plaintext',
      sql: 'sql',
      php: 'php',
      rb: 'ruby',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      cs: 'csharp',
    }
    return languageMap[fileExtension] || 'plaintext'
  }

  protected getLocationString(fileStat: FileStat): string {
    return fileStat.resource.path.fsPath()
  }

  protected getFileName(fileStat: FileStat): string {
    return this.labelProvider.getName(fileStat.resource)
  }

  protected getFilePath(fileStat: FileStat): string {
    return this.labelProvider.getLongName(fileStat.resource)
  }

  protected getLastModificationString(fileStat: FileStat): string {
    return fileStat.mtime
      ? new Date(fileStat.mtime).toLocaleString(this.getDisplayLocale())
      : ''
  }

  protected getCreationTimeString(fileStat: FileStat): string {
    return fileStat.ctime
      ? new Date(fileStat.ctime).toLocaleString(this.getDisplayLocale())
      : ''
  }

  protected getSizeString(fileStat: FileStat): string {
    return fileStat.size !== undefined
      ? nls.localize(
          'rockit/filePreview/bytes',
          '{0} B',
          fileStat.size.toLocaleString(this.getDisplayLocale()),
        )
      : ''
  }

  protected getDisplayLocale(): string {
    const languageId =
      nls.localization?.languageId ?? nls.locale ?? nls.defaultLocale
    return languageId.toLowerCase().startsWith('hu') ? 'hu-HU' : 'en-US'
  }

  /*
   * Creating TreeNodes
   */

  protected createCategoryNode(
    categoryId: string,
    name: string,
  ): ResourcePropertiesCategoryNode {
    return {
      id: categoryId,
      parent: this.model.root as ResourcePropertiesRoot,
      name,
      children: [],
      categoryId,
      selected: false,
      expanded: true,
    }
  }

  protected createResultLineNode(
    id: string,
    name: string,
    property: boolean | string | undefined,
    parent: ResourcePropertiesCategoryNode,
  ): ResourcePropertiesItemNode {
    return {
      id: `${parent.id}::${id}`,
      parent,
      name: name,
      property:
        typeof property === 'boolean'
          ? property
            ? nls.localize('rockit/filePreview/yes', 'Yes')
            : nls.localize('rockit/filePreview/no', 'No')
          : property !== undefined
            ? String(property)
            : '',
      selected: false,
    }
  }

  /**
   * Rendering
   */

  protected async refreshModelChildren(): Promise<void> {
    if (ResourcePropertiesRoot.is(this.model.root)) {
      this.model.root.children = Array.from(this.propertiesTree.values())
      this.model.refresh()
    }
  }

  protected override renderCaption(node: TreeNode, _props: NodeProps): React.ReactNode {
    if (ResourcePropertiesCategoryNode.is(node)) {
      // Render category node (expandable node)
      return (
        <React.Fragment>
          <div className={`theia-resource-tree-node-icon ${this.toNodeIcon(node)}`}></div>
          <div
            className={
              'theia-resource-tree-node-name theia-TreeNodeSegment theia-TreeNodeSegmentGrow'
            }
          >
            {this.toNodeName(node)}
          </div>
        </React.Fragment>
      )
    } else if (ResourcePropertiesItemNode.is(node)) {
      // Special handling for content nodes - make them full width
      if (node.parent?.id === 'content') {
        return this.renderContentNode(node)
      }
      // Render regular item node
      return (
        <React.Fragment>
          <div className={`theia-resource-tree-node-icon ${this.toNodeIcon(node)}`}></div>
          <div
            className={
              'theia-resource-tree-node-name theia-TreeNodeSegment theia-TreeNodeSegmentGrow'
            }
          >
            {this.toNodeName(node)}
          </div>
          <div
            className={
              'theia-resource-tree-node-property theia-TreeNodeSegment theia-TreeNodeSegmentGrow'
            }
          >
            {this.toNodeDescription(node)}
          </div>
        </React.Fragment>
      )
    }
    return undefined
  }

  protected renderContentNode(node: ResourcePropertiesItemNode): React.ReactNode {
    if (node.property.startsWith('IMAGE::')) {
      const imageUrl = node.property.substring(7) // Remove 'IMAGE::' prefix
      return (
        <div className="resource-content-image-container">
          <img
            src={imageUrl}
            alt={nls.localize('rockit/filePreview/imagePreview', 'Image preview')}
          />
        </div>
      )
    } else if (node.property.startsWith('TEXT::')) {
      // Extract content and language from the property string
      const parts = node.property.split('::')
      const content = parts[1] || ''
      const language = parts[2] || 'plaintext'
      const monacoTheme = this.getCurrentMonacoTheme()

      // For text content, render in a Monaco editor
      return (
        <div className="resource-content-monaco-container">
          <Editor
            height="300px" // Default height, will be adjusted by CSS
            language={language}
            value={content}
            theme={monacoTheme} // Will be adjusted by CSS for theme support
            options={{
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
                horizontal: 'auto',
              },
            }}
          />
        </div>
      )
    } else {
      // For error messages, fall back to regular text display
      return (
        <div
          className="resource-content-preview"
          contentEditable={false} // Explicitly set to false to prevent editing
          onMouseDown={(e) => {
            // Ensure the element gets focus when clicked
            ;(e.target as HTMLElement).focus()
          }}
        >
          {node.property}
        </div>
      )
    }
  }

  private getCurrentMonacoTheme(): string {
    // Check the current body class to determine Theia's theme
    if (document.body.classList.contains('theia-dark')) {
      return 'vs-dark' // Use dark theme for Monaco
    } else if (document.body.classList.contains('theia-hc')) {
      return 'hc-black' // Use high contrast theme for Monaco
    } else {
      return 'vs' // Use light theme for Monaco (default)
    }
  }

  protected override createNodeAttributes(
    node: TreeNode,
    props: NodeProps,
  ): React.Attributes & React.HTMLAttributes<HTMLElement> {
    // For content nodes, modify the attributes to remove indentation and disable selection/hover
    if (ResourcePropertiesItemNode.is(node) && node.parent?.id === 'content') {
      return {
        ...super.createNodeAttributes(node, props),
        className: 'no-select no-hover', // Add CSS classes to disable hover effects
        title: this.getNodeTooltip(node),
        // Disable click events on content nodes to prevent selection
        onClick: (e) => {
          e.stopPropagation()
          // Don't prevent default to allow focus to work
        },
        onMouseDown: (e) => {
          e.stopPropagation()
          // Allow the event to continue so focus can be set
        },
      }
    }
    return {
      ...super.createNodeAttributes(node, props),
      title: this.getNodeTooltip(node),
    }
  }

  protected getNodeTooltip(node: TreeNode): string | undefined {
    if (ResourcePropertiesCategoryNode.is(node)) {
      return this.labelProvider.getName(node)
    } else if (ResourcePropertiesItemNode.is(node)) {
      if (node.parent?.id === 'content') {
        return this.labelProvider.getName(node)
      }
      return `${this.labelProvider.getName(node)}: ${this.labelProvider.getLongName(node)}`
    }
    return undefined
  }
}
