import { Disposable, Emitter, Event } from '@theia/core/lib/common'
import { injectable } from '@theia/core/shared/inversify'

export interface LoadMaskProgress {
  worked: number
  total: number
}

export interface LoadMaskOptions {
  message?: string
  progress?: LoadMaskProgress
  /** Delay before showing the overlay. Use zero for operations known to be long-running. */
  delay?: number
  onCancel?: () => void | Promise<void>
}

export interface LoadMaskUpdate {
  message?: string
  progress?: LoadMaskProgress
  onCancel?: (() => void | Promise<void>) | null
}

export interface LoadMaskHandle extends Disposable {
  update(update: LoadMaskUpdate): void
}

export interface LoadMaskState {
  visible: boolean
  activeCount: number
  message: string
  progress?: LoadMaskProgress
  cancellable: boolean
  cancelRequested: boolean
}

interface LoadMaskOperation extends LoadMaskOptions {
  id: number
  cancelRequested: boolean
}

const DEFAULT_DELAY_MS = 250
const DEFAULT_MESSAGE = 'Working…'

@injectable()
export class LoadMaskService {
  protected readonly operations = new Map<number, LoadMaskOperation>()
  protected readonly onDidChangeEmitter = new Emitter<LoadMaskState>()
  protected nextId = 0
  protected visible = false
  protected showTimer?: ReturnType<typeof setTimeout>

  readonly onDidChange: Event<LoadMaskState> = this.onDidChangeEmitter.event

  get state(): LoadMaskState {
    const operations = Array.from(this.operations.values())
    const current = operations[operations.length - 1]
    return {
      visible: this.visible && this.operations.size > 0,
      activeCount: this.operations.size,
      message: current?.message?.trim() || DEFAULT_MESSAGE,
      progress: this.normalizeProgress(current?.progress),
      cancellable: typeof current?.onCancel === 'function',
      cancelRequested: current?.cancelRequested ?? false,
    }
  }

  show(options: LoadMaskOptions = {}): LoadMaskHandle {
    const operation: LoadMaskOperation = {
      ...options,
      id: ++this.nextId,
      cancelRequested: false,
    }
    const wasEmpty = this.operations.size === 0
    this.operations.set(operation.id, operation)

    const delay = Math.max(0, options.delay ?? DEFAULT_DELAY_MS)
    if (wasEmpty) {
      if (delay === 0) {
        this.visible = true
      } else {
        this.showTimer = setTimeout(() => {
          this.showTimer = undefined
          if (this.operations.size > 0) {
            this.visible = true
            this.fireDidChange()
          }
        }, delay)
      }
    } else if (!this.visible && delay === 0) {
      this.clearShowTimer()
      this.visible = true
    }
    this.fireDidChange()

    let disposed = false
    return {
      update: (update) => {
        if (disposed || !this.operations.has(operation.id)) {
          return
        }
        if (update.message !== undefined) {
          operation.message = update.message
        }
        if (update.progress !== undefined) {
          operation.progress = update.progress
        }
        if (update.onCancel !== undefined) {
          operation.onCancel = update.onCancel ?? undefined
          operation.cancelRequested = false
        }
        this.fireDidChange()
      },
      dispose: () => {
        if (disposed) {
          return
        }
        disposed = true
        this.operations.delete(operation.id)
        if (this.operations.size === 0) {
          this.clearShowTimer()
          this.visible = false
        }
        this.fireDidChange()
      },
    }
  }

  async run<T>(options: LoadMaskOptions, operation: () => Promise<T>): Promise<T> {
    const handle = this.show(options)
    try {
      return await operation()
    } finally {
      handle.dispose()
    }
  }

  async cancelCurrent(): Promise<void> {
    const operations = Array.from(this.operations.values())
    const current = operations[operations.length - 1]
    if (!current?.onCancel || current.cancelRequested) {
      return
    }
    current.cancelRequested = true
    this.fireDidChange()
    try {
      await current.onCancel()
    } catch (error) {
      console.warn('RocKIT: failed to cancel load-masked operation', error)
      current.cancelRequested = false
      this.fireDidChange()
    }
  }

  protected normalizeProgress(progress?: LoadMaskProgress): LoadMaskProgress | undefined {
    if (
      !progress ||
      !Number.isFinite(progress.worked) ||
      !Number.isFinite(progress.total) ||
      progress.total <= 0
    ) {
      return undefined
    }
    return {
      worked: Math.min(Math.max(0, progress.worked), progress.total),
      total: progress.total,
    }
  }

  protected clearShowTimer(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer)
      this.showTimer = undefined
    }
  }

  protected fireDidChange(): void {
    this.onDidChangeEmitter.fire(this.state)
  }
}
