// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { RoCrate, RoCrateEntity } from '../core/types'
import type {
  AccessMode,
  ProfileConstraints,
  ProfileRequiredMode,
  ProfileResolutionInputs,
  ProfileRuleSet,
  ProfileValidationOptions,
} from './types'

type ProfileValidationDeps = {
  baseAllowedProperties: Set<string>
  defaultContextKnownTerms: Set<string>
  externalContextCoverageUrls: Set<string>
  rocrateConformsToUrl: string
  entityTypes: (entity: RoCrateEntity) => string[]
  extractConformsToUrls: (value: unknown) => string[]
  collectProfileTargetsByUrl: (crate: RoCrate) => Record<string, string[]>
  resolveProfileUrls: (
    profileUrls: string[],
    mode: AccessMode,
    includeProfileContent: boolean,
    inputs: ProfileResolutionInputs,
  ) => ProfileConstraints['resolution']
  collectDeclaredContextTerms: (crate: RoCrate) => Set<string>
  buildContextTermSuggestion: (
    crate: RoCrate,
    constraints?: ProfileConstraints,
  ) => { missingTerms: string[]; unknownTerms: string[] }
}

/**
 * Builds helpers that derive profile constraints and validate crate entities
 * against those constraints (types, allowed properties, required properties).
 */
