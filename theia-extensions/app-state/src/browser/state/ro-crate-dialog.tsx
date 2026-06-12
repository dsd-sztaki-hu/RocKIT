import { CommandService } from '@theia/core/lib/common/command'
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import type { URI } from '@theia/core/lib/common/uri'
import { injectable } from '@theia/core/shared/inversify'
import type { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceCommands } from '@theia/workspace/lib/browser'
import type { WorkspaceService } from '@theia/workspace/lib/browser'
import {
  createDefaultRoCrateWorkspace,
  RoCrateHtmlGenerator,
  type DefaultRoCrateFileContent,
  type DefaultRoCrateWorkspaceAdapter,
} from 'aroma2-common/lib/browser'
import type * as React from 'react'
import SparkMD5 from 'spark-md5'
import { Message } from '@lumino/messaging'

@injectable()
export class ROCrateDialog extends ReactDialog<string> {
  protected closeRoCrateButton?: HTMLButtonElement

  constructor(
    protected readonly workspaceService: WorkspaceService,
    protected readonly fileService: FileService,
    protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator,
    protected readonly commandService: CommandService,
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
    this.closeRoCrateButton = this.appendButton('Close RO-Crate', false)
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
    await this.commandService.executeCommand(WorkspaceCommands.CLOSE.id)
    super.close()
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    if (this.closeRoCrateButton) {
      this.addAction(this.closeRoCrateButton, () => {
        void this.dismiss()
      }, 'click')
    }
  }

  protected async createDefaultCrate(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots()
    if (!roots || roots.length === 0) {
      throw new Error('No workspace is open.')
    }

    const rootUri = roots[0].resource
    const result = await createDefaultRoCrateWorkspace(
      this.createWorkspaceAdapter(rootUri),
    )
    const roCrate = result.crate

    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    const previewUri = rootUri.resolve('ro-crate-preview.html')
    if (result.ignoredFile) {
      const aromaUri = rootUri.resolve(result.ignoredFile.directoryPath)
      if (!(await this.fileService.exists(aromaUri))) {
        await this.fileService.createFolder(aromaUri)
      }
      await this.fileService.create(
        rootUri.resolve(result.ignoredFile.filePath),
        result.ignoredFile.payload,
        { overwrite: true },
      )
    }

    await this.fileService.create(metadataUri, JSON.stringify(roCrate, null, 2), {
      overwrite: true,
    })

    const htmlContent = this.roCrateHtmlGenerator.generate(roCrate)
    await this.fileService.create(previewUri, htmlContent, { overwrite: true })
  }

  protected createWorkspaceAdapter(rootUri: URI): DefaultRoCrateWorkspaceAdapter {
    const resolveRelative = (relativePath: string): URI =>
      relativePath ? rootUri.resolve(relativePath) : rootUri

    const relativePathFor = async (uri: URI): Promise<string> =>
      (await this.workspaceService.getWorkspaceRelativePath(uri)) ?? ''

    return {
      rootName: rootUri.path.base,
      listChildren: async (relativeDirectoryPath: string) => {
        const directoryUri = resolveRelative(relativeDirectoryPath)
        const fileStat = await this.fileService.resolve(directoryUri, {
          resolveMetadata: true,
        })
        const children = fileStat.children ?? []
        return Promise.all(
          children.map(async (child) => ({
            name: child.name,
            relativePath: await relativePathFor(child.resource),
            kind: child.isDirectory ? 'directory' as const : 'file' as const,
            size: child.size,
            mtimeMs: child.mtime,
          })),
        )
      },
      readFileContent: async (relativeFilePath: string) => {
        const content = await this.fileService.read(resolveRelative(relativeFilePath))
        return `${content.value ?? ''}`
      },
      hashContent: (content: DefaultRoCrateFileContent) =>
        SparkMD5.hash(typeof content === 'string' ? content : String.fromCharCode(...content)),
      readTextFile: async (relativeFilePath: string) => {
        try {
          const uri = resolveRelative(relativeFilePath)
          if (!(await this.fileService.exists(uri))) {
            return undefined
          }
          const content = await this.fileService.read(uri)
          return `${content.value ?? ''}`
        } catch {
          return undefined
        }
      },
    }
  }
}
