import { FileOutlined, FolderOpenOutlined, FolderOutlined } from '@ant-design/icons'
import type { Disposable } from '@theia/core'
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import type { TreeDataNode } from 'antd'
import { Tooltip, Tree } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { inject, injectable } from 'inversify'
import * as React from 'react'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'

interface CrateNode {
  id: string
  name: string
  type: string
  children: CrateNode[]
  conformsToUrls?: string[]
}

@injectable()
export class RoCrateStructurePanelWidget extends ReactWidget {
  static readonly ID = 'dataset-panel:widget'

  protected instanceId: string = ''

  @inject(AppStateService)
  protected readonly appStateService: AppStateService
  @inject(WidgetManager)
  protected readonly widgetManager: WidgetManager
  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

  protected crateSubscription?: Disposable

  constructor() {
    super()
    this.addClass('dataset-panel')
    this.title.closable = true
  }

  initialize(options: any = {}): void {
    this.instanceId =
      options.instanceId ??
      `${RoCrateStructurePanelWidget.ID}:${Math.random().toString(36).substring(2)}`

    this.id = this.instanceId
    this.title.label = `RO-Crate Structure panel (${this.instanceId})`

    this.crateSubscription = this.appStateService.onDidChangeSelector((s) => s.roCrate)(
      (_) => this.update(),
    )

    this.update()
  }

  protected dig = (path = '0', level = 3): TreeDataNode[] => {
    const list: TreeDataNode[] = []
    for (let i = 0; i < 10; i += 1) {
      const key = `${path}-${i}`
      const treeNode: TreeDataNode = {
        title: key,
        key,
      }

      if (level > 0) {
        treeNode.children = this.dig(key, level - 1)
      }

      list.push(treeNode)
    }
    return list
  }

  protected treeData = this.dig()

  protected expandedKeys: string[] = []

  protected MemoTooltip: React.ComponentType<any> = React.memo(Tooltip as any)

  protected buildCrateTree(
    crate: any,
    selectedEntity?: string,
  ): {
    root?: CrateNode
    selectedNodeId?: string
    expandedNodeIds: string[]
    parents: string[]
  } {
    if (!crate) {
      return {
        root: undefined,
        selectedNodeId: undefined,
        expandedNodeIds: [],
        parents: [],
      }
    }
    const map: Record<string, CrateNode> = {}
    const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
    for (const item of graph) {
      const t = item['@type']
      const isDataset = t === 'Dataset' || (Array.isArray(t) && t.includes('Dataset'))
      const isFile = t === 'File' || (Array.isArray(t) && t.includes('File'))
      if (isDataset || isFile) {
        const id = item['@id']
        const name = item.title || item.name || ''
        const type = Array.isArray(t) ? t[0] : t
        const conforms = item['conformsTo']
        const conformsToUrls = conforms
          ? typeof conforms === 'string'
            ? [conforms]
            : conforms
          : undefined
        map[id] = { id, name, type, children: [], conformsToUrls }
      }
    }
    for (const item of graph) {
      const t = item['@type']
      const isDataset = t === 'Dataset' || (Array.isArray(t) && t.includes('Dataset'))
      if (isDataset && item.hasPart) {
        const parentId = item['@id']
        const parts = Array.isArray(item.hasPart) ? item.hasPart : [item.hasPart]
        const childIds = Array.from(
          new Set(
            parts
              .map((part: any) => (typeof part === 'string' ? part : part?.['@id']))
              .filter(Boolean),
          ),
        ) as string[]
        for (const childId of childIds) {
          if (map[childId] && map[parentId]) {
            map[parentId].children.push(map[childId])
          }
        }
      }
    }
    for (const node of Object.values(map)) {
      const seen = new Set<string>()
      node.children = node.children.filter((c) => {
        if (seen.has(c.id)) return false
        seen.add(c.id)
        return true
      })
      node.children.sort((a, b) => a.name.localeCompare(b.name))
    }
    const root = map['./']
    let selectedNodeId: string | undefined
    let expandedNodeIds: string[] = []
    let parents: string[] = []
    if (selectedEntity) {
      selectedNodeId = selectedEntity
      if (selectedEntity !== './') {
        parents = []
      }
    } else {
      selectedNodeId = ''
      expandedNodeIds = ['./']
    }
    return { root, selectedNodeId, expandedNodeIds, parents }
  }

  protected crateNodeToTreeData(
    node: CrateNode,
    parentKey?: string,
    seen?: Set<string>,
  ): TreeDataNode {
    const idStr = String(node.id).replace(/`/g, '').trim()
    const key = parentKey ? `${parentKey}::${idStr}` : idStr
    const visited = seen ?? new Set<string>()
    if (visited.has(idStr)) {
      return { key, title: node.name || node.id } as TreeDataNode
    }
    visited.add(idStr)
    const children =
      node.children?.map((c) => this.crateNodeToTreeData(c, key, visited)) || []
    return {
      key,
      title: node.name || node.id,
      entityId: node.id,
      children,
    } as TreeDataNode & { entityId: string }
  }

  protected handleTreeSelect = (_keys: React.Key[], info: any): void => {
    const entityId = info.node?.entityId
    if (!entityId) {
      return
    }

    this.appStateService.selectedEntityId = entityId
    void this.openRoCrateEditor(entityId)
  }

  protected async openRoCrateEditor(entityId: string): Promise<void> {
    const existingWidgetId = this.appStateService.getEntityEditorWidgetId(entityId)
    if (existingWidgetId) {
      const existing = this.widgetManager.tryGetWidget(existingWidgetId)
      if (existing) {
        await this.shell.activateWidget(existing.id)
        return
      }
    }
    const widget = await this.widgetManager.getOrCreateWidget(RoCrateEditorWidget.ID, {
      instance: entityId,
    })
    this.shell.addWidget(widget, { area: 'main' })
    this.shell.activateWidget(widget.id)
  }

  render(): React.ReactNode {
    const crateToUse = this.appStateService.roCrate
    const { root } = this.buildCrateTree(crateToUse)
    const treeData = root ? [this.crateNodeToTreeData(root)] : []
    console.log('treeData', treeData)
    if (this.expandedKeys.length === 0 && treeData.length) {
      const rootKey = treeData[0].key as string
      this.expandedKeys = [rootKey]
    }
    return (
      <div style={{ padding: '1rem' }}>
        <Tree
          treeData={treeData}
          height={500}
          showIcon
          defaultExpandedKeys={['./']}
          onSelect={this.handleTreeSelect}
          // expandedKeys={this.expandedKeys}
          // onExpand={(keys) => { this.expandedKeys = keys as string[]; this.update(); }}
          titleRender={(item) => {
            const title = item.title as React.ReactNode
            const isFolder = Array.isArray(item.children) && item.children.length > 0
            const isExpanded = this.expandedKeys.includes(item.key as string)
            const icon = isFolder ? (
              isExpanded ? (
                <FolderOpenOutlined />
              ) : (
                <FolderOutlined />
              )
            ) : (
              <FileOutlined />
            )
            return (
              <this.MemoTooltip title={title}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {icon}
                  {title}
                </span>
              </this.MemoTooltip>
            )
          }}
        />
      </div>
    )
  }

  dispose(): void {
    super.dispose()
    this.crateSubscription?.dispose()
  }
}
