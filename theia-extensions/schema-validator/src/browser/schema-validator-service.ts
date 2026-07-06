import { inject, injectable } from 'inversify';
import { SchemaValidator, ValidationError, MetadataSchemaManager } from 'rockit-common/lib/browser';
import {
  validateEntities as runEntityValidation,
  validate,
  type CompiledInputRule,
} from './ro-crate-validator';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';

type ValidationMode = 'full' | 'incremental' | 'cached';

@injectable()
export class SchemaValidatorService implements SchemaValidator {
  @inject(MetadataSchemaManager) protected readonly schemaManagerService: MetadataSchemaManager;
  @inject(AppStateService) protected readonly appStateService: AppStateService;

  protected lastBaseProfileRef?: Record<string, any>;
  protected lastProfileListRef: any;
  protected lastProfileContentById = new Map<string, any>();
  protected lastCompleteProfileRef?: Record<string, any>;
  protected contextRevision = 0;

  protected previousEntityHashes = new Map<string, string>();
  protected previousErrorsByEntity = new Map<string, ValidationError[]>();
  protected readonly compiledRuleCache = new Map<string, CompiledInputRule[]>();

  protected activeValidationController?: AbortController;
  protected activeFullSweepController?: AbortController;

  protected lastRunMode: ValidationMode = 'full';

  getLastRunMode(): ValidationMode {
    return this.lastRunMode;
  }

  invalidateEntities(entityIds: string[] | Set<string>): void {
    for (const rawId of entityIds) {
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (!id) {
        continue;
      }
      this.previousEntityHashes.delete(id);
    }
  }

  protected nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  protected roundMs(value: number): number {
    return Number(value.toFixed(2));
  }

  protected getGraphEntityCount(crate: Record<string, any> | undefined): number {
    return Array.isArray(crate?.['@graph']) ? crate['@graph'].length : 0;
  }

  protected logValidationPerf(operation: string, data: Record<string, any>): void {
    console.info(`[schema-validator-service:perf] ${operation}`, data);
  }

  protected getCacheNamespace(): string {
    return `ctx:${this.contextRevision}`;
  }

  protected normalizeEntityId(entity: Record<string, any>, index: number): string {
    const id = entity?.['@id'];
    if (typeof id === 'string' && id.trim().length > 0) {
      return id.trim();
    }
    return `__index:${index}`;
  }

  protected hashEntity(entity: Record<string, any>): string {
    try {
      return JSON.stringify(entity);
    } catch {
      return String(entity?.['@id'] ?? '');
    }
  }

  protected collectEntityHashes(crate: Record<string, any>): Map<string, string> {
    const graph = Array.isArray(crate?.['@graph']) ? (crate['@graph'] as Record<string, any>[]) : [];
    const hashes = new Map<string, string>();

    for (let index = 0; index < graph.length; index += 1) {
      const entity = graph[index];
      if (!entity || typeof entity !== 'object') {
        continue;
      }
      const id = this.normalizeEntityId(entity, index);
      hashes.set(id, this.hashEntity(entity));
    }

    return hashes;
  }

  protected collectTargetEntityHashes(
    crate: Record<string, any>,
    targetEntityIds: Set<string>,
  ): { hashes: Map<string, string>; removedIds: Set<string>; scannedCount: number } {
    const graph = Array.isArray(crate?.['@graph']) ? (crate['@graph'] as Record<string, any>[]) : [];
    const hashes = new Map<string, string>();
    const foundIds = new Set<string>();
    let scannedCount = 0;

    if (targetEntityIds.size === 0) {
      return { hashes, removedIds: new Set<string>(), scannedCount };
    }

    for (let index = 0; index < graph.length; index += 1) {
      scannedCount += 1;
      const entity = graph[index];
      if (!entity || typeof entity !== 'object') {
        continue;
      }

      const id = this.normalizeEntityId(entity, index);
      if (!targetEntityIds.has(id)) {
        continue;
      }

      hashes.set(id, this.hashEntity(entity));
      foundIds.add(id);
      if (foundIds.size >= targetEntityIds.size) {
        break;
      }
    }

    const removedIds = new Set<string>();
    for (const id of targetEntityIds) {
      if (!foundIds.has(id)) {
        removedIds.add(id);
      }
    }

    return { hashes, removedIds, scannedCount };
  }

  protected getProfileContentById(profileList: any): Map<string, any> {
    const byId = new Map<string, any>();
    if (!Array.isArray(profileList)) {
      return byId;
    }

    for (const item of profileList) {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      if (id) {
        byId.set(id, item?.content);
      }
    }
    return byId;
  }

