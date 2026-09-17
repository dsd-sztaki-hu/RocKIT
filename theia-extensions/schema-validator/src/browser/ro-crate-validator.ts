// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { MetadataSchemaManager } from "rockit-common/lib/browser";
import { isMissingRoCrateEntityName } from "rockit-common/lib/common/ro-crate-entity-name";
import type { AppState } from 'app-state/lib/browser/state/app-state';

export type ValidationError = {
  path: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  fieldLabel: string;
  error: string;
  error_hu: string;
  errorCode: string;
};

export type CompiledInputRule = {
  name: string;
  fieldLabel: string;
  required: boolean;
  multiple: boolean;
  inputType: string;
  values: any[];
  minValue?: number;
  maxValue?: number;
  minLength?: number;
  maxLength?: number;
  regex?: RegExp;
  regexSource?: string;
};

export type ValidationRunOptions = {
  targetEntityIds?: Set<string>;
  signal?: AbortSignal;
  yieldEvery?: number;
  compiledRuleCache?: Map<string, CompiledInputRule[]>;
  cacheNamespace?: string;
  completeProfile?: Record<string, any>;
};

function createAbortError(): Error {
  const error = new Error('Validation aborted');
  (error as any).name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function maybeYield(
  processedCount: number,
  yieldEvery: number,
  signal?: AbortSignal,
): Promise<void> {
  if (yieldEvery <= 0 || processedCount % yieldEvery !== 0) {
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(signal);
}

function normalizeEntityId(entity: Record<string, any>, index: number): string {
  const id = entity?.['@id'];
  if (typeof id === 'string' && id.trim().length > 0) {
    return id.trim();
  }
  return `__index:${index}`;
}

function normalizeEntityType(entity: Record<string, any>): string {
  const entityType = Array.isArray(entity['@type']) ? entity['@type'][0] : entity['@type'];
  return typeof entityType === 'string' ? entityType.trim() : '';
}

function isFileOrDatasetEntity(entity: Record<string, any>): boolean {
  const rawTypes = entity?.['@type'];
  const types = Array.isArray(rawTypes) ? rawTypes : [rawTypes];
  return types
    .map((type) => String(type ?? '').split(/[\/#]/).pop() || '')
    .map((type) => type.toLowerCase())
    .some((type) => type === 'file' || type === 'dataset');
}

function toCacheKey(entityType: string, conformsToIds: string[]): string {
  return `${entityType.toLowerCase()}|${conformsToIds.join('|')}`;
}

function errorFor(
  entity: Record<string, any>,
  entityType: string,
  fieldName: string,
  fieldLabel: string,
  error: string,
  error_hu: string,
  errorCode: string,
): ValidationError {
  return {
    path: `$.@graph[${entity['@id']}].${fieldName}`,
    entityId: `${entity['@id']}`,
    entityType: `${entityType}`,
    fieldName: `${fieldName}`,
    fieldLabel: `${fieldLabel}`,
    error,
    error_hu,
    errorCode,
  };
}

function compileRulesForEntityType(
  entityType: string,
  profile: Record<string, any>,
): CompiledInputRule[] {
  if (!entityType) {
    return [];
  }

  const profileClass = profile?.classes?.[entityType];
  if (!profileClass || !Array.isArray(profileClass.inputs)) {
    return [];
  }

  const compiled: CompiledInputRule[] = [];
  for (const input of profileClass.inputs) {
    if (!input || typeof input !== 'object') {
      continue;
    }

    const name = typeof input.name === 'string' ? input.name : String(input.name ?? '');
    if (!name) {
      continue;
    }
    const fieldLabel = input.label ? String(input.label) : name;
    const inputType = Array.isArray(input.type) && input.type.length > 0
      ? String(input.type[0])
      : '';

    let regex: RegExp | undefined;
    const regexSource = input.regex !== undefined ? String(input.regex) : undefined;
    if (regexSource) {
      try {
        regex = new RegExp(regexSource);
      } catch (error) {
        console.warn('Invalid regex in profile input:', { name, regexSource, error });
      }
    }

    compiled.push({
      name,
      fieldLabel,
      required: Boolean(input.required),
      multiple: Boolean(input.multiple),
      inputType,
      values: Array.isArray(input.values) ? input.values : [],
      minValue: input.minValue,
      maxValue: input.maxValue,
      minLength: input.minLength,
      maxLength: input.maxLength,
      regex,
      regexSource,
    });
  }

  return compiled;
}

function validateWithCompiledRules(
  entity: Record<string, any>,
  entityType: string,
  rules: CompiledInputRule[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (rules.length === 0) {
    return errors;
  }

  for (const rule of rules) {
    const { name, required, multiple, inputType, values } = rule;
    const rawFieldValue = entity[name];
    const fieldValue =
      !multiple && Array.isArray(rawFieldValue) && inputType === 'URL'
        ? rawFieldValue[0]
        : rawFieldValue;

    if (required) {
      if (
        fieldValue === undefined ||
        fieldValue === null ||
        (typeof fieldValue === 'string' && fieldValue.trim().length === 0) ||
        (Array.isArray(fieldValue) && fieldValue.length === 0)
      ) {
        errors.push(
          errorFor(
            entity,
            entityType,
            name,
            rule.fieldLabel,
            'Required value not set',
            'Kötelező érték nincs beállítva',
            'REQUIRED_NOT_SET',
          ),
        );
      }
    }

    if (!multiple) {
      if (Array.isArray(rawFieldValue) && inputType !== 'URL') {
        errors.push(
          errorFor(
            entity,
            entityType,
            name,
            rule.fieldLabel,
            'Multiple value set',
            'Többszörös érték van beállítva',
            'SINGLE_VALUE_REQUIRED',
          ),
        );
      }
    }

    if (['Select', 'SelectURL', 'SelectObject'].includes(inputType) && required) {
      const fieldValues = Array.isArray(entity[name]) ? entity[name] : [entity[name]];
      for (const value of fieldValues) {
        if (value && !values.includes(value)) {
          errors.push(
            errorFor(
              entity,
              `${entity['@type']}`,
              name,
              rule.fieldLabel,
              'Wrong value set',
              'Hibás érték van beállítva',
              'WRONG_VALUE_SET',
            ),
          );
        }
      }
    }

    if (inputType === 'Number') {
      const fieldValues = Array.isArray(entity[name]) ? entity[name].map(Number) : [Number(entity[name])];
      for (const value of fieldValues) {
        if (value && rule.minValue !== undefined && rule.minValue > value) {
          errors.push(
            errorFor(
              entity,
              `${entity['@type']}`,
              name,
              rule.fieldLabel,
              `Wrong value set, the minimum value is ${rule.minValue}`,
              `Hibás érték van beállítva, a minimum érték ${rule.minValue}`,
              'WRONG_VALUE_SET',
            ),
          );
        }

        if (value && rule.maxValue !== undefined && rule.maxValue < value) {
          errors.push(
            errorFor(
              entity,
              `${entity['@type']}`,
              name,
              rule.fieldLabel,
              `Wrong value set, the maximum value is ${rule.maxValue}`,
              `Hibás érték van beállítva, a maximum érték ${rule.maxValue}`,
              'WRONG_VALUE_SET',
            ),
          );
        }
      }
    }

    if (inputType === 'Text') {
      const valuesToCheck = Array.isArray(entity[name]) ? entity[name] : [entity[name]];
      for (const value of valuesToCheck) {
        if (rule.minLength !== undefined && value && rule.minLength > value.length) {
          errors.push(
            errorFor(
              entity,
              `${entity['@type']}`,
              name,
              rule.fieldLabel,
              `Wrong value set, the minimum length is ${rule.minLength} character`,
              `Hibás érték van beállítva, a minimum hossz ${rule.minLength} karakter`,
              'WRONG_VALUE_SET',
            ),
          );
        }

        if (rule.maxLength !== undefined && value && rule.maxLength < value.length) {
          errors.push(
            errorFor(
              entity,
              `${entity['@type']}`,
              name,
              rule.fieldLabel,
              `Wrong value set, the maximum length is ${rule.maxLength} character`,
              `Hibás érték van beállítva, a maximum hossz ${rule.maxLength} karakter`,
              'WRONG_VALUE_SET',
            ),
          );
        }

        if (rule.regex && value) {
          rule.regex.lastIndex = 0;
          if (!rule.regex.test(value)) {
            errors.push(
              errorFor(
                entity,
                `${entity['@type']}`,
                name,
                rule.fieldLabel,
                `Wrong value set, the text does not match the given regexp ${rule.regexSource}`,
                `Hibás érték van beállítva, a szöveg nem felel meg a megadott reguláris kifejezésnek ${rule.regexSource}`,
                'WRONG_VALUE_SET',
              ),
            );
          }
        }
      }
    }
  }

  return errors;
}

function ensureRequiredEntityNameError(
  entity: Record<string, any>,
  entityType: string,
  errors: ValidationError[],
): ValidationError[] {
  if (!isMissingRoCrateEntityName(entity.name)) {
    return errors;
  }
  if (
    errors.some(
      error => error.fieldName === 'name' && error.errorCode === 'REQUIRED_NOT_SET',
    )
  ) {
    return errors;
  }
  return [
    errorFor(
      entity,
      entityType,
      'name',
      'Name',
      'Required value not set',
      'Kötelező érték nincs beállítva',
      'REQUIRED_NOT_SET',
    ),
    ...errors,
  ];
}

function extractConformsToIds(entity: Record<string, any>): string[] {
  const value: any = entity?.conformsTo;
  const ids: string[] = [];
  const pushId = (val: any) => {
    if (!val) return;
    if (typeof val === 'string') {
      const t = val.trim();
      if (t) ids.push(t);
      return;
    }
    if (typeof val === 'object') {
      const idVal = (val as any)['@id'] ?? (val as any).id;
      if (typeof idVal === 'string') {
        const t = idVal.trim();
        if (t) ids.push(t);
      }
    }
  };
  if (Array.isArray(value)) {
    for (const v of value) pushId(v);
  } else {
    pushId(value);
  }
  return Array.from(new Set(ids));
}

export async function validateEntities(
  crate: Record<string, any>,
  baseProfile: Record<string, any>,
  profileList: AppState['profileList'],
  schemaManagerService: MetadataSchemaManager,
  options: ValidationRunOptions = {},
) {
  throwIfAborted(options.signal);

  if (!crate || !Array.isArray(crate['@graph'])) {
    return undefined;
  }

  const clone = (value: any) => {
    const sc: any = (globalThis as any).structuredClone;
    if (typeof sc === 'function') {
      return sc(value);
    }
    return JSON.parse(JSON.stringify(value));
  };

  const profileCache = new Map<string, Record<string, any>>();
  const validationErrors: ValidationError[] = [];
  const graph = crate['@graph'] as any[];
  const profileById = new Map<string, any>();
  for (const profileEntry of profileList ?? []) {
    const id = typeof profileEntry?.id === 'string' ? profileEntry.id.trim() : '';
    if (!id) {
      continue;
    }
    profileById.set(id, profileEntry?.content);
  }

  const warnedMissingProfileUrls = new Set<string>();
  let processedCount = 0;
  const validationEntries: any[] = [];
  const targetEntityIds = options.targetEntityIds;

  if (targetEntityIds && targetEntityIds.size > 0) {
    const foundTargetIds = new Set<string>();
    for (let index = 0; index < graph.length; index += 1) {
      const entity = graph[index];
      if (!entity || typeof entity !== 'object') {
        continue;
      }

      const entityId = normalizeEntityId(entity, index);
      if (!targetEntityIds.has(entityId)) {
        continue;
      }

      validationEntries.push(entity);
      foundTargetIds.add(entityId);
      if (foundTargetIds.size >= targetEntityIds.size) {
        break;
      }
    }
  } else {
    for (let index = 0; index < graph.length; index += 1) {
      validationEntries.push(graph[index]);
    }
  }

  for (const entity of validationEntries) {
    throwIfAborted(options.signal);
    if (!entity || typeof entity !== 'object') {
      continue;
    }

    processedCount += 1;
    await maybeYield(processedCount, options.yieldEvery ?? 0, options.signal);

    const entityType = normalizeEntityType(entity);
    const conformsToIds = extractConformsToIds(entity).slice().sort();
    const cacheKey = toCacheKey(entityType, conformsToIds);
    const namespacedKey = options.cacheNamespace ? `${options.cacheNamespace}|${cacheKey}` : cacheKey;

    let compiledRules = options.compiledRuleCache?.get(namespacedKey);

    if (!compiledRules) {
      const cachedProfile = profileCache.get(cacheKey);
      let profileForEntity: Record<string, any> = cachedProfile ?? baseProfile;
      if (!cachedProfile) {
        if (conformsToIds.length > 0) {
          let updatedProfile = clone(baseProfile);
          for (const conformsToUrl of conformsToIds) {
            throwIfAborted(options.signal);
            const normalizedConformsToUrl = conformsToUrl.trim();
            const convertedContent = profileById.get(normalizedConformsToUrl);
            if (!convertedContent) {
              if (!warnedMissingProfileUrls.has(normalizedConformsToUrl)) {
                warnedMissingProfileUrls.add(normalizedConformsToUrl);
                console.warn('No profile found in state for conformsTo URL:', normalizedConformsToUrl);
              }
              continue;
            }
            try {
              updatedProfile = await schemaManagerService.getMergedProfile(
                crate,
                convertedContent,
                updatedProfile,
                conformsToUrl,
              );
            } catch (error) {
              console.warn('Failed to merge profile for conformsTo URL:', conformsToUrl, error);
            }
          }
          profileForEntity = updatedProfile;
        } else if (options.completeProfile && !isFileOrDatasetEntity(entity)) {
          profileForEntity = options.completeProfile;
        } else {
          profileForEntity = baseProfile;
        }
        profileCache.set(cacheKey, profileForEntity);
      }

      compiledRules = compileRulesForEntityType(entityType, profileForEntity);
      if (options.compiledRuleCache) {
        options.compiledRuleCache.set(namespacedKey, compiledRules);
      }
    }

    const errors = ensureRequiredEntityNameError(
      entity,
      entityType,
      validateWithCompiledRules(entity, entityType, compiledRules),
    );
    if (errors.length) {
      validationErrors.push(...errors);
    }
  }

  const result = validationErrors.length !== 0 ? validationErrors : undefined;
  return result;
}

export function validate(entity: Record<string, any>, profile: Record<string, any>) {
  const entityType = normalizeEntityType(entity);
  const rules = compileRulesForEntityType(entityType, profile);
  return ensureRequiredEntityNameError(
    entity,
    entityType,
    validateWithCompiledRules(entity, entityType, rules),
  );
}
