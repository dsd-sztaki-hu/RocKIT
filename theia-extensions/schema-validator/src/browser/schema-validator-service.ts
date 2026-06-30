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

  protected refreshValidationContext(
    baseProfile: Record<string, any>,
    profileList: any,
    completeProfile: Record<string, any> | undefined,
  ): boolean {
    const changed =
      this.lastBaseProfileRef !== baseProfile ||
      this.lastProfileListRef !== profileList ||
      this.lastCompleteProfileRef !== completeProfile;

    if (!changed) {
      return false;
    }

    this.contextRevision += 1;
    this.lastBaseProfileRef = baseProfile;
    this.lastProfileListRef = profileList;
    this.lastCompleteProfileRef = completeProfile;
    this.previousEntityHashes.clear();
    this.previousErrorsByEntity.clear();
    this.compiledRuleCache.clear();
    return true;
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

  async validateEntities(
    crate: Record<string, any>,
    baseProfile: Record<string, any>,
  ): Promise<ValidationError[] | undefined> {
    if (!crate || !Array.isArray(crate['@graph']) || !baseProfile) {
      this.previousEntityHashes.clear();
      this.previousErrorsByEntity.clear();
      this.compiledRuleCache.clear();
      this.lastRunMode = 'full';
      return undefined;
    }

    const profileList = this.appStateService.profileList;
    const completeProfile = this.appStateService.completeProfile;
    const contextChanged = this.refreshValidationContext(baseProfile, profileList, completeProfile);
    const currentHashes = this.collectEntityHashes(crate);

    const hasPreviousState = this.previousEntityHashes.size > 0;
    const { changedIds, removedIds } = this.computeDiff(currentHashes);

    if (!contextChanged && hasPreviousState && changedIds.size === 0 && removedIds.size === 0) {
      this.lastRunMode = 'cached';
      const cached = this.flattenErrorMap(this.previousErrorsByEntity);
      return cached.length ? cached : undefined;
    }

    this.abortActiveValidation();
    this.abortActiveFullSweep();

    const controller = new AbortController();
    this.activeValidationController = controller;

    try {
      const shouldRunFull =
        contextChanged ||
        !hasPreviousState ||
        changedIds.size > Math.max(50, Math.floor(currentHashes.size * 0.6));

      if (shouldRunFull) {
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

        this.lastRunMode = 'full';
        return this.applyFullResult(fullErrors, currentHashes);
      }

      const targetEntityIds = new Set<string>();
      for (const id of changedIds) {
        if (currentHashes.has(id)) {
          targetEntityIds.add(id);
        }
      }

      let partialErrors: ValidationError[] | undefined = undefined;
      if (targetEntityIds.size > 0) {
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
      }

      this.lastRunMode = 'incremental';
      return this.applyIncrementalResult(changedIds, removedIds, partialErrors, currentHashes);
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
    if (!crate || !Array.isArray(crate['@graph']) || !baseProfile) {
      this.previousEntityHashes.clear();
      this.previousErrorsByEntity.clear();
      this.compiledRuleCache.clear();
      this.lastRunMode = 'full';
      return undefined;
    }

    const profileList = this.appStateService.profileList;
    const completeProfile = this.appStateService.completeProfile;
    this.refreshValidationContext(baseProfile, profileList, completeProfile);
    const currentHashes = this.collectEntityHashes(crate);

    this.abortActiveFullSweep();
    const controller = new AbortController();
    this.activeFullSweepController = controller;

    try {
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

      this.lastRunMode = 'full';
      return this.applyFullResult(fullErrors, currentHashes);
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
