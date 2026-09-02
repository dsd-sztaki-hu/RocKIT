import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { URI } from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { inject, injectable } from 'inversify'

export const FILE_HASH_STORE_NAME = 'file-hashes.json'

export interface StoredFileHash {
  md5: string
  lastModified: string
}

interface FileHashStore {
  version: 1
  files: Record<string, StoredFileHash>
}

@injectable()
export class FileHashStoreService {
  constructor(@inject(FileService) protected readonly fileService: FileService) {}

  public extractMd5(response: unknown): string | undefined {
    return this.extractMd5FromValue(response, false, new Set<object>())
  }

  public async recordUploadResponse(
    rootUri: URI,
    localFileId: string,
    lastModified: number | undefined,
    response: unknown,
  ): Promise<boolean> {
    const md5 = this.extractMd5(response)
    if (!md5 || lastModified === undefined || !Number.isFinite(lastModified)) {
      return false
    }
    const store = await this.read(rootUri)
    store.files[localFileId] = {
      md5,
      lastModified: new Date(lastModified).toISOString(),
    }
    await this.write(rootUri, store)
    return true
  }

  protected async read(rootUri: URI): Promise<FileHashStore> {
    const uri = rootUri.resolve('.rockit').resolve(FILE_HASH_STORE_NAME)
    if (!(await this.fileService.exists(uri))) {
      return { version: 1, files: {} }
    }
    try {
      const parsed = JSON.parse(
        (await this.fileService.readFile(uri)).value.toString(),
      ) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { version: 1, files: {} }
      }
      const files = (parsed as Record<string, unknown>).files
      if (!files || typeof files !== 'object' || Array.isArray(files)) {
        return { version: 1, files: {} }
      }
      const normalized: Record<string, StoredFileHash> = {}
      for (const [id, value] of Object.entries(files)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          continue
        }
        const record = value as Record<string, unknown>
        const md5 = this.normalizeMd5(record.md5)
        const lastModified =
          typeof record.lastModified === 'string' ? record.lastModified : ''
        if (md5 && !Number.isNaN(Date.parse(lastModified))) {
          normalized[id] = { md5, lastModified }
        }
      }
      return { version: 1, files: normalized }
    } catch (error) {
      console.warn(
        `Failed to parse .rockit/${FILE_HASH_STORE_NAME}; starting a new hash store.`,
        error,
      )
      return { version: 1, files: {} }
    }
  }

  protected async write(rootUri: URI, store: FileHashStore): Promise<void> {
    const rockitUri = rootUri.resolve('.rockit')
    if (!(await this.fileService.exists(rockitUri))) {
      await this.fileService.createFolder(rockitUri)
    }
    const sortedFiles = Object.fromEntries(
      Object.entries(store.files).sort(([left], [right]) => left.localeCompare(right)),
    )
    await this.fileService.writeFile(
      rockitUri.resolve(FILE_HASH_STORE_NAME),
      BinaryBuffer.fromString(
        `${JSON.stringify({ version: 1, files: sortedFiles }, null, 2)}\n`,
      ),
    )
  }

  protected extractMd5FromValue(
    value: unknown,
    md5Context: boolean,
    visited: Set<object>,
  ): string | undefined {
    if (typeof value === 'string') {
      return md5Context ? this.normalizeMd5(value) : undefined
    }
    if (!value || typeof value !== 'object') {
      return undefined
    }
    if (visited.has(value)) {
      return undefined
    }
    visited.add(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = this.extractMd5FromValue(item, md5Context, visited)
        if (result) {
          return result
        }
      }
      return undefined
    }

    const record = value as Record<string, unknown>
    const algorithm = this.optionalString(record.type ?? record.algorithm)?.toLowerCase()
    if (algorithm === 'md5') {
      const direct = this.normalizeMd5(record.value ?? record.hash ?? record.checksum)
      if (direct) {
        return direct
      }
    }
    for (const [key, child] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase()
      const childIsMd5 =
        normalizedKey === 'md5' ||
        normalizedKey === 'hash' ||
        normalizedKey === 'checksum'
      if (typeof child === 'string' && childIsMd5) {
        const result = this.normalizeMd5(child)
        if (result) {
          return result
        }
      }
      const result = this.extractMd5FromValue(child, md5Context || childIsMd5, visited)
      if (result) {
        return result
      }
    }
    return undefined
  }

  protected normalizeMd5(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }
    const normalized = value.trim().replace(/^md5:/i, '').toLowerCase()
    return /^[a-f0-9]{32}$/.test(normalized) ? normalized : undefined
  }

  protected optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
}