  protected extractConformsToIds(entity: Record<string, any>): string[] {
    const value: any = entity?.conformsTo;
    const entries = value ? (Array.isArray(value) ? value : [value]) : [];
    return entries
      .map((entry: any) => {
        if (typeof entry === 'string') {
          return entry.trim();
        }
        if (entry && typeof entry === 'object') {
          const id = entry['@id'] ?? entry.id;
          return typeof id === 'string' ? id.trim() : '';
        }
        return '';
      })
      .filter((id: string) => id.length > 0);
  }

  protected collectEntityIdsForProfiles(
    crate: Record<string, any>,
    profileIds: Set<string>,
  ): Set<string> {
    const result = new Set<string>();
    if (profileIds.size === 0) {
      return result;
    }

    const graph = Array.isArray(crate?.['@graph']) ? (crate['@graph'] as Record<string, any>[]) : [];
    for (let index = 0; index < graph.length; index += 1) {
      const entity = graph[index];
      if (!entity || typeof entity !== 'object') {
        continue;
      }
      const conformsToIds = this.extractConformsToIds(entity);
      if (conformsToIds.some((id) => profileIds.has(id))) {
        result.add(this.normalizeEntityId(entity, index));
      }
    }
    return result;
  }

  protected refreshValidationContext(
    baseProfile: Record<string, any>,
    profileList: any,
    completeProfile: Record<string, any> | undefined,
  ): { changed: boolean; forceFull: boolean; affectedProfileIds: Set<string> } {
    const nextProfileContentById = this.getProfileContentById(profileList);
    const affectedProfileIds = new Set<string>();
    for (const [id, content] of nextProfileContentById.entries()) {
      if (this.lastProfileContentById.get(id) !== content) {
        affectedProfileIds.add(id);
      }
    }
    for (const id of this.lastProfileContentById.keys()) {
      if (!nextProfileContentById.has(id)) {
        affectedProfileIds.add(id);
      }
    }

    const forceFull =
      this.lastBaseProfileRef !== baseProfile ||
      this.lastCompleteProfileRef !== completeProfile;

    const changed = forceFull || affectedProfileIds.size !== 0;

    if (!changed) {
      this.lastProfileListRef = profileList;
      this.lastProfileContentById = nextProfileContentById;
      return { changed: false, forceFull: false, affectedProfileIds };
    }

    this.contextRevision += 1;
    this.lastBaseProfileRef = baseProfile;
    this.lastProfileListRef = profileList;
    this.lastProfileContentById = nextProfileContentById;
    this.lastCompleteProfileRef = completeProfile;
    this.compiledRuleCache.clear();
    return { changed: true, forceFull, affectedProfileIds };
  }

  protected computeDiff(
    currentHashes: Map<string, string>,
  ): { changedIds: Set<string>; removedIds: Set<string> } {
    const changedIds = new Set<string>();
    const removedIds = new Set<string>();

    for (const [id, hash] of currentHashes.entries()) {
      if (this.previousEntityHashes.get(id) !== hash) {
        changedIds.add(id);
      }
    }

    for (const previousId of this.previousEntityHashes.keys()) {
      if (!currentHashes.has(previousId)) {
        changedIds.add(previousId);
        removedIds.add(previousId);
      }
    }

    return { changedIds, removedIds };
  }

  protected abortActiveValidation(): void {
    if (this.activeValidationController && !this.activeValidationController.signal.aborted) {
      this.activeValidationController.abort();
    }
    this.activeValidationController = undefined;
  }

  protected abortActiveFullSweep(): void {
    if (this.activeFullSweepController && !this.activeFullSweepController.signal.aborted) {
      this.activeFullSweepController.abort();
    }
    this.activeFullSweepController = undefined;
  }

  protected toErrorMap(errors: ValidationError[] | undefined): Map<string, ValidationError[]> {
    const map = new Map<string, ValidationError[]>();
    for (const error of errors ?? []) {
      const id = typeof error?.entityId === 'string' ? error.entityId : '';
      if (!id) {
        continue;
      }
      const current = map.get(id);
      if (current) {
        current.push(error);
      } else {
        map.set(id, [error]);
      }
    }
    return map;
  }

  protected flattenErrorMap(map: Map<string, ValidationError[]>): ValidationError[] {
    const result: ValidationError[] = [];
    for (const errors of map.values()) {
      result.push(...errors);
    }
    return result;
  }

