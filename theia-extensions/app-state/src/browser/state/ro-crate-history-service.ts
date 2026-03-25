import { inject, injectable } from 'inversify'
import {
  applyPatch as applyRfc6902Patch,
  createPatch as createRfc6902Patch,
  type Operation,
} from 'rfc6902'
import { AppStateService } from './app-state-service'

/**
 * Options for applying and optionally tracking a RO-Crate change.
 */
export interface RoCrateChangeOptions {
  /**
   * Human-readable operation label for debug/history views.
   */
  label?: string
  /**
   * When false, applies state without writing undo/redo history.
   */
  trackHistory?: boolean
}

export type JsonPatchOperation = Operation
export type JsonPatch = JsonPatchOperation[]

/**
 * One undoable RO-Crate operation represented as forward and backward JSON Patch.
 */
export interface RoCratePatchOperation {
  /**
   * Discriminator for union narrowing.
   */
  kind: 'patch'
  /**
   * Label shown in debug output.
   */
  label: string
  /**
   * Patch to move state from before -> after.
   */
  forward: JsonPatch
  /**
   * Patch to move state from after -> before.
   */
  backward: JsonPatch
  /**
   * Timestamp in milliseconds since epoch.
   */
  timestamp: number
  /**
   * Approximate bytes of serialized forward patch.
   */
  forwardBytes: number
  /**
   * Approximate bytes of serialized backward patch.
   */
  backwardBytes: number
}

/**
 * Grouped operation for multi-edit or transactional changes.
 */
export interface RoCrateCompositeOperation {
  /**
   * Discriminator for union narrowing.
   */
  kind: 'composite'
  /**
   * Label for the grouped operation.
   */
  label: string
  /**
   * Child operations in execution order.
   */
  operations: RoCrateHistoryOperation[]
  /**
   * Timestamp in milliseconds since epoch.
   */
  timestamp: number
}

/**
 * Union of supported history operation shapes.
 */
export type RoCrateHistoryOperation = RoCratePatchOperation | RoCrateCompositeOperation

/**
 * Debug snapshot for the temporary history UI.
 */
export interface RoCrateHistoryDebugSnapshot {
  undoCount: number
  redoCount: number
  transactionDepth: number
  undoStackBytes: number
  redoStackBytes: number
  transactionStackBytes: number
  totalHistoryBytes: number
  undoPatchBytes: number
  redoPatchBytes: number
  totalPatchBytes: number
  undoStack: RoCrateHistoryOperation[]
  redoStack: RoCrateHistoryOperation[]
}

type TransactionContext = {
  label: string
  operations: RoCrateHistoryOperation[]
}

@injectable()
export class RoCrateHistoryService {
  /**
   * Maximum number of operations kept in each history stack.
   *
   * Oldest entries are dropped first when the limit is exceeded.
   */
  protected readonly maxHistoryEntries = 25

