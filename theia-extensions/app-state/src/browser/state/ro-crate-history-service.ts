import { inject, injectable } from 'inversify'
import { AppStateService } from './app-state-service'

/**
 * Options for storing a RO-Crate change.
 */
export interface RoCrateChangeOptions {
  /**
   * Human-readable label shown for this operation in history/debug views.
   */
  label?: string
  /**
   * When false, updates AppState but skips writing undo/redo history.
   */
  trackHistory?: boolean
}

/**
 * Patch for a top-level RO-Crate key outside `@graph`.
 */
export interface RoCrateRootPatch {
  /**
   * Top-level property name (except `@graph`).
   */
  key: string
  /**
   * Whether the key existed before applying the operation.
   */
  beforeExists: boolean
  /**
   * Whether the key exists after applying the operation.
   */
  afterExists: boolean
  /**
   * Value before the operation (deep-cloned JSON value).
   */
  before?: unknown
  /**
   * Value after the operation (deep-cloned JSON value).
   */
  after?: unknown
}

/**
 * Patch for one entity in `@graph`, identified by `@id`.
 */
export interface RoCrateEntityPatch {
  /**
   * Entity `@id`.
   */
  entityId: string
  /**
   * Whether the entity existed before applying the operation.
   */
  beforeExists: boolean
  /**
   * Whether the entity exists after applying the operation.
   */
  afterExists: boolean
  /**
   * Entity position in `@graph` before the operation (`-1` when missing).
   */
  beforeIndex: number
  /**
   * Entity position in `@graph` after the operation (`-1` when missing).
   */
  afterIndex: number
  /**
   * Full entity content before the operation (deep-cloned JSON object).
   */
  before?: Record<string, any>
  /**
   * Full entity content after the operation (deep-cloned JSON object).
   */
  after?: Record<string, any>
}

/**
 * Atomic history operation containing root-level and entity-level patches.
 */
export interface RoCratePatchOperation {
  /**
   * Discriminator for operation type narrowing.
   */
  kind: 'patch'
  /**
   * Human-readable operation label.
   */
  label: string
  /**
   * Patches for top-level keys outside `@graph`.
   */
  rootPatches: RoCrateRootPatch[]
  /**
   * Patches for changed entities in `@graph`.
   */
  entityPatches: RoCrateEntityPatch[]
  /**
   * Creation timestamp (`Date.now()` milliseconds).
   */
  timestamp: number
  /**
   * Approximate bytes for alternative package-based diff representations.
   */
  alternativeDiffBytes?: {
    /**
     * Estimated bytes if stored as git-like text patch via the `diff` package.
     */
    gitLikeTextPatch: number
  }
}

/**
 * Grouped history operation containing multiple child operations.
 */
export interface RoCrateCompositeOperation {
  /**
   * Discriminator for operation type narrowing.
   */
  kind: 'composite'
  /**
   * Human-readable operation label for the full transaction.
   */
  label: string
  /**
   * Child operations in execution order.
   */
  operations: RoCrateHistoryOperation[]
  /**
   * Creation timestamp (`Date.now()` milliseconds).
   */
  timestamp: number
}

/**
 * Union of all supported history operation shapes.
 */
export type RoCrateHistoryOperation = RoCratePatchOperation | RoCrateCompositeOperation

/**
 * Snapshot used by temporary debug UI to inspect history content.
 */