  protected applyFullResult(
    errors: ValidationError[] | undefined,
    currentHashes: Map<string, string>,
  ): ValidationError[] | undefined {
    this.previousErrorsByEntity = this.toErrorMap(errors);
    this.previousEntityHashes = currentHashes;

    const flattened = this.flattenErrorMap(this.previousErrorsByEntity);
    return flattened.length ? flattened : undefined;
  }

  protected applyIncrementalResult(
    changedIds: Set<string>,
    removedIds: Set<string>,
    partialErrors: ValidationError[] | undefined,
    currentHashes: Map<string, string>,
  ): ValidationError[] | undefined {
    for (const id of changedIds) {
      this.previousErrorsByEntity.delete(id);
    }
    for (const id of removedIds) {
      this.previousErrorsByEntity.delete(id);
    }

    const nextErrorsByEntity = this.toErrorMap(partialErrors);
    for (const [id, errors] of nextErrorsByEntity.entries()) {
      this.previousErrorsByEntity.set(id, errors);
    }

    this.previousEntityHashes = currentHashes;

    const flattened = this.flattenErrorMap(this.previousErrorsByEntity);
    return flattened.length ? flattened : undefined;
  }

  protected applyTargetedResult(
    targetEntityIds: Set<string>,
    removedIds: Set<string>,
    partialErrors: ValidationError[] | undefined,
    targetHashes: Map<string, string>,
  ): ValidationError[] | undefined {
    for (const id of targetEntityIds) {
      this.previousErrorsByEntity.delete(id);
    }
    for (const id of removedIds) {
      this.previousEntityHashes.delete(id);
      this.previousErrorsByEntity.delete(id);
    }

    const nextErrorsByEntity = this.toErrorMap(partialErrors);
    for (const [id, errors] of nextErrorsByEntity.entries()) {
      this.previousErrorsByEntity.set(id, errors);
    }
    for (const [id, hash] of targetHashes.entries()) {
      this.previousEntityHashes.set(id, hash);
    }

    const flattened = this.flattenErrorMap(this.previousErrorsByEntity);
    return flattened.length ? flattened : undefined;
  }

  async validateEntitiesTargeted(
    crate: Record<string, any>,
    baseProfile: Record<string, any>,
    entityIds: string[] | Set<string>,
  ): Promise<ValidationError[] | undefined> {
    const totalStartedAt = this.nowMs();
    const graphEntityCount = this.getGraphEntityCount(crate);
    const targetEntityIds = new Set<string>();
    for (const rawId of entityIds) {
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (id) {
        targetEntityIds.add(id);
      }
    }

    if (!crate || !Array.isArray(crate['@graph']) || !baseProfile || targetEntityIds.size === 0) {
      this.lastRunMode = 'incremental';
      this.logValidationPerf('validateEntitiesTargeted', {
        mode: 'skipped',
        reason: targetEntityIds.size === 0 ? 'missing-target-entity-ids' : 'missing-crate-graph-or-profile',
        totalMs: this.roundMs(this.nowMs() - totalStartedAt),
        graphEntityCount,
        targetEntityCount: targetEntityIds.size,
      });
      return this.flattenErrorMap(this.previousErrorsByEntity);
    }

    if (this.previousEntityHashes.size === 0) {
      this.logValidationPerf('validateEntitiesTargeted', {
        mode: 'fallback-full',
        reason: 'missing-previous-validation-state',
        totalMs: this.roundMs(this.nowMs() - totalStartedAt),
        graphEntityCount,
        targetEntityCount: targetEntityIds.size,
      });
      return this.validateEntities(crate, baseProfile);
    }

    const profileList = this.appStateService.profileList;
    const completeProfile = this.appStateService.completeProfile;
    const contextStartedAt = this.nowMs();
    const contextChange = this.refreshValidationContext(baseProfile, profileList, completeProfile);
    const contextMs = this.nowMs() - contextStartedAt;

    const collectTargetsStartedAt = this.nowMs();
    const { hashes: targetHashes, removedIds, scannedCount } =
      this.collectTargetEntityHashes(crate, targetEntityIds);
    const collectTargetHashesMs = this.nowMs() - collectTargetsStartedAt;

    this.abortActiveValidation();
    this.abortActiveFullSweep();

    const controller = new AbortController();
    this.activeValidationController = controller;

    try {
      let partialErrors: ValidationError[] | undefined = undefined;
      let runEntityValidationMs = 0;
      if (targetHashes.size > 0) {
        const validationStartedAt = this.nowMs();
        partialErrors = await runEntityValidation(
          crate,
          baseProfile,
          profileList,
          this.schemaManagerService,
          {
            targetEntityIds: new Set(targetHashes.keys()),
            signal: controller.signal,
            yieldEvery: 0,
            compiledRuleCache: this.compiledRuleCache,
            cacheNamespace: this.getCacheNamespace(),
            completeProfile,
          },
        );
        runEntityValidationMs = this.nowMs() - validationStartedAt;
      }

      this.lastRunMode = 'incremental';
      const applyStartedAt = this.nowMs();
      const result = this.applyTargetedResult(targetEntityIds, removedIds, partialErrors, targetHashes);
      const applyResultMs = this.nowMs() - applyStartedAt;

      this.logValidationPerf('validateEntitiesTargeted', {
        mode: 'targeted',
        totalMs: this.roundMs(this.nowMs() - totalStartedAt),
        contextMs: this.roundMs(contextMs),
        collectTargetHashesMs: this.roundMs(collectTargetHashesMs),
        runEntityValidationMs: this.roundMs(runEntityValidationMs),
        applyResultMs: this.roundMs(applyResultMs),
        graphEntityCount,
        scannedCount,
        targetEntityCount: targetEntityIds.size,
        foundTargetEntityCount: targetHashes.size,
        removedCount: removedIds.size,
        errorCount: result?.length ?? 0,
        rawErrorCount: partialErrors?.length ?? 0,
        cachedEntityErrorCount: this.previousErrorsByEntity.size,
        compiledRuleCacheSize: this.compiledRuleCache.size,
        contextChanged: contextChange.changed,
        forceFullContext: contextChange.forceFull,
        affectedProfileCount: contextChange.affectedProfileIds.size,
      });

      return result;
    } finally {
      if (this.activeValidationController === controller) {
        this.activeValidationController = undefined;
      }
    }
  }

