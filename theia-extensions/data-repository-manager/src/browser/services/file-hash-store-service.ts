import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { URI } from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { inject, injectable } from 'inversify'

export const FILE_HASH_STORE_NAME = 'file-hashes.json'

export interface StoredFileHash {
  md5: string
  /** When the server response containing this hash was received. */
  hashUpdatedAt: string
  /** Local file metadata captured for the exact bytes sent to the server. */
  sourceLastModifiedAt: string
  sourceSize: number
}

interface FileHashStore {
  files: Record<string, StoredFileHash>
}

export interface FileHashComparison {
  localLastModified: number | undefined
  localSize: number | undefined
  remoteMd5?: string
  remoteSize?: number
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
    sourceSize: number | undefined,
    response: unknown,
  ): Promise<boolean> {
    const md5 = this.extractMd5(response)
    if (
      !md5 ||
      lastModified === undefined ||
      !Number.isFinite(lastModified) ||
      sourceSize === undefined ||
      !Number.isFinite(sourceSize)
    ) {
      return false
    }
    const store = await this.read(rootUri)
    store.files[localFileId] = {
      md5,
      hashUpdatedAt: new Date().toISOString(),
      sourceLastModifiedAt: new Date(lastModified).toISOString(),
      sourceSize,
    }
    await this.write(rootUri, store)
    return true
  }

  /**
   * Returns true only when the local and remote file still match the snapshot
   * captured after a successful upload. Unknown or incomplete state is treated
   * conservatively as changed.
   */
  public async isFileUnchanged(
    rootUri: URI,
    localFileId: string,
    comparison: FileHashComparison,
  ): Promise<boolean> {
    const stored = (await this.read(rootUri)).files[localFileId]
    return this.isFileRecordUnchanged(stored, comparison)
  }

  public async readFileHashes(rootUri: URI): Promise<Readonly<Record<string, StoredFileHash>>> {
    return (await this.read(rootUri)).files
  }

  public isFileRecordUnchanged(
    stored: StoredFileHash | undefined,
    comparison: FileHashComparison,
  ): boolean {
    const localLastModified = comparison.localLastModified
    const localSize = comparison.localSize
    if (
      !stored ||
      localLastModified === undefined ||
      !Number.isFinite(localLastModified) ||
      localSize === undefined ||
      !Number.isFinite(localSize)
    ) {
      return false
    }
    const remoteMd5 = this.normalizeMd5(comparison.remoteMd5)
    if (!remoteMd5 || remoteMd5 !== stored.md5) {
      return false
    }
    if (
      comparison.remoteSize !== undefined &&
      Number.isFinite(comparison.remoteSize) &&
      comparison.remoteSize !== localSize
    ) {
      return false
    }
    if (stored.sourceSize !== undefined && stored.sourceSize !== localSize) {
      return false
    }
    // ISO timestamps have millisecond precision; normalize filesystem values
    // before comparing in case a provider reports fractional milliseconds.
    return Date.parse(stored.sourceLastModifiedAt) === Math.trunc(localLastModified)
  }

  protected async read(rootUri: URI): Promise<FileHashStore> {
    const uri = rootUri.resolve('.rockit').resolve(FILE_HASH_STORE_NAME)
    if (!(await this.fileService.exists(uri))) {
      return { files: {} }
    }
    try {
      const parsed = JSON.parse(
        (await this.fileService.readFile(uri)).value.toString(),
      ) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { files: {} }
      }
      const files = (parsed as Record<string, unknown>).files
      if (!files || typeof files !== 'object' || Array.isArray(files)) {
        return { files: {} }
      }
      const normalized: Record<string, StoredFileHash> = {}
      for (const [id, value] of Object.entries(files)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          continue
        }
        const record = value as Record<string, unknown>
        const md5 = this.normalizeMd5(record.md5)
        const sourceLastModifiedAt =
          typeof record.sourceLastModifiedAt === 'string'
            ? record.sourceLastModifiedAt
            : ''
        const hashUpdatedAt =
          typeof record.hashUpdatedAt === 'string' &&
          !Number.isNaN(Date.parse(record.hashUpdatedAt))
            ? record.hashUpdatedAt
            : undefined
        const sourceSize =
          typeof record.sourceSize === 'number' && Number.isFinite(record.sourceSize)
            ? record.sourceSize
            : undefined
        if (
          md5 &&
          hashUpdatedAt &&
          !Number.isNaN(Date.parse(sourceLastModifiedAt)) &&
          sourceSize !== undefined
        ) {
          normalized[id] = {
            md5,
            hashUpdatedAt,
            sourceLastModifiedAt,
            sourceSize,
          }
        }
      }
      return { files: normalized }
    } catch (error) {
      console.warn(
        `Failed to parse .rockit/${FILE_HASH_STORE_NAME}; starting a new hash store.`,
        error,
      )
      return { files: {} }
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
        `${JSON.stringify({ files: sortedFiles }, null, 2)}\n`,
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