export interface RoCrateHistoryDebugSnapshot {
  /**
   * Total number of operations currently available for undo.
   */
  undoCount: number
  /**
   * Total number of operations currently available for redo.
   */
  redoCount: number
  /**
   * Number of active nested transaction contexts.
   */
  transactionDepth: number
  /**
   * Estimated serialized size of the full undo stack in bytes.
   */
  undoStackBytes: number
  /**
   * Estimated serialized size of the full redo stack in bytes.
   */
  redoStackBytes: number
  /**
   * Estimated serialized size of active transaction buffers in bytes.
   */
  transactionStackBytes: number
  /**
   * Estimated serialized size of all history structures in bytes.
   */
  totalHistoryBytes: number
  /**
   * Estimated bytes of undo operations if represented as git-like text patches.
   */
  undoGitLikePatchBytes: number
  /**
   * Estimated bytes of redo operations if represented as git-like text patches.
   */
  redoGitLikePatchBytes: number
  /**
   * Estimated bytes of all operations if represented as git-like text patches.
   */
  totalGitLikePatchBytes: number
  /**
   * Tail of undo stack (bounded by `maxOperations`) for inspection.
   */
  undoStack: RoCrateHistoryOperation[]
  /**
   * Tail of redo stack (bounded by `maxOperations`) for inspection.
   */
  redoStack: RoCrateHistoryOperation[]
}

/**
 * Internal transaction buffer while building a grouped history operation.
 */
type TransactionContext = {
  label: string
  operations: RoCrateHistoryOperation[]
}

/**
 * Internal entity snapshot extracted from `@graph`.
 */
type EntitySnapshot = {
  index: number
  entity: Record<string, any>
}

type JsDiffModule = {
  createTwoFilesPatch: (
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
  ) => string
}

/**
 * Stores RO-Crate undo/redo history as lightweight reversible patches.
 *
 * Design goals:
 * - keep AppState as current truth only (no snapshots in AppState)
 * - track changed entities and changed content
 * - allow grouped/transactional history entries
 */