  async validateEntities(
    crate: Record<string, any>,
    baseProfile: Record<string, any>,
  ): Promise<ValidationError[] | undefined> {
    const totalStartedAt = this.nowMs();
    const graphEntityCount = this.getGraphEntityCount(crate);

    if (!crate || !Array.isArray(crate['@graph']) || !baseProfile) {
      this.previousEntityHashes.clear();
      this.previousErrorsByEntity.clear();
      this.compiledRuleCache.clear();
      this.lastRunMode = 'full';
      this.logValidationPerf('validateEntities', {
        mode: 'skipped',
        reason: 'missing-crate-graph-or-profile',
        totalMs: this.roundMs(this.nowMs() - totalStartedAt),
        graphEntityCount,
      });
      return undefined;
    }

    const profileList = this.appStateService.profileList;
    const completeProfile = this.appStateService.completeProfile;
    const contextStartedAt = this.nowMs();
    const contextChange = this.refreshValidationContext(baseProfile, profileList, completeProfile);
    const contextMs = this.nowMs() - contextStartedAt;

    const collectHashesStartedAt = this.nowMs();
    const currentHashes = this.collectEntityHashes(crate);
    const collectHashesMs = this.nowMs() - collectHashesStartedAt;

    const hasPreviousState = this.previousEntityHashes.size > 0;
    const diffStartedAt = this.nowMs();
    const { changedIds, removedIds } = this.computeDiff(currentHashes);
    const diffMs = this.nowMs() - diffStartedAt;
    const profileAffectedStartedAt = this.nowMs();
    const profileAffectedEntityIds = contextChange.forceFull
      ? new Set<string>()
      : this.collectEntityIdsForProfiles(crate, contextChange.affectedProfileIds);
    const profileAffectedMs = this.nowMs() - profileAffectedStartedAt;
    const invalidatedIds = new Set<string>(changedIds);
    for (const id of profileAffectedEntityIds) {
      invalidatedIds.add(id);
    }

    if (!contextChange.changed && hasPreviousState && changedIds.size === 0 && removedIds.size === 0) {
      this.lastRunMode = 'cached';
      const flattenStartedAt = this.nowMs();
      const cached = this.flattenErrorMap(this.previousErrorsByEntity);
      const flattenErrorsMs = this.nowMs() - flattenStartedAt;
      this.logValidationPerf('validateEntities', {
        mode: this.lastRunMode,
        totalMs: this.roundMs(this.nowMs() - totalStartedAt),
        contextMs: this.roundMs(contextMs),
        collectHashesMs: this.roundMs(collectHashesMs),
        diffMs: this.roundMs(diffMs),
        profileAffectedMs: this.roundMs(profileAffectedMs),
        flattenErrorsMs: this.roundMs(flattenErrorsMs),
        graphEntityCount,
        currentEntityCount: currentHashes.size,
        changedCount: changedIds.size,
        removedCount: removedIds.size,
        invalidatedCount: invalidatedIds.size,
        affectedProfileCount: contextChange.affectedProfileIds.size,
        profileAffectedEntityCount: profileAffectedEntityIds.size,
        errorCount: cached.length,
        cachedEntityErrorCount: this.previousErrorsByEntity.size,
        compiledRuleCacheSize: this.compiledRuleCache.size,
        contextChanged: contextChange.changed,
        forceFullContext: contextChange.forceFull,
        hasPreviousState,
      });
      return cached.length ? cached : undefined;
    }

    this.abortActiveValidation();
    this.abortActiveFullSweep();

    const controller = new AbortController();
    this.activeValidationController = controller;

    try {
      const shouldRunFull =
        contextChange.forceFull ||
        !hasPreviousState ||
        invalidatedIds.size > Math.max(50, Math.floor(currentHashes.size * 0.6)) ||
        (contextChange.changed &&
          invalidatedIds.size === 0 &&
          contextChange.affectedProfileIds.size === 0);

      if (shouldRunFull) {
        const validationStartedAt = this.nowMs();
        const fullErrors = await runEntityValidation(
          crate,
          baseProfile,
          profileList,
          this.schemaManagerService,
          {
            signal: controller.signal,
            yieldEvery: 75,
            compiledRuleCache: this.compiledRuleCache,
            cacheNamespace: this.getCacheNamespace(),
            completeProfile,
          },
        );
        const runEntityValidationMs = this.nowMs() - validationStartedAt;

        this.lastRunMode = 'full';
        const applyStartedAt = this.nowMs();
        const result = this.applyFullResult(fullErrors, currentHashes);
        const applyResultMs = this.nowMs() - applyStartedAt;

        this.logValidationPerf('validateEntities', {
          mode: this.lastRunMode,
          totalMs: this.roundMs(this.nowMs() - totalStartedAt),
          contextMs: this.roundMs(contextMs),
          collectHashesMs: this.roundMs(collectHashesMs),
          diffMs: this.roundMs(diffMs),
          profileAffectedMs: this.roundMs(profileAffectedMs),
          runEntityValidationMs: this.roundMs(runEntityValidationMs),
          applyResultMs: this.roundMs(applyResultMs),
          graphEntityCount,
          currentEntityCount: currentHashes.size,
          changedCount: changedIds.size,
          removedCount: removedIds.size,
          invalidatedCount: invalidatedIds.size,
          affectedProfileCount: contextChange.affectedProfileIds.size,
          profileAffectedEntityCount: profileAffectedEntityIds.size,
          targetEntityCount: currentHashes.size,
          errorCount: result?.length ?? 0,
          rawErrorCount: fullErrors?.length ?? 0,
          cachedEntityErrorCount: this.previousErrorsByEntity.size,
          compiledRuleCacheSize: this.compiledRuleCache.size,
          contextChanged: contextChange.changed,
          forceFullContext: contextChange.forceFull,
          hasPreviousState,
        });

        return result;
      }

      const targetEntityIds = new Set<string>();
      for (const id of invalidatedIds) {
        if (currentHashes.has(id)) {
          targetEntityIds.add(id);
        }
      }

      let partialErrors: ValidationError[] | undefined = undefined;
      let runEntityValidationMs = 0;
      if (targetEntityIds.size > 0) {
        const validationStartedAt = this.nowMs();
        partialErrors = await runEntityValidation(
          crate,
          baseProfile,
          profileList,
          this.schemaManagerService,
          {
            targetEntityIds,
            signal: controller.signal,
            yieldEvery: 75,
            compiledRuleCache: this.compiledRuleCache,
            cacheNamespace: this.getCacheNamespace(),
            completeProfile,
          },
        );
        runEntityValidationMs = this.nowMs() - validationStartedAt;
      }

      this.lastRunMode = 'incremental';
      const applyStartedAt = this.nowMs();
      const result = this.applyIncrementalResult(invalidatedIds, removedIds, partialErrors, currentHashes);
      const applyResultMs = this.nowMs() - applyStartedAt;

      this.logValidationPerf('validateEntities', {
        mode: this.lastRunMode,
        totalMs: this.roundMs(this.nowMs() - totalStartedAt),
        contextMs: this.roundMs(contextMs),
        collectHashesMs: this.roundMs(collectHashesMs),
        diffMs: this.roundMs(diffMs),
        profileAffectedMs: this.roundMs(profileAffectedMs),
        runEntityValidationMs: this.roundMs(runEntityValidationMs),
        applyResultMs: this.roundMs(applyResultMs),
        graphEntityCount,
        currentEntityCount: currentHashes.size,
        changedCount: changedIds.size,
        removedCount: removedIds.size,
        invalidatedCount: invalidatedIds.size,
        affectedProfileCount: contextChange.affectedProfileIds.size,
        profileAffectedEntityCount: profileAffectedEntityIds.size,
        targetEntityCount: targetEntityIds.size,
        errorCount: result?.length ?? 0,
        rawErrorCount: partialErrors?.length ?? 0,
        cachedEntityErrorCount: this.previousErrorsByEntity.size,
        compiledRuleCacheSize: this.compiledRuleCache.size,
        contextChanged: contextChange.changed,
        forceFullContext: contextChange.forceFull,
        hasPreviousState,
      });

      return result;
    } finally {
      if (this.activeValidationController === controller) {
        this.activeValidationController = undefined;
      }
    }
  }

