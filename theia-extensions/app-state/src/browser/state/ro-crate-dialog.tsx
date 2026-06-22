import { CommandService } from '@theia/core/lib/common/command'
import { MessageService } from '@theia/core/lib/common/message-service'
import { DialogError } from '@theia/core/lib/browser/dialogs'
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
  writeUtf8TextFile,
} from 'rockit-common/lib/browser'
import type * as React from 'react'
import SparkMD5 from 'spark-md5'
import { Message } from '@lumino/messaging'

@injectable()
export class ROCrateDialog extends ReactDialog<string> {
  protected closeRoCrateButton?: HTMLButtonElement
  protected generating = false
  protected scannedFileCount = 0

  constructor(
    protected readonly workspaceService: WorkspaceService,
    protected readonly fileService: FileService,
    protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator,
    protected readonly commandService: CommandService,
    protected readonly messageService: MessageService,
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
    if (this.generating) {
      return
    }

    this.generating = true
    this.scannedFileCount = 0
    this.setGenerationControls(true)
    this.setErrorMessage('')

    try {
      await this.createDefaultCrate()
      await super.accept()
    } catch (err) {
      console.error('Failed to generate RO-Crate:', err)
      this.setErrorMessage(
        `Could not generate a new RO-Crate: ${this.getErrorMessage(err)}`,
      )
      if (this.acceptButton) {
        this.acceptButton.disabled = false
      }
    } finally {
      this.generating = false
      this.setGenerationControls(false)
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
      const rockitUri = rootUri.resolve(result.ignoredFile.directoryPath)
      if (!(await this.fileService.exists(rockitUri))) {
        await this.fileService.createFolder(rockitUri)
      }
      await this.fileService.create(
        rootUri.resolve(result.ignoredFile.filePath),
        result.ignoredFile.payload,
        { overwrite: true },
      )
    }

    await writeUtf8TextFile(this.fileService, metadataUri, JSON.stringify(roCrate, null, 2))

    try {
      const htmlContent = this.roCrateHtmlGenerator.generate(roCrate)
      await writeUtf8TextFile(this.fileService, previewUri, htmlContent)
    } catch (error) {
      console.warn('Failed to generate RO-Crate preview:', error)
      this.messageService.warn(
        'The new RO-Crate metadata was created successfully, but the HTML preview could not be generated because the crate is too large.',
      )
    }
  }

  protected setGenerationControls(generating: boolean): void {
    if (this.acceptButton) {
      // Keep the primary-button appearance while making the running action inert.
      // Native `disabled` styling reduces contrast too much for the progress text.
      this.acceptButton.disabled = false
      this.acceptButton.setAttribute('aria-busy', `${generating}`)
      this.acceptButton.setAttribute('aria-disabled', `${generating}`)
      this.acceptButton.style.pointerEvents = generating ? 'none' : ''
      this.acceptButton.tabIndex = generating ? -1 : 0
      if (generating) {
        this.acceptButton.blur()
        this.updateGenerationProgress()
      } else {
        this.acceptButton.textContent = this.jsonExists
          ? 'Generate valid JSON file'
          : 'Generate JSON file'
      }
    }
    if (this.closeRoCrateButton) {
      this.closeRoCrateButton.disabled = generating
    }
  }

  protected updateGenerationProgress(): void {
    if (this.acceptButton) {
      const fileLabel = this.scannedFileCount === 1 ? 'file' : 'files'
      this.acceptButton.textContent =
        `Generating metadata... ${this.scannedFileCount.toLocaleString()} ${fileLabel} processed`
    }
  }

  protected override setErrorMessage(error: DialogError): void {
    super.setErrorMessage(error)
    if (this.generating && this.acceptButton) {
      // Validation normally owns the native disabled state. Interaction is
      // blocked by the inert running state instead, preserving button contrast.
      this.acceptButton.disabled = false
    }
  }

  protected hashFileContent(content: Uint8Array): string {
    const arrayBuffer = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer
    return SparkMD5.ArrayBuffer.hash(arrayBuffer)
  }

  protected getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message
    }
    return String(error)
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
      hashContent: (content: DefaultRoCrateFileContent) => {
        const hash = typeof content === 'string'
          ? SparkMD5.hash(content)
          : this.hashFileContent(content)
        this.scannedFileCount += 1
        this.updateGenerationProgress()
        return hash
      },
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
