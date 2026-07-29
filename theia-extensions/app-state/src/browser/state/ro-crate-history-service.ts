import { inject, injectable } from 'inversify'
import { nls } from '@theia/core/lib/common/nls'
import {
  applyPatch as applyRfc6902Patch,
  createPatch as createRfc6902Patch,
  type Operation,
} from 'rfc6902'
import { AppStateService } from './app-state-service'
import type { RoCrateApprovalFile } from './ro-crate-approval'

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
  /**
   * Merge this operation into the latest undo entry when possible.
   */
  mergeWithPrevious?: boolean
  /**
   * Merge the next operation into this one when possible.
   */
  mergeWithNext?: boolean
}

export type JsonPatchOperation = Operation
export type JsonPatch = JsonPatchOperation[]
export type RoCrateHistoryPatchTarget = 'roCrate' | 'roCrateApproval'

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
   * App-state field this patch applies to.
   */
  target: RoCrateHistoryPatchTarget
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

type PushOperationOptions = {
  mergeWithPrevious?: boolean
  mergeWithNext?: boolean
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
  protected pendingMergeWithNext = false
  protected pendingMergeDeadline = 0
  protected readonly mergeWindowMs = 1000

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
    this.clearPendingMerge()
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
      options.label ?? nls.localize(
        'rockit/appState/history/editCrate',
        'Edit RO-Crate',
      ),
      'roCrate',
    )

    if (operation) {
      this.pushOperation(operation, options)
    }

    return true
  }

  applyRoCrateApprovalChange(
    nextApproval: RoCrateApprovalFile | undefined,
    options: RoCrateChangeOptions = {},
  ): boolean {
    const previousApproval = this.appStateService.roCrateApproval as
      | RoCrateApprovalFile
      | undefined
    const trackHistory = options.trackHistory ?? true

    if (this.valuesEqual(previousApproval, nextApproval)) {
      this.appStateService.roCrateApproval = nextApproval
      return false
    }

    this.appStateService.roCrateApproval = nextApproval

    if (!trackHistory) {
      return true
    }

    const operation = this.createPatchOperation(
      previousApproval,
      nextApproval,
      options.label ?? nls.localize(
        'rockit/appState/history/editApproval',
        'Edit RO-Crate approval',
      ),
      'roCrateApproval',
    )

    if (operation) {
      this.pushOperation(operation, options)
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

  protected pushOperation(
    operation: RoCrateHistoryOperation,
    options: PushOperationOptions = {},
  ): void {
    const activeTransaction = this.transactionStack[this.transactionStack.length - 1]
    if (activeTransaction) {
      activeTransaction.operations.push(operation)
      return
    }

    if (this.shouldMergeWithLatestUndo(options.mergeWithPrevious) && this.undoStack.length > 0) {
      this.mergeOperationIntoLatestUndo(operation)
      this.redoStack = []
      if (options.mergeWithNext) {
        this.markPendingMergeWithNext()
      } else {
        this.clearPendingMerge()
      }
      return
    }

    this.undoStack.push(operation)
    this.trimStack(this.undoStack)
    this.redoStack = []
    if (options.mergeWithNext) {
      this.markPendingMergeWithNext()
    } else {
      this.clearPendingMerge()
    }
  }

  protected mergeOperationIntoLatestUndo(operation: RoCrateHistoryOperation): void {
    const previous = this.undoStack.pop()
    if (!previous) {
      this.undoStack.push(operation)
      return
    }

    const previousOperations =
      previous.kind === 'composite' ? previous.operations : [previous]
    const nextOperations =
      operation.kind === 'composite' ? operation.operations : [operation]

    this.undoStack.push({
      kind: 'composite',
      label: operation.label,
      operations: [...previousOperations, ...nextOperations],
      timestamp: Date.now(),
    })
    this.trimStack(this.undoStack)
  }

  protected markPendingMergeWithNext(): void {
    this.pendingMergeWithNext = true
    this.pendingMergeDeadline = Date.now() + this.mergeWindowMs
  }

  protected clearPendingMerge(): void {
    this.pendingMergeWithNext = false
    this.pendingMergeDeadline = 0
  }

  protected shouldMergeWithPendingNext(): boolean {
    if (!this.pendingMergeWithNext) {
      return false
    }
    if (Date.now() > this.pendingMergeDeadline) {
      this.clearPendingMerge()
      return false
    }
    return true
  }

  protected shouldMergeWithLatestUndo(mergeWithPrevious?: boolean): boolean {
    if (this.shouldMergeWithPendingNext()) {
      return true
    }
    if (!mergeWithPrevious) {
      return false
    }
    const latestOperation = this.undoStack[this.undoStack.length - 1]
    if (!latestOperation) {
      return false
    }
    return Date.now() - latestOperation.timestamp <= this.mergeWindowMs
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

    const currentValue = this.getTargetValue(operation.target)
    const current = this.toPatchContainer(currentValue)
    const patch = mode === 'undo' ? operation.backward : operation.forward
    const errors = applyRfc6902Patch(current, patch)
    if (errors.some((error) => Boolean(error))) {
      return
    }

    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return
    }

    this.setTargetValue(operation.target, this.fromPatchContainer(current))
  }

  protected createPatchOperation(
    before: unknown,
    after: unknown,
    label: string,
    target: RoCrateHistoryPatchTarget,
  ): RoCratePatchOperation | undefined {
    try {
      const beforeContainer = this.toPatchContainer(before)
      const afterContainer = this.toPatchContainer(after)
      const forward = this.cloneValue(createRfc6902Patch(beforeContainer, afterContainer) as JsonPatch)
      if (forward.length === 0) {
        return undefined
      }
      const backward = this.cloneValue(createRfc6902Patch(afterContainer, beforeContainer) as JsonPatch)

      return {
        kind: 'patch',
        label,
        target,
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

  protected getTargetValue(target: RoCrateHistoryPatchTarget): unknown {
    return target === 'roCrate'
      ? this.appStateService.roCrate
      : this.appStateService.roCrateApproval
  }

  protected setTargetValue(target: RoCrateHistoryPatchTarget, value: unknown): void {
    if (target === 'roCrate') {
      const crate = value as Record<string, any> | undefined
      this.appStateService.roCrate = crate
      this.appStateService.dirty = this.appStateService.isRoCrateDirty(crate)
      return
    }

    this.appStateService.roCrateApproval = value as RoCrateApprovalFile | undefined
  }

  protected toPatchContainer(value: unknown): Record<string, unknown> {
    if (value === undefined) {
      return {}
    }
    return { value: this.cloneValue(value) }
  }

  protected fromPatchContainer(container: Record<string, unknown>): unknown {
    return Object.prototype.hasOwnProperty.call(container, 'value')
      ? container.value
      : undefined
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
