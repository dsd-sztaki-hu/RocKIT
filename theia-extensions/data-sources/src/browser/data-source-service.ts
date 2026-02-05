import { Emitter, Event } from '@theia/core/lib/common/event'
import { StorageService } from '@theia/core/lib/browser/storage-service'
import URI from '@theia/core/lib/common/uri'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'

const STORAGE_KEY = 'aroma:data-sources'

@injectable()
export class DataSourceService {
  @inject(StorageService)
  protected readonly storageService: StorageService

  protected readonly onDidChangeEmitter = new Emitter<void>()
  readonly onDidChange: Event<void> = this.onDidChangeEmitter.event

  protected sources: URI[] = []
  protected readyPromise: Promise<void> = Promise.resolve()

  @postConstruct()
  protected init(): void {
    this.readyPromise = this.load()
  }

  get ready(): Promise<void> {
    return this.readyPromise
  }

  getAll(): readonly URI[] {
    return this.sources
  }

  async add(uri: URI): Promise<void> {
    await this.readyPromise
    const normalized = uri.toString()
    if (this.sources.some((existing) => existing.toString() === normalized)) {
      return
    }
    this.sources = [...this.sources, uri]
    await this.persist()
    this.onDidChangeEmitter.fire()
  }

  async remove(uri: URI): Promise<void> {
    await this.readyPromise
    const normalized = uri.toString()
    const next = this.sources.filter((existing) => existing.toString() !== normalized)
    if (next.length === this.sources.length) {
      return
    }
    this.sources = next
    await this.persist()
    this.onDidChangeEmitter.fire()
  }

  protected async load(): Promise<void> {
    const stored = await this.storageService.getData<string[]>(STORAGE_KEY)
    this.sources = (stored ?? []).map((value) => new URI(value))
  }

  protected async persist(): Promise<void> {
    await this.storageService.setData(
      STORAGE_KEY,
      this.sources.map((value) => value.toString()),
    )
  }
}
