import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import type { URI } from '@theia/core/lib/common/uri'
import { injectable } from '@theia/core/shared/inversify'
import type { FileService } from '@theia/filesystem/lib/browser/file-service'
import type { WorkspaceService } from '@theia/workspace/lib/browser'
import * as mime from 'mime-types'
import type * as React from 'react'
import { RoCrateHtmlGenerator } from '../common/generator-protocol'
import SparkMD5 from 'spark-md5'

@injectable()
export class ROCrateDialog extends ReactDialog<string> {
  constructor(
    protected readonly workspaceService: WorkspaceService,
    protected readonly fileService: FileService,
    protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator,
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

    if (fileStat.isDirectory) {
      const dirRelativePath = await this.workspaceService.getWorkspaceRelativePath(dirUri)
      const dirEntity = {
        '@id': dirRelativePath.endsWith('/') ? dirRelativePath : `${dirRelativePath}/`,
        '@type': 'Dataset',
        name: fileStat.name,
        hasPart: [] as { '@id': string }[],
      }
      graph.push(dirEntity)
      parentHasPart.push({ '@id': dirEntity['@id'] })

      for (const child of fileStat.children || []) {
        await this.scanAndBuildEntities(child.resource, rootUri, graph, dirEntity.hasPart)
      }
    } else {
      const fileRelativePath =
        await this.workspaceService.getWorkspaceRelativePath(dirUri)
      const content = await this.fileService.read(dirUri)

      const mimeType = mime.lookup(fileStat.name) || 'application/octet-stream'

      const fileEntity = {
        '@id': fileRelativePath,
        '@type': 'File',
        name: fileStat.name,
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
      name: rootUri.path.base,
      description: `RO-Crate for the workspace: ${rootUri.path.base}`,
      datePublished: new Date().toISOString(),
      hasPart: rootHasPart,
    }
    graph.push(rootDataset)

    const metadataDescriptor = {
      '@id': 'ro-crate-metadata.json',
      '@type': 'CreativeWork',
      conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
      about: { '@id': './' },
    }
    graph.push(metadataDescriptor)

    const rootStat = await this.fileService.resolve(rootUri, { resolveMetadata: true })
    if (rootStat.children) {
      for (const child of rootStat.children) {
        if (child.name === 'ro-crate-metadata.json' || child.name.startsWith('.')) {
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
    const previewUri = rootUri.resolve('ro-crate-preview.html')

    await this.fileService.create(metadataUri, JSON.stringify(roCrate, null, 2), {
      overwrite: true,
    })

    const htmlContent = this.roCrateHtmlGenerator.generate(roCrate)
    await this.fileService.create(previewUri, htmlContent, { overwrite: true })
  }
}
