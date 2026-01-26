import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import type { URI } from '@theia/core/lib/common/uri'
import { injectable } from '@theia/core/shared/inversify'
import type { FileService } from '@theia/filesystem/lib/browser/file-service'
import type { WorkspaceService } from '@theia/workspace/lib/browser'
import * as mime from 'mime-types'
import type * as React from 'react'
import SparkMD5 from 'spark-md5'

@injectable()
export class ROCrateDialog extends ReactDialog<string> {
  constructor(
    protected readonly workspaceService: WorkspaceService,
    protected readonly fileService: FileService,
    protected readonly jsonExists: boolean = true,
  ) {
    super({
      title: jsonExists
        ? 'Invalid ro-crate-metadata.json'
        : 'ro-crate-metadata.json Not Found',
    })
    this.title.closable = false
    this.appendAcceptButton(
      this.jsonExists ? 'Generate valid JSON file' : 'Generate JSON file',
    )
    this.appendCloseButton('Close Workspace')
  }

  get value(): string {
    return ''
  }

  protected render(): React.ReactNode {
    return (
      <div style={{ padding: '20px', maxWidth: '450px' }}>
        <div
          style={{
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <i
            className="fa fa-exclamation-triangle"
            style={{ color: '#d9534f', fontSize: '24px' }}
          ></i>
          <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
            {this.jsonExists ? 'Critical Parsing Error' : 'File Not Found'}
          </span>
        </div>

        <p>
          {this.jsonExists ? (
            <>
              The <code>ro-crate-metadata.json</code> file is invalid or cannot be parsed.
            </>
          ) : (
            <>
              No <code>ro-crate-metadata.json</code> was found in this workspace.
            </>
          )}
        </p>
        <p style={{ fontSize: '0.9em', color: '#888' }}>
          Would you like to generate a new default metadata file based on the current
          workspace files?
        </p>
      </div>
    )
  }

  protected async accept(): Promise<void> {
    try {
      await this.createDefaultCrate()
      await super.accept()
    } catch (err) {
      console.error('Failed to generate RO-Crate:', err)
    }
  }

  protected async dismiss(): Promise<void> {
    await this.workspaceService.close()
    super.close()
  }

  private async scanAndBuildEntities(
    dirUri: URI,
    rootUri: URI,
    graph: any[],
    parentHasPart: { '@id': string }[],
  ): Promise<void> {
    const fileStat = await this.fileService.resolve(dirUri, { resolveMetadata: true })
    const relativePath =
      (await this.workspaceService.getWorkspaceRelativePath(dirUri)) ?? ''
    const { directoryLabel, name } = this.splitDirectoryInfo(relativePath)
    if (!name) {
      return
    }

    if (fileStat.isDirectory) {
      const entityId = this.buildEntityId(directoryLabel, name, true)
      if (!entityId) {
        return
      }
      const dirEntity = {
        '@id': entityId,
        '@type': 'Dataset',
        name: fileStat.name,
        directoryLabel,
        hasPart: [] as { '@id': string }[],
      }
      graph.push(dirEntity)
      parentHasPart.push({ '@id': dirEntity['@id'] })

      for (const child of fileStat.children || []) {
        await this.scanAndBuildEntities(child.resource, rootUri, graph, dirEntity.hasPart)
      }
    } else {
      const content = await this.fileService.read(dirUri)
      const mimeType = mime.lookup(fileStat.name) || 'application/octet-stream'
      const entityId = this.buildEntityId(directoryLabel, name, false)
      if (!entityId) {
        return
      }
      const fileEntity = {
        '@id': entityId,
        '@type': 'File',
        name: fileStat.name,
        directoryLabel,
        encodingFormat: mimeType,
        contentSize: fileStat.size ? `${fileStat.size}` : undefined,
        dateModified: fileStat.mtime ? new Date(fileStat.mtime).toISOString() : undefined,
        hash: SparkMD5.hash(content.value),
      }
      graph.push(fileEntity)
      parentHasPart.push({ '@id': fileEntity['@id'] })
    }
  }

  protected async createDefaultCrate(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots()
    if (!roots || roots.length === 0) {
      throw new Error('No workspace is open.')
    }

    const rootUri = roots[0].resource
    const graph: any[] = []
    const rootHasPart: { '@id': string }[] = []

    const rootDataset = {
      '@id': './',
      '@type': 'Dataset',
      name: './',
      description: `RO-Crate for the workspace: ${rootUri.path.base}`,
      datePublished: new Date().toISOString(),
      hasPart: rootHasPart,
    }
    graph.push(rootDataset)

    const metadataDescriptor = {
      '@id': this.buildEntityId('', 'ro-crate-metadata.json', false),
      '@type': 'CreativeWork',
      conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
      about: { '@id': './' },
      directoryLabel: '',
      name: 'ro-crate-metadata.json',
    }
    graph.push(metadataDescriptor)

    const rootStat = await this.fileService.resolve(rootUri, { resolveMetadata: true })
    if (rootStat.children) {
      for (const child of rootStat.children) {
        if (
          child.name === 'ro-crate-metadata.json' ||
          child.name === 'ro-crate-preview.html' ||
          child.name.startsWith('.')
        ) {
          continue
        }
        await this.scanAndBuildEntities(child.resource, rootUri, graph, rootHasPart)
      }
    }

    const roCrate = {
      '@context': 'https://w3id.org/ro/crate/1.1/context',
      '@graph': graph,
    }

    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    await this.fileService.create(metadataUri, JSON.stringify(roCrate, null, 2), {
      overwrite: true,
    })
  }

  private splitDirectoryInfo(relativePath: string): { directoryLabel: string; name: string } {
    const normalized = this.normalizeRelativePathForId(relativePath)
    if (!normalized) {
      return { directoryLabel: '', name: '' }
    }
    const lastSlashIndex = normalized.lastIndexOf('/')
    if (lastSlashIndex === -1) {
      return { directoryLabel: '', name: normalized }
    }
    return {
      directoryLabel: normalized.slice(0, lastSlashIndex + 1),
      name: normalized.slice(lastSlashIndex + 1),
    }
  }

  private buildEntityId(directoryLabel: string, name: string, isDirectory: boolean): string | undefined {
    if (!name) {
      return undefined
    }
    let combined = `${directoryLabel}${name}`
    combined = this.normalizeRelativePathForId(combined)
    if (!combined) {
      return undefined
    }
    if (isDirectory && !combined.endsWith('/')) {
      combined = `${combined}/`
    }
    return `file://./${combined}`
  }

  private normalizeRelativePathForId(path: string): string {
    let normalized = (path || '').replace(/\\/g, '/').trim()
    normalized = normalized.replace(/^\.\//, '')
    normalized = normalized.replace(/^\/+/, '')
    normalized = normalized.replace(/\/{2,}/g, '/')
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  }
}