export function createProfileValidationHelpers(deps: ProfileValidationDeps) {
  /**
   * Handles collect context urls.
   */
  function collectContextUrls(crate: RoCrate): Set<string> {
    const urls = new Set<string>()
    const context = crate['@context']
    const collect = (value: unknown): void => {
      if (typeof value === 'string' && value.trim() !== '') {
        urls.add(value.trim())
      }
    }
    if (Array.isArray(context)) {
      for (const item of context) {
        collect(item)
      }
      return urls
    }
    collect(context)
    return urls
  }

  /**
   * Handles has external context coverage.
   */
  function hasExternalContextCoverage(crate: RoCrate): boolean {
    const contextUrls = collectContextUrls(crate)
    for (const url of contextUrls) {
      if (deps.externalContextCoverageUrls.has(url)) {
        return true
      }
    }
    return false
  }

  /**
   * Handles collect term usage profile scope.
   */
  function collectTermUsageProfileScope(
    crate: RoCrate,
  ): Map<string, { profiled: boolean; unprofiled: boolean }> {
    const usage = new Map<string, { profiled: boolean; unprofiled: boolean }>()
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      const types = deps.entityTypes(entity)
      const isDatasetOrFile = types.includes('Dataset') || types.includes('File')
      if (!isDatasetOrFile) {
        continue
      }
      const profileUrls = deps.extractConformsToUrls(entity.conformsTo).filter(
        (url) => url !== deps.rocrateConformsToUrl,
      )
      const scope: 'profiled' | 'unprofiled' =
        profileUrls.length > 0 ? 'profiled' : 'unprofiled'
      for (const key of Object.keys(entity)) {
        if (key.startsWith('@')) {
          continue
        }
        const current = usage.get(key) ?? { profiled: false, unprofiled: false }
        if (scope === 'profiled') {
          current.profiled = true
        } else {
          current.unprofiled = true
        }
        usage.set(key, current)
      }
    }
    return usage
  }

  /**
   * Handles extract allowed properties from class.
   */
  function extractAllowedPropertiesFromClass(profileClass: unknown): Set<string> {
    const allowed = new Set<string>()
    if (!profileClass || typeof profileClass !== 'object' || Array.isArray(profileClass)) {
      return allowed
    }
    const inputs = (profileClass as Record<string, unknown>).inputs
    if (!Array.isArray(inputs)) {
      return allowed
    }
    for (const input of inputs) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        continue
      }
      const name = (input as Record<string, unknown>).name
      if (typeof name === 'string' && name.trim() !== '') {
        allowed.add(name.trim())
      }
    }
    return allowed
  }

  /**
   * Handles extract class inputs.
   */
  function extractInputsFromClass(profileClass: unknown): Record<string, unknown>[] {
    if (!profileClass || typeof profileClass !== 'object' || Array.isArray(profileClass)) {
      return []
    }
    const inputs = (profileClass as Record<string, unknown>).inputs
    if (!Array.isArray(inputs)) {
      return []
    }
    return inputs.filter(
      (input): input is Record<string, unknown> =>
        !!input && typeof input === 'object' && !Array.isArray(input),
    )
  }

  /**
   * Handles extract required properties from class.
   */
  function extractRequiredPropertiesFromClass(profileClass: unknown): Set<string> {
    const required = new Set<string>()
    if (profileClass && typeof profileClass === 'object' && !Array.isArray(profileClass)) {
      const requiredValue = (profileClass as Record<string, unknown>).required
      if (Array.isArray(requiredValue)) {
        for (const entry of requiredValue) {
          if (typeof entry !== 'string') {
            continue
          }
          const trimmed = entry.trim()
          if (trimmed !== '') {
            required.add(trimmed)
          }
        }
      }
    }
    for (const input of extractInputsFromClass(profileClass)) {
      if (input.required !== true) {
        continue
      }
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (name !== '') {
        required.add(name)
      }
    }
    return required
  }

  /**
   * Handles extract profile-declared property target types.
   */
  function extractPropertyTypesFromClass(profileClass: unknown): Map<string, Set<string>> {
    const propertyTypes = new Map<string, Set<string>>()
    for (const input of extractInputsFromClass(profileClass)) {
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (name === '') {
        continue
      }
      const types = input.type
      if (!Array.isArray(types)) {
        continue
      }
      const normalizedTypes = types
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
      if (normalizedTypes.length === 0) {
        continue
      }
      propertyTypes.set(name, new Set<string>(normalizedTypes))
    }
    return propertyTypes
  }

  /**
   * Handles extract value sets from class inputs.
   *
   * Supports profile inputs that declare explicit enumerated choices in `values`.
   */
  function extractValueSetsFromClass(profileClass: unknown): Map<string, Set<string>> {
    const valueSets = new Map<string, Set<string>>()
    if (!profileClass || typeof profileClass !== 'object' || Array.isArray(profileClass)) {
      return valueSets
    }
    const inputs = (profileClass as Record<string, unknown>).inputs
    if (!Array.isArray(inputs)) {
      return valueSets
    }
    for (const input of inputs) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        continue
      }
      const inputRecord = input as Record<string, unknown>
      const name = typeof inputRecord.name === 'string' ? inputRecord.name.trim() : ''
      if (name === '') {
        continue
      }
      const values = inputRecord.values
      if (!Array.isArray(values) || values.length === 0) {
        continue
      }
      const normalizedValues = values
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
      if (normalizedValues.length === 0) {
        continue
      }
      valueSets.set(name, new Set<string>(normalizedValues))
    }
    return valueSets
  }

  /**
   * Resolves active profile URLs, then aggregates class/property rules.
   *
   * The result includes both:
   * - global merged constraints across profiles
   * - per-profile rule sets (for targeted checks)
   */
  function buildProfileConstraints(
    crate: RoCrate,
    mode: AccessMode,
    inputs: ProfileResolutionInputs = {},
  ): ProfileConstraints {
    const profileUrls = Object.keys(deps.collectProfileTargetsByUrl(crate))
    const resolution = deps.resolveProfileUrls(profileUrls, mode, true, inputs)

    const rulesByProfileUrl = new Map<string, ProfileRuleSet>()
    const allowedClasses = new Set<string>()
    const allowedPropertiesByClass = new Map<string, Set<string>>()
    const requiredPropertiesByClass = new Map<string, Set<string>>()
    const propertyTypesByClass = new Map<string, Map<string, Set<string>>>()
    const valueSetsByClass = new Map<string, Map<string, Set<string>>>()

    for (const profile of resolution.profiles) {
      if (!profile.loaded || !profile.profile || !profile.conformsTo) {
        continue
      }
      const classes = profile.profile.classes
      if (!classes || typeof classes !== 'object' || Array.isArray(classes)) {
        continue
      }
      const profileRuleSet: ProfileRuleSet = {
        allowedClasses: new Set<string>(),
        allowedPropertiesByClass: new Map<string, Set<string>>(),
        requiredPropertiesByClass: new Map<string, Set<string>>(),
        propertyTypesByClass: new Map<string, Map<string, Set<string>>>(),
        valueSetsByClass: new Map<string, Map<string, Set<string>>>(),
      }

      for (const [className, classValue] of Object.entries(
        classes as Record<string, unknown>,
      )) {
        if (className.trim() === '') {
          continue
        }
        const trimmedClassName = className.trim()
        profileRuleSet.allowedClasses.add(trimmedClassName)
        allowedClasses.add(trimmedClassName)

        const classAllowed = extractAllowedPropertiesFromClass(classValue)
        profileRuleSet.allowedPropertiesByClass.set(trimmedClassName, classAllowed)

        const globalAllowed =
          allowedPropertiesByClass.get(trimmedClassName) ?? new Set<string>()
        for (const propertyName of classAllowed) {
          globalAllowed.add(propertyName)
        }
        allowedPropertiesByClass.set(trimmedClassName, globalAllowed)

        const classRequired = extractRequiredPropertiesFromClass(classValue)
        profileRuleSet.requiredPropertiesByClass.set(trimmedClassName, classRequired)

        const globalRequired =
          requiredPropertiesByClass.get(trimmedClassName) ?? new Set<string>()
        for (const propertyName of classRequired) {
          globalRequired.add(propertyName)
        }
        requiredPropertiesByClass.set(trimmedClassName, globalRequired)

        const classPropertyTypes = extractPropertyTypesFromClass(classValue)
        profileRuleSet.propertyTypesByClass.set(trimmedClassName, classPropertyTypes)

        const globalPropertyTypes =
          propertyTypesByClass.get(trimmedClassName) ?? new Map<string, Set<string>>()
        for (const [propertyName, types] of classPropertyTypes.entries()) {
          const globalTypes = globalPropertyTypes.get(propertyName) ?? new Set<string>()
          for (const type of types) {
            globalTypes.add(type)
          }
          globalPropertyTypes.set(propertyName, globalTypes)
        }
        propertyTypesByClass.set(trimmedClassName, globalPropertyTypes)

        const classValueSets = extractValueSetsFromClass(classValue)
        profileRuleSet.valueSetsByClass.set(trimmedClassName, classValueSets)

        const globalClassValueSets =
          valueSetsByClass.get(trimmedClassName) ?? new Map<string, Set<string>>()
        for (const [propertyName, values] of classValueSets.entries()) {
          const globalValues = globalClassValueSets.get(propertyName) ?? new Set<string>()
          for (const value of values) {
            globalValues.add(value)
          }
          globalClassValueSets.set(propertyName, globalValues)
        }
        valueSetsByClass.set(trimmedClassName, globalClassValueSets)
      }

      const existing = rulesByProfileUrl.get(profile.conformsTo)
      if (!existing) {
        rulesByProfileUrl.set(profile.conformsTo, profileRuleSet)
      } else {
        for (const cls of profileRuleSet.allowedClasses) {
          existing.allowedClasses.add(cls)
        }
        for (const [className, props] of profileRuleSet.allowedPropertiesByClass.entries()) {
          const current = existing.allowedPropertiesByClass.get(className) ?? new Set<string>()
          for (const prop of props) {
            current.add(prop)
          }
          existing.allowedPropertiesByClass.set(className, current)
        }
        for (const [className, props] of profileRuleSet.requiredPropertiesByClass.entries()) {
          const current = existing.requiredPropertiesByClass.get(className) ?? new Set<string>()
          for (const prop of props) {
            current.add(prop)
          }
          existing.requiredPropertiesByClass.set(className, current)
        }
        for (const [className, classPropertyTypes] of profileRuleSet.propertyTypesByClass.entries()) {
          const currentClassPropertyTypes =
            existing.propertyTypesByClass.get(className) ?? new Map<string, Set<string>>()
          for (const [propertyName, types] of classPropertyTypes.entries()) {
            const currentTypes = currentClassPropertyTypes.get(propertyName) ?? new Set<string>()
            for (const type of types) {
              currentTypes.add(type)
            }
            currentClassPropertyTypes.set(propertyName, currentTypes)
          }
          existing.propertyTypesByClass.set(className, currentClassPropertyTypes)
        }
        for (const [className, classValueSets] of profileRuleSet.valueSetsByClass.entries()) {
          const currentClassValueSets =
            existing.valueSetsByClass.get(className) ?? new Map<string, Set<string>>()
          for (const [propertyName, values] of classValueSets.entries()) {
            const currentValues = currentClassValueSets.get(propertyName) ?? new Set<string>()
            for (const value of values) {
              currentValues.add(value)
            }
            currentClassValueSets.set(propertyName, currentValues)
          }
          existing.valueSetsByClass.set(className, currentClassValueSets)
        }
      }
    }

    return {
      resolution,
      rulesByProfileUrl,
      allowedClasses,
      allowedPropertiesByClass,
      requiredPropertiesByClass,
      propertyTypesByClass,
      valueSetsByClass,
    }
  }

  /**
   * Handles has meaningful value.
   */
  function hasMeaningfulValue(value: unknown): boolean {
    if (typeof value === 'string') {
      return value.trim() !== ''
    }
    if (Array.isArray(value)) {
      return value.some((item) => hasMeaningfulValue(item))
    }
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>).length > 0
    }
    return value !== null && value !== undefined
  }

  /**
   * Handles get best name candidate.
   */
  function getBestNameCandidate(entity: RoCrateEntity): string | undefined {
    const preferredFields = [
      'name',
      'title',
      'description',
      'identifier',
      'alternateName',
      'displayName',
      'headline',
      'label',
      'datasetName',
      'resourceName',
      'fileName',
      'licenseName',
      'datasetContactName',
      'contributorName',
      'producerName',
      'distributorName',
      'publicationCitation',
      'title',
    ]
    for (const key of preferredFields) {
      const value = entity[key]
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim()
      }
    }
    return undefined
  }

  /**
   * Validates crate entities against resolved profile constraints.
   *
   * Reports:
   * - profile resolution/load failures
   * - disallowed classes
   * - custom properties outside active profile/schema rules (warnings)
   * - missing required properties (mode-dependent)
   * - missing/unknown @context term issues (via reconciliation suggestions)
   */
  function validateCrateAgainstProfileConstraints(
    crate: RoCrate,
    constraints: ProfileConstraints,
    options: { requiredMode: ProfileRequiredMode } = { requiredMode: 'allow_missing' },
  ): {
    valid: boolean
    errors: string[]
    warnings: string[]
    valueSetHints: Record<string, string[]>
    valueSetViolations: Array<{
      entityId: string
      entityType: string
      property: string
      invalidValues: string[]
      allowedValues: string[]
    }>
  } {
    const errors: string[] = []
    const warnings = [...constraints.resolution.warnings]
    const valueSetHints = new Map<string, Set<string>>()
    const valueSetViolations: Array<{
      entityId: string
      entityType: string
      property: string
      invalidValues: string[]
      allowedValues: string[]
    }> = []
    const hasAnyProfileTargets = constraints.resolution.profileUrls.length > 0
    if (hasAnyProfileTargets && constraints.resolution.unresolvedUrls.length > 0) {
      const message = `No schema profile mapping found for conformsTo URL(s): ${constraints.resolution.unresolvedUrls.join(', ')}`
      if (
        constraints.resolution.mode === 'remote' &&
        !constraints.resolution.inputProvided
      ) {
        warnings.push(message)
      } else {
        errors.push(message)
      }
    }
    const failedProfiles = constraints.resolution.profiles.filter((profile) => !profile.loaded)
    if (hasAnyProfileTargets && failedProfiles.length > 0) {
      const message = `Failed to load converted profile(s): ${failedProfiles
        .map((profile) => profile.loadError ?? profile.id)
        .join('; ')}`
      if (
        constraints.resolution.mode === 'remote' &&
        !constraints.resolution.inputProvided
      ) {
        warnings.push(message)
      } else {
        errors.push(message)
      }
    }
    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        warnings,
        valueSetHints: {},
        valueSetViolations: [],
      }
    }

    const declaredContextTerms = deps.collectDeclaredContextTerms(crate)
    const externalContextCoverage = hasExternalContextCoverage(crate)
    const termUsageByScope = collectTermUsageProfileScope(crate)
    const isKnownContextTerm = (term: string): boolean =>
      declaredContextTerms.has(term) ||
      deps.defaultContextKnownTerms.has(term) ||
      externalContextCoverage

    const mergeRuleSets = (profileUrls: string[]): ProfileRuleSet => {
      const merged: ProfileRuleSet = {
        allowedClasses: new Set<string>(),
        allowedPropertiesByClass: new Map<string, Set<string>>(),
        requiredPropertiesByClass: new Map<string, Set<string>>(),
        propertyTypesByClass: new Map<string, Map<string, Set<string>>>(),
        valueSetsByClass: new Map<string, Map<string, Set<string>>>(),
      }
      for (const profileUrl of profileUrls) {
        const ruleSet = constraints.rulesByProfileUrl.get(profileUrl)
        if (!ruleSet) {
          continue
        }
        for (const cls of ruleSet.allowedClasses) {
          merged.allowedClasses.add(cls)
        }
        for (const [className, props] of ruleSet.allowedPropertiesByClass.entries()) {
          const current = merged.allowedPropertiesByClass.get(className) ?? new Set<string>()
          for (const prop of props) {
            current.add(prop)
          }
          merged.allowedPropertiesByClass.set(className, current)
        }
        for (const [className, props] of ruleSet.requiredPropertiesByClass.entries()) {
          const current = merged.requiredPropertiesByClass.get(className) ?? new Set<string>()
          for (const prop of props) {
            current.add(prop)
          }
          merged.requiredPropertiesByClass.set(className, current)
        }
        for (const [className, classPropertyTypes] of ruleSet.propertyTypesByClass.entries()) {
          const currentClassPropertyTypes =
            merged.propertyTypesByClass.get(className) ?? new Map<string, Set<string>>()
          for (const [propertyName, types] of classPropertyTypes.entries()) {
            const currentTypes = currentClassPropertyTypes.get(propertyName) ?? new Set<string>()
            for (const type of types) {
              currentTypes.add(type)
            }
            currentClassPropertyTypes.set(propertyName, currentTypes)
          }
          merged.propertyTypesByClass.set(className, currentClassPropertyTypes)
        }
        for (const [className, classValueSets] of ruleSet.valueSetsByClass.entries()) {
          const currentClassValueSets =
            merged.valueSetsByClass.get(className) ?? new Map<string, Set<string>>()
          for (const [propertyName, values] of classValueSets.entries()) {
            const currentValues = currentClassValueSets.get(propertyName) ?? new Set<string>()
            for (const value of values) {
              currentValues.add(value)
            }
            currentClassValueSets.set(propertyName, currentValues)
          }
          merged.valueSetsByClass.set(className, currentClassValueSets)
        }
      }
      return merged
    }

    const collectStringValues = (value: unknown): string[] => {
      if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed === '' ? [] : [trimmed]
      }
      if (Array.isArray(value)) {
        return value.flatMap((entry) => collectStringValues(entry))
      }
      return []
    }

    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const entityById = new Map<string, RoCrateEntity>()
    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : ''
      if (entityId !== '') {
        entityById.set(entityId, entity as RoCrateEntity)
      }
    }

    const collectReferencedIds = (value: unknown): string[] => {
      if (!value) {
        return []
      }
      if (Array.isArray(value)) {
        return value.flatMap((entry) => collectReferencedIds(entry))
      }
      if (typeof value === 'object') {
        const id = (value as Record<string, unknown>)['@id']
        return typeof id === 'string' && id.trim() !== '' ? [id.trim()] : []
      }
      return []
    }

    const formatInvalidReferenceValue = (value: unknown): string => {
      if (typeof value === 'string') {
        return JSON.stringify(value)
      }
      if (value === null) {
        return 'null'
      }
      if (value === undefined) {
        return 'undefined'
      }
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }

    const collectInvalidReferenceValueDescriptions = (value: unknown): string[] => {
      if (!hasMeaningfulValue(value)) {
        return []
      }
      if (Array.isArray(value)) {
        return value.flatMap((entry) => collectInvalidReferenceValueDescriptions(entry))
      }
      if (value && typeof value === 'object') {
        const id = (value as Record<string, unknown>)['@id']
        return typeof id === 'string' && id.trim() !== ''
          ? []
          : [formatInvalidReferenceValue(value)]
      }
      return [formatInvalidReferenceValue(value)]
    }

    const addRequiredMessage = (message: string): void => {
      if (options.requiredMode === 'enforce_required') {
        errors.push(message)
      } else {
        warnings.push(message)
      }
    }

    const validatedEntities = new Set<string>()
    const validationQueue: Array<{
      entity: RoCrateEntity
      profileUrls: string[]
    }> = []

    const enqueueProfiledEntity = (
      entity: RoCrateEntity,
      profileUrls: string[],
    ): void => {
      const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : '<unknown>'
      const key = `${entityId}|${profileUrls.slice().sort().join('|')}`
      if (validatedEntities.has(key)) {
        return
      }
      validationQueue.push({ entity, profileUrls })
    }

    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      const types = deps.entityTypes(entity)
      const isDatasetOrFile = types.includes('Dataset') || types.includes('File')

      const entityProfileUrls = deps.extractConformsToUrls(entity.conformsTo).filter(
        (url) => url !== deps.rocrateConformsToUrl,
      )
      const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : '<unknown>'

      if (entityProfileUrls.length === 0) {
        if (isDatasetOrFile && !externalContextCoverage) {
          for (const key of Object.keys(entity)) {
            if (key.startsWith('@')) {
              continue
            }
            if (!isKnownContextTerm(key)) {
              errors.push(
                `Entity ${entityId} contains custom property without @context mapping: ${key}. ` +
                  'Add an inline @context mapping or reference a context URL that defines it.',
              )
            }
          }
        }
        continue
      }
      enqueueProfiledEntity(entity as RoCrateEntity, entityProfileUrls)
    }

    for (let queueIndex = 0; queueIndex < validationQueue.length; queueIndex += 1) {
      const { entity, profileUrls } = validationQueue[queueIndex]
      const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : '<unknown>'
      const validationKey = `${entityId}|${profileUrls.slice().sort().join('|')}`
      if (validatedEntities.has(validationKey)) {
        continue
      }
      validatedEntities.add(validationKey)

      const unresolvedEntityProfileUrls = profileUrls.filter(
        (url) => !constraints.rulesByProfileUrl.has(url),
      )
      if (unresolvedEntityProfileUrls.length > 0) {
        errors.push(
          `Entity ${entityId} references unresolved profile URL(s): ${unresolvedEntityProfileUrls.join(', ')}`,
        )
        continue
      }

      const entityRules = mergeRuleSets(profileUrls)
      const types = deps.entityTypes(entity)
      for (const entityType of types) {
        if (!entityRules.allowedClasses.has(entityType)) {
          errors.push(`Entity ${entityId} has disallowed type for its profile(s): ${entityType}`)
        }
      }

      const allowedProperties = new Set<string>(deps.baseAllowedProperties)
      for (const entityType of types) {
        const classAllowedProps = entityRules.allowedPropertiesByClass.get(entityType)
        if (!classAllowedProps) {
          continue
        }
        for (const prop of classAllowedProps) {
          allowedProperties.add(prop)
        }
      }
      for (const key of Object.keys(entity)) {
        if (key.startsWith('@')) {
          continue
        }
        if (allowedProperties.has(key)) {
          continue
        }
        warnings.push(
          `Entity ${entityId} contains custom property outside active profile/schema rules: ${key}. ` +
            'Keep it if the user wants this metadata; do not remove it automatically.',
        )
      }

      const valueSetsByProperty = new Map<string, Set<string>>()
      for (const entityType of types) {
        const classValueSets = entityRules.valueSetsByClass.get(entityType)
        if (!classValueSets) {
          continue
        }
        for (const [propertyName, values] of classValueSets.entries()) {
          const mergedValues = valueSetsByProperty.get(propertyName) ?? new Set<string>()
          for (const value of values) {
            mergedValues.add(value)
          }
          valueSetsByProperty.set(propertyName, mergedValues)
        }
      }
      for (const [propertyName, allowedValuesSet] of valueSetsByProperty.entries()) {
        const allowedValues = Array.from(allowedValuesSet).sort()
        if (allowedValues.length === 0) {
          continue
        }
        const hintKey = `${types[0] ?? 'Entity'}.${propertyName}`
        valueSetHints.set(hintKey, new Set<string>(allowedValues))
        const currentValue = entity[propertyName]
        const currentValues = collectStringValues(currentValue)
        if (currentValues.length === 0) {
          continue
        }
        const invalidValues = currentValues.filter((value) => !allowedValuesSet.has(value))
        if (invalidValues.length > 0) {
          errors.push(
            `Entity ${entityId} has invalid value(s) for ${propertyName}: ${invalidValues.join(', ')}. Allowed values: ${allowedValues.join(', ')}`,
          )
          valueSetViolations.push({
            entityId,
            entityType: types[0] ?? 'Entity',
            property: propertyName,
            invalidValues: Array.from(new Set(invalidValues)).sort(),
            allowedValues,
          })
        }
      }

      const nameValue = entity.name
      const hasName = hasMeaningfulValue(nameValue)
      if (!hasName) {
        const message = `Entity ${entityId} is missing human-friendly name`
        addRequiredMessage(message)
      } else if (typeof nameValue === 'string') {
        const candidate = getBestNameCandidate(entity)
        if (nameValue.trim() === entityId && candidate && candidate !== entityId) {
          const message = `Entity ${entityId} uses @id as name while descriptive field is available`
          addRequiredMessage(message)
        }
      }

      const requiredProperties = new Set<string>()
      for (const entityType of types) {
        const classRequiredProps = entityRules.requiredPropertiesByClass.get(entityType)
        if (!classRequiredProps) {
          continue
        }
        for (const prop of classRequiredProps) {
          requiredProperties.add(prop)
        }
      }
      for (const requiredProperty of requiredProperties) {
        if (!hasMeaningfulValue(entity[requiredProperty])) {
          addRequiredMessage(
            `Entity ${entityId} is missing required property: ${requiredProperty}`,
          )
        }
      }

      const referenceProperties = new Map<string, Set<string>>()
      for (const entityType of types) {
        const classPropertyTypes = entityRules.propertyTypesByClass.get(entityType)
        if (!classPropertyTypes) {
          continue
        }
        for (const [propertyName, targetTypes] of classPropertyTypes.entries()) {
          const profileTargetTypes = Array.from(targetTypes).filter((targetType) =>
            entityRules.allowedClasses.has(targetType),
          )
          if (profileTargetTypes.length === 0) {
            continue
          }
          referenceProperties.set(propertyName, new Set<string>(profileTargetTypes))
        }
      }
      for (const propertyName of referenceProperties.keys()) {
        const invalidReferenceValueDescriptions = collectInvalidReferenceValueDescriptions(
          entity[propertyName],
        )
        if (invalidReferenceValueDescriptions.length > 0) {
          const expectedTypes = Array.from(referenceProperties.get(propertyName) ?? [])
            .sort()
            .join(', ')
          errors.push(
            `Entity ${entityId} has invalid reference value(s) for ${propertyName}: ` +
              `${Array.from(new Set(invalidReferenceValueDescriptions)).join(', ')}. ` +
              `profile type(s): ${expectedTypes}. Each value must be an object with @id.`,
          )
          continue
        }
        for (const referencedId of collectReferencedIds(entity[propertyName])) {
          const referencedEntity = entityById.get(referencedId)
          if (!referencedEntity) {
            continue
          }
          enqueueProfiledEntity(referencedEntity, profileUrls)
        }
      }
    }

    const contextSuggestion = deps.buildContextTermSuggestion(crate, constraints)
    for (const term of contextSuggestion.missingTerms) {
      const usage = termUsageByScope.get(term)
      if (externalContextCoverage && usage && !usage.profiled && usage.unprofiled) {
        continue
      }
      errors.push(
        `Missing @context mapping for custom term: ${term}. ` +
          'Add an inline @context mapping or reference a context URL that defines it; do not remove the property automatically.',
      )
    }
    for (const term of contextSuggestion.unknownTerms) {
      warnings.push(
        `No profile IRI found for context term: ${term}. Consider adding explicit mapping in @context.`,
      )
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      valueSetHints: Object.fromEntries(
        Array.from(valueSetHints.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, values]) => [key, Array.from(values).sort()]),
      ),
      valueSetViolations,
    }
  }

  /**
   * Convenience wrapper used by tool handlers.
   *
   * Builds constraints, runs validation, and throws on invalid profile results.
   */
  function ensureProfileConformanceOrThrow(
    crate: RoCrate,
    mode: AccessMode,
    inputs: ProfileResolutionInputs = {},
    options: ProfileValidationOptions = {
      requiredMode: 'allow_missing',
    },
  ): ProfileConstraints {
    const constraints = buildProfileConstraints(crate, mode, inputs)
    if (mode !== 'local' && !constraints.resolution.inputProvided) {
      return constraints
    }
    const validation = validateCrateAgainstProfileConstraints(crate, constraints, {
      requiredMode: options.requiredMode,
    })
    if (validation.valid) {
      return constraints
    }

    if (!validation.valid) {
      throw new Error(`Profile conformance failed: ${validation.errors.join(' | ')}`)
    }
    return constraints
  }

  return {
    extractAllowedPropertiesFromClass,
    extractRequiredPropertiesFromClass,
    buildProfileConstraints,
    hasMeaningfulValue,
    getBestNameCandidate,
    validateCrateAgainstProfileConstraints,
    ensureProfileConformanceOrThrow,
  }
}