@injectable()
export class RoCrateHistoryService {
  protected undoStack: RoCrateHistoryOperation[] = []
  protected redoStack: RoCrateHistoryOperation[] = []
  protected readonly transactionStack: TransactionContext[] = []

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  /**
   * True when at least one operation exists on the undo stack.
   */
  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /**
   * True when at least one operation exists on the redo stack.
   */
  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /**
   * Returns a deep-cloned debug view of history stacks for temporary UI inspection.
   *
   * @param maxOperations maximum number of operations shown from the end of each stack
   */
  getDebugSnapshot(maxOperations = 30): RoCrateHistoryDebugSnapshot {
    const limit = Math.max(maxOperations, 1)
    const undoStart = Math.max(this.undoStack.length - limit, 0)
    const redoStart = Math.max(this.redoStack.length - limit, 0)
    const undoStackBytes = this.estimateSerializedBytes(this.undoStack)
    const redoStackBytes = this.estimateSerializedBytes(this.redoStack)
    const transactionStackBytes = this.estimateSerializedBytes(this.transactionStack)
    const undoGitLikePatchBytes = this.sumGitLikePatchBytes(this.undoStack)
    const redoGitLikePatchBytes = this.sumGitLikePatchBytes(this.redoStack)

    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      transactionDepth: this.transactionStack.length,
      undoStackBytes,
      redoStackBytes,
      transactionStackBytes,
      totalHistoryBytes: undoStackBytes + redoStackBytes + transactionStackBytes,
      undoGitLikePatchBytes,
      redoGitLikePatchBytes,
      totalGitLikePatchBytes: undoGitLikePatchBytes + redoGitLikePatchBytes,
      undoStack: this.cloneValue(this.undoStack.slice(undoStart)),
      redoStack: this.cloneValue(this.redoStack.slice(redoStart)),
    }
  }

  /**
   * Clears undo stack, redo stack, and any open transaction context.
   */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.transactionStack.length = 0
  }

  /**
   * Applies a new RO-Crate value to AppState and records a reversible operation.
   *
   * @param nextCrate next RO-Crate value to apply
   * @param options label and tracking flags for this change
   * @returns true when state changed, false when equivalent
   */
  applyRoCrateChange(
    nextCrate: Record<string, any> | undefined,
    options: RoCrateChangeOptions = {},
  ): boolean {
    const previousCrate = this.appStateService.roCrate
    const trackHistory = options.trackHistory ?? true

    if (this.areCratesEquivalent(previousCrate, nextCrate)) {
      this.appStateService.roCrate = nextCrate
      return false
    }

    this.appStateService.roCrate = nextCrate

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

  /**
   * Runs multiple history-producing updates as one grouped operation.
   *
   * Nested calls are supported; child transactions become child operations of
   * the parent transaction.
   *
   * @param label label for the grouped operation
   * @param callback code that performs one or more `applyRoCrateChange` calls
   */
  async runInTransaction<T>(
    label: string,
    callback: () => Promise<T> | T,
  ): Promise<T> {
    const context: TransactionContext = { label, operations: [] }
    this.transactionStack.push(context)

    try {
      const result = await callback()
      this.transactionStack.pop()

      if (context.operations.length > 0) {
        const operation: RoCrateHistoryOperation = {
          kind: 'composite',
          label,
          operations: context.operations,
          timestamp: Date.now(),
        }
        this.pushOperation(operation)
      }

      return result
    } catch (error) {
      this.transactionStack.pop()
      throw error
    }
  }

  /**
   * Applies inverse of the most recent operation and pushes it to redo stack.
   */
  undo(): void {
    const operation = this.undoStack.pop()
    if (!operation) {
      return
    }

    this.applyOperation(operation, 'undo')
    this.redoStack.push(operation)
  }

  /**
   * Re-applies the most recently undone operation and pushes it to undo stack.
   */
  redo(): void {
    const operation = this.redoStack.pop()
    if (!operation) {
      return
    }

    this.applyOperation(operation, 'redo')
    this.undoStack.push(operation)
  }

  /**
   * Pushes an operation either into the active transaction or directly to undo.
   * New non-transaction operations clear redo stack.
   */
  protected pushOperation(operation: RoCrateHistoryOperation): void {
    const activeTransaction = this.transactionStack[this.transactionStack.length - 1]
    if (activeTransaction) {
      activeTransaction.operations.push(operation)
      return
    }

    this.undoStack.push(operation)
    this.redoStack = []
  }

  /**
   * Applies a patch/composite operation in undo or redo direction.
   */
  protected applyOperation(operation: RoCrateHistoryOperation, mode: 'undo' | 'redo'): void {
    if (operation.kind === 'composite') {
      const ops =
        mode === 'undo'
          ? [...operation.operations].reverse()
          : operation.operations
      for (const child of ops) {
        this.applyOperation(child, mode)
      }
      return
    }

    const current = this.appStateService.roCrate
    const next = current ? this.cloneValue(current) : {}

    this.applyRootPatches(next, operation.rootPatches, mode)
    this.applyEntityPatches(next, operation.entityPatches, mode)

    this.appStateService.roCrate = next
    this.appStateService.dirty = this.appStateService.isRoCrateDirty(next)
  }

  /**
   * Applies root-level (non-`@graph`) patches to the target crate.
   */
  protected applyRootPatches(
    crate: Record<string, any>,
    patches: RoCrateRootPatch[],
    mode: 'undo' | 'redo',
  ): void {
    for (const patch of patches) {
      const exists = mode === 'undo' ? patch.beforeExists : patch.afterExists
      const value = mode === 'undo' ? patch.before : patch.after

      if (!exists) {
        delete crate[patch.key]
        continue
      }

      crate[patch.key] = this.cloneValue(value)
    }
  }

  /**
   * Applies entity-level patches to `@graph`, preserving insertion/move intent.
   */
  protected applyEntityPatches(
    crate: Record<string, any>,
    patches: RoCrateEntityPatch[],
    mode: 'undo' | 'redo',
  ): void {
    const graph = Array.isArray(crate['@graph']) ? [...crate['@graph']] : []

    for (const patch of patches) {
      const exists = mode === 'undo' ? patch.beforeExists : patch.afterExists
      const entity = mode === 'undo' ? patch.before : patch.after
      const targetIndex = mode === 'undo' ? patch.beforeIndex : patch.afterIndex

      const currentIndex = graph.findIndex(
        (entry) => this.getEntityId(entry) === patch.entityId,
      )

      if (!exists) {
        if (currentIndex >= 0) {
          graph.splice(currentIndex, 1)
        }
        continue
      }

      const nextEntity = this.cloneValue(entity)
      if (!nextEntity || typeof nextEntity !== 'object') {
        continue
      }

      if (currentIndex >= 0) {
        graph[currentIndex] = nextEntity
        this.moveGraphEntry(graph, currentIndex, targetIndex)
        continue
      }

      const insertionIndex =
        targetIndex >= 0 ? Math.min(Math.max(targetIndex, 0), graph.length) : graph.length
      graph.splice(insertionIndex, 0, nextEntity)
    }

    if (graph.length === 0) {
      delete crate['@graph']
    } else {
      crate['@graph'] = graph
    }
  }

  /**
   * Reorders an existing graph item to the requested position.
   */
  protected moveGraphEntry(graph: any[], currentIndex: number, targetIndex: number): void {
    if (
      targetIndex < 0 ||
      currentIndex < 0 ||
      currentIndex >= graph.length ||
      currentIndex === targetIndex
    ) {
      return
    }

    const [entry] = graph.splice(currentIndex, 1)
    if (!entry) {
      return
    }

    const boundedTarget = Math.min(Math.max(targetIndex, 0), graph.length)
    graph.splice(boundedTarget, 0, entry)
  }

  /**
   * Builds a patch operation by diffing two crate objects.
   *
   * @returns undefined when no effective differences were found
   */
  protected createPatchOperation(
    before: Record<string, any>,
    after: Record<string, any>,
    label: string,
  ): RoCratePatchOperation | undefined {
    const rootPatches = this.createRootPatches(before, after)
    const entityPatches = this.createEntityPatches(before, after)

    if (rootPatches.length === 0 && entityPatches.length === 0) {
      return undefined
    }

    return {
      kind: 'patch',
      label,
      rootPatches,
      entityPatches,
      timestamp: Date.now(),
      alternativeDiffBytes: {
        gitLikeTextPatch: this.estimateGitLikeTextPatchBytes(before, after),
      },
    }
  }

  /**
   * Creates patches for changed top-level keys excluding `@graph`.
   */
  protected createRootPatches(
    before: Record<string, any>,
    after: Record<string, any>,
  ): RoCrateRootPatch[] {
    const keys = new Set<string>([
      ...Object.keys(before).filter((key) => key !== '@graph'),
      ...Object.keys(after).filter((key) => key !== '@graph'),
    ])

    const patches: RoCrateRootPatch[] = []
    for (const key of keys) {
      const beforeExists = Object.prototype.hasOwnProperty.call(before, key)
      const afterExists = Object.prototype.hasOwnProperty.call(after, key)
      const beforeValue = beforeExists ? before[key] : undefined
      const afterValue = afterExists ? after[key] : undefined

      if (beforeExists === afterExists && this.valuesEqual(beforeValue, afterValue)) {
        continue
      }

      patches.push({
        key,
        beforeExists,
        afterExists,
        before: this.cloneValue(beforeValue),
        after: this.cloneValue(afterValue),
      })
    }

    return patches
  }

  /**
   * Creates patches for entities changed in `@graph` (matched by `@id`).
   */
  protected createEntityPatches(
    before: Record<string, any>,
    after: Record<string, any>,
  ): RoCrateEntityPatch[] {
    const beforeMap = this.mapEntitiesById(before)
    const afterMap = this.mapEntitiesById(after)

    const entityIds = new Set<string>([
      ...beforeMap.keys(),
      ...afterMap.keys(),
    ])

    const patches: RoCrateEntityPatch[] = []
    for (const entityId of entityIds) {
      const beforeEntry = beforeMap.get(entityId)
      const afterEntry = afterMap.get(entityId)

      const beforeExists = Boolean(beforeEntry)
      const afterExists = Boolean(afterEntry)
      const beforeEntity = beforeEntry?.entity
      const afterEntity = afterEntry?.entity
      const beforeIndex = beforeEntry?.index ?? -1
      const afterIndex = afterEntry?.index ?? -1

      if (
        beforeExists === afterExists &&
        beforeIndex === afterIndex &&
        this.valuesEqual(beforeEntity, afterEntity)
      ) {
        continue
      }

      patches.push({
        entityId,
        beforeExists,
        afterExists,
        beforeIndex,
        afterIndex,
        before: this.cloneValue(beforeEntity),
        after: this.cloneValue(afterEntity),
      })
    }

    return patches
  }

  /**
   * Maps `@graph` entities by `@id` with their current array index.
   */
  protected mapEntitiesById(crate: Record<string, any>): Map<string, EntitySnapshot> {
    const map = new Map<string, EntitySnapshot>()
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []

    for (let index = 0; index < graph.length; index += 1) {
      const entry = graph[index]
      const entityId = this.getEntityId(entry)
      if (!entityId || map.has(entityId)) {
        continue
      }

      map.set(entityId, {
        index,
        entity: this.cloneValue(entry) ?? {},
      })
    }

    return map
  }

  /**
   * Returns entity `@id` when value looks like a JSON object with string `@id`.
   */
  protected getEntityId(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined
    }
    const id = (value as Record<string, unknown>)['@id']
    return typeof id === 'string' && id.length > 0 ? id : undefined
  }

  /**
   * JSON-safe deep clone helper.
   *
   * Falls back to returning the original value if serialization fails.
   */
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

  /**
   * Structural equality for JSON-like values using stable-key normalization.
   */
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

  /**
   * Structural equality for two crate roots.
   */
  protected areCratesEquivalent(
    a: Record<string, any> | undefined,
    b: Record<string, any> | undefined,
  ): boolean {
    if (!a && !b) {
      return true
    }
    if (!a || !b) {
      return false
    }
    return this.valuesEqual(a, b)
  }

  /**
   * Produces key-order-stable representation to make JSON string comparison deterministic.
   */
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

  /**
   * Estimates memory size by serializing to JSON and approximating UTF-16 bytes.
   *
   * This is a debug estimate, not exact VM heap usage.
   */
  protected estimateSerializedBytes(value: unknown): number {
    try {
      const serialized = JSON.stringify(value)
      return serialized ? serialized.length * 2 : 0
    } catch {
      return 0
    }
  }

  /**
   * Recursively sums stored git-like patch estimates for a list of operations.
   */
  protected sumGitLikePatchBytes(operations: RoCrateHistoryOperation[]): number {
    let total = 0
    for (const operation of operations) {
      if (operation.kind === 'patch') {
        total += operation.alternativeDiffBytes?.gitLikeTextPatch ?? 0
      } else {
        total += this.sumGitLikePatchBytes(operation.operations)
      }
    }
    return total
  }

  /**
   * Estimates bytes for a package-based git-like textual patch representation.
   *
   * Uses the installed `diff` package (`createTwoFilesPatch`) as a baseline
   * alternative to entity patches. This is for size comparison only.
   */
  protected estimateGitLikeTextPatchBytes(
    before: Record<string, any>,
    after: Record<string, any>,
  ): number {
    try {
      const jsDiff = require('diff') as JsDiffModule

      const beforeText = JSON.stringify(before, null, 2)
      const afterText = JSON.stringify(after, null, 2)
      const patch = jsDiff.createTwoFilesPatch(
        'ro-crate-before.json',
        'ro-crate-after.json',
        beforeText,
        afterText,
      )

      return patch.length * 2
    } catch {
      return 0
    }
  }
}