  async validateEntitiesFull(
    crate: Record<string, any>,
    baseProfile: Record<string, any>,
  ): Promise<ValidationError[] | undefined> {
    const totalStartedAt = this.nowMs();
    const graphEntityCount = this.getGraphEntityCount(crate);

    if (!crate || !Array.isArray(crate['@graph']) || !baseProfile) {
      this.previousEntityHashes.clear();
      this.previousErrorsByEntity.clear();
      this.compiledRuleCache.clear();
      this.lastRunMode = 'full';
      this.logValidationPerf('validateEntitiesFull', {
        mode: 'skipped',
        reason: 'missing-crate-graph-or-profile',
        totalMs: this.roundMs(this.nowMs() - totalStartedAt),
        graphEntityCount,
      });
      return undefined;
    }

    const profileList = this.appStateService.profileList;
    const completeProfile = this.appStateService.completeProfile;
    const contextStartedAt = this.nowMs();
    this.refreshValidationContext(baseProfile, profileList, completeProfile);
    const contextMs = this.nowMs() - contextStartedAt;

    const collectHashesStartedAt = this.nowMs();
    const currentHashes = this.collectEntityHashes(crate);
    const collectHashesMs = this.nowMs() - collectHashesStartedAt;

    this.abortActiveFullSweep();
    const controller = new AbortController();
    this.activeFullSweepController = controller;

    try {
      const validationStartedAt = this.nowMs();
      const fullErrors = await runEntityValidation(
        crate,
        baseProfile,
        profileList,
        this.schemaManagerService,
        {
          signal: controller.signal,
          yieldEvery: 75,
          compiledRuleCache: this.compiledRuleCache,
          cacheNamespace: this.getCacheNamespace(),
          completeProfile,
        },
      );
      const runEntityValidationMs = this.nowMs() - validationStartedAt;

      this.lastRunMode = 'full';
      const applyStartedAt = this.nowMs();
      const result = this.applyFullResult(fullErrors, currentHashes);
      const applyResultMs = this.nowMs() - applyStartedAt;

      this.logValidationPerf('validateEntitiesFull', {
        mode: this.lastRunMode,
        totalMs: this.roundMs(this.nowMs() - totalStartedAt),
        contextMs: this.roundMs(contextMs),
        collectHashesMs: this.roundMs(collectHashesMs),
        runEntityValidationMs: this.roundMs(runEntityValidationMs),
        applyResultMs: this.roundMs(applyResultMs),
        graphEntityCount,
        currentEntityCount: currentHashes.size,
        targetEntityCount: currentHashes.size,
        errorCount: result?.length ?? 0,
        rawErrorCount: fullErrors?.length ?? 0,
        cachedEntityErrorCount: this.previousErrorsByEntity.size,
        compiledRuleCacheSize: this.compiledRuleCache.size,
      });

      return result;
    } finally {
      if (this.activeFullSweepController === controller) {
        this.activeFullSweepController = undefined;
      }
    }
  }

  validate(entity: Record<string, any>, profile: Record<string, any>): ValidationError[] {
    return validate(entity, profile);
  }
}
