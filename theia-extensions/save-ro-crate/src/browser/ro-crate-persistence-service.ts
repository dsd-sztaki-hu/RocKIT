import URI from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import {
  RoCrateHtmlGenerator,
  writeJsonObjectFile,
  writeUtf8TextFile,
} from 'rockit-common/lib/browser'
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service'

const FULL_PREVIEW_ENTITY_LIMIT = 5_000

export interface RoCratePersistenceResult {
  previewLimited: boolean
}

@injectable()
export class RoCratePersistenceService {
  @inject(FileService)
  protected readonly fileService: FileService

  @inject(RoCrateHtmlGenerator)
  protected readonly htmlGenerator: RoCrateHtmlGenerator

  @inject(LoadMaskService)
  protected readonly loadMaskService: LoadMaskService

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  async write(
    rootUri: URI,
    crate: Record<string, unknown>,
  ): Promise<RoCratePersistenceResult> {
    if (this.activeWrite) {
      return this.activeWrite
    }
    this.activeWrite = this.doWrite(rootUri, crate)
    try {
      return await this.activeWrite
    } finally {
      this.activeWrite = undefined
    }
  }

  protected activeWrite?: Promise<RoCratePersistenceResult>

  protected async doWrite(
    rootUri: URI,
    crate: Record<string, unknown>,
  ): Promise<RoCratePersistenceResult> {
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const isLarge = graph.length > FULL_PREVIEW_ENTITY_LIMIT
    const loadMask = this.loadMaskService.show({
      message: 'Saving RO-Crate...',
      delay: isLarge ? 0 : undefined,
    })
    this.appStateService.beginRoCrateSave()

    try {
      if (isLarge) {
        await this.waitForLoadMaskPaint()
      }

      const metadataUri = rootUri.resolve('ro-crate-metadata.json')
      await writeJsonObjectFile(this.fileService, metadataUri, crate, (worked, total) => {
        loadMask.update({
          message: 'Saving RO-Crate metadata...',
          progress: { worked, total },
        })
      })

      loadMask.update({ message: 'Saving RO-Crate preview...' })
      const previewUri = rootUri.resolve('ro-crate-preview.html')
      const preview = isLarge
        ? this.createLimitedPreview(graph.length)
        : this.htmlGenerator.generate(crate)
      await writeUtf8TextFile(this.fileService, previewUri, preview)

      this.appStateService.markRoCrateSaved(crate)

      return { previewLimited: isLarge }
    } finally {
      this.appStateService.endRoCrateSave()
      loadMask.dispose()
    }
  }

  protected createLimitedPreview(entityCount: number): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>RO-Crate Preview</title></head>
<body><h1>RO-Crate Preview</h1><p>This crate contains ${entityCount.toLocaleString()} entities.</p>
<p>The full HTML preview was not generated because the crate is too large. See <a href="ro-crate-metadata.json">ro-crate-metadata.json</a>.</p></body></html>\n`
  }

  protected async waitForLoadMaskPaint(): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) {
          return
        }
        settled = true
        resolve()
      }
      setTimeout(finish, 50)
      requestAnimationFrame(() => requestAnimationFrame(finish))
    })
  }
}