  protected undoStack: RoCrateHistoryOperation[] = []
  protected redoStack: RoCrateHistoryOperation[] = []
  protected readonly transactionStack: TransactionContext[] = []

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  getDebugSnapshot(maxOperations = 30): RoCrateHistoryDebugSnapshot {
    const limit = Math.max(maxOperations, 1)
    const undoStart = Math.max(this.undoStack.length - limit, 0)
    const redoStart = Math.max(this.redoStack.length - limit, 0)

    const undoStackBytes = this.estimateSerializedBytes(this.undoStack)
    const redoStackBytes = this.estimateSerializedBytes(this.redoStack)
    const transactionStackBytes = this.estimateSerializedBytes(this.transactionStack)

    const undoPatchBytes = this.sumPatchBytes(this.undoStack, 'forward')
    const redoPatchBytes = this.sumPatchBytes(this.redoStack, 'forward')
    const totalPatchBytes =
      this.sumPatchBytes(this.undoStack, 'both') +
      this.sumPatchBytes(this.redoStack, 'both')

    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      transactionDepth: this.transactionStack.length,
      undoStackBytes,
      redoStackBytes,
      transactionStackBytes,
      totalHistoryBytes: undoStackBytes + redoStackBytes + transactionStackBytes,
      undoPatchBytes,
      redoPatchBytes,
      totalPatchBytes,
      undoStack: this.cloneValue(this.undoStack.slice(undoStart)),
      redoStack: this.cloneValue(this.redoStack.slice(redoStart)),
    }
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.transactionStack.length = 0
  }

  applyRoCrateChange(
    nextCrate: Record<string, any> | undefined,
    options: RoCrateChangeOptions = {},
  ): boolean {
    const previousCrate = this.appStateService.roCrate
    const trackHistory = options.trackHistory ?? true

    if (this.valuesEqual(previousCrate, nextCrate)) {
      this.appStateService.roCrate = nextCrate
      this.appStateService.dirty = this.appStateService.isRoCrateDirty(nextCrate)
      return false
    }

    this.appStateService.roCrate = nextCrate
    this.appStateService.dirty = this.appStateService.isRoCrateDirty(nextCrate)

    if (!trackHistory || !previousCrate || !nextCrate) {
      return true
    }

    const operation = this.createPatchOperation(
      previousCrate,
      nextCrate,
      options.label ?? 'Edit RO-Crate',
    )

    if (operation) {
      this.pushOperation(operation)
    }

    return true
  }

  async runInTransaction<T>(label: string, callback: () => Promise<T> | T): Promise<T> {
    const context: TransactionContext = { label, operations: [] }
    this.transactionStack.push(context)

    try {
      const result = await callback()
      this.transactionStack.pop()

      if (context.operations.length > 0) {
        this.pushOperation({
          kind: 'composite',
          label,
          operations: context.operations,
          timestamp: Date.now(),
        })
      }

      return result
    } catch (error) {
      this.transactionStack.pop()
      throw error
    }
  }

  undo(): void {
    const operation = this.undoStack.pop()
    if (!operation) {
      return
    }

    this.applyHistoryOperation(operation, 'undo')
    this.redoStack.push(operation)
    this.trimStack(this.redoStack)
  }

  redo(): void {
    const operation = this.redoStack.pop()
    if (!operation) {
      return
    }

    this.applyHistoryOperation(operation, 'redo')
    this.undoStack.push(operation)
    this.trimStack(this.undoStack)
  }

  protected pushOperation(operation: RoCrateHistoryOperation): void {
    const activeTransaction = this.transactionStack[this.transactionStack.length - 1]
    if (activeTransaction) {
      activeTransaction.operations.push(operation)
      return
    }

    this.undoStack.push(operation)
    this.trimStack(this.undoStack)
    this.redoStack = []
  }

  /**
   * Enforces the configured stack size limit by removing oldest entries.
   */
  protected trimStack(stack: RoCrateHistoryOperation[]): void {
    if (stack.length <= this.maxHistoryEntries) {
      return
    }
    stack.splice(0, stack.length - this.maxHistoryEntries)
  }

  protected applyHistoryOperation(
    operation: RoCrateHistoryOperation,
    mode: 'undo' | 'redo',
  ): void {
    if (operation.kind === 'composite') {
      const operations =
        mode === 'undo' ? [...operation.operations].reverse() : operation.operations
      for (const child of operations) {
        this.applyHistoryOperation(child, mode)
      }
      return
    }

    const current = this.cloneValue(this.appStateService.roCrate ?? {})
    const patch = mode === 'undo' ? operation.backward : operation.forward
    const errors = applyRfc6902Patch(current, patch)
    if (errors.some((error) => Boolean(error))) {
      return
    }

    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return
    }

    this.appStateService.roCrate = current as Record<string, any>
    this.appStateService.dirty = this.appStateService.isRoCrateDirty(
      current as Record<string, any>,
    )
  }

  protected createPatchOperation(
    before: Record<string, any>,
    after: Record<string, any>,
    label: string,
  ): RoCratePatchOperation | undefined {
    try {
      const forward = this.cloneValue(createRfc6902Patch(before, after) as JsonPatch)
      if (forward.length === 0) {
        return undefined
      }
      const backward = this.cloneValue(createRfc6902Patch(after, before) as JsonPatch)

      return {
        kind: 'patch',
        label,
        forward,
        backward,
        timestamp: Date.now(),
        forwardBytes: this.estimateSerializedBytes(forward),
        backwardBytes: this.estimateSerializedBytes(backward),
      }
    } catch {
      return undefined
    }
  }

  protected sumPatchBytes(
    operations: RoCrateHistoryOperation[],
    mode: 'forward' | 'backward' | 'both',
  ): number {
    let total = 0
    for (const operation of operations) {
      if (operation.kind === 'patch') {
        if (mode === 'forward') {
          total += operation.forwardBytes
        } else if (mode === 'backward') {
          total += operation.backwardBytes
        } else {
          total += operation.forwardBytes + operation.backwardBytes
        }
      } else {
        total += this.sumPatchBytes(operation.operations, mode)
      }
    }
    return total
  }

  protected estimateSerializedBytes(value: unknown): number {
    try {
      const serialized = JSON.stringify(value)
      return serialized ? serialized.length * 2 : 0
    } catch {
      return 0
    }
  }

  protected cloneValue<T>(value: T): T {
    if (value === undefined) {
      return value
    }
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return value
    }
  }

  protected valuesEqual(a: unknown, b: unknown): boolean {
    try {
      return (
        JSON.stringify(this.toStableComparableValue(a)) ===
        JSON.stringify(this.toStableComparableValue(b))
      )
    } catch {
      return false
    }
  }

  protected toStableComparableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.toStableComparableValue(entry))
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      const sortedKeys = Object.keys(obj).sort((left, right) => left.localeCompare(right))
      const normalized: Record<string, unknown> = {}
      for (const key of sortedKeys) {
        normalized[key] = this.toStableComparableValue(obj[key])
      }
      return normalized
    }
    return value
  }
}
