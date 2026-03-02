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
   * Handles extract required properties from class.
   */
  function extractRequiredPropertiesFromClass(profileClass: unknown): Set<string> {
    const required = new Set<string>()
    if (!profileClass || typeof profileClass !== 'object' || Array.isArray(profileClass)) {
      return required
    }
    const requiredValue = (profileClass as Record<string, unknown>).required
    if (!Array.isArray(requiredValue)) {
      return required
    }
    for (const entry of requiredValue) {
      if (typeof entry !== 'string') {
        continue
      }
      const trimmed = entry.trim()
      if (trimmed !== '') {
        required.add(trimmed)
      }
    }
    return required
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
      }
    }

    return {
      resolution,
      rulesByProfileUrl,
      allowedClasses,
      allowedPropertiesByClass,
      requiredPropertiesByClass,
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
   * - disallowed classes/properties
   * - missing required properties (mode-dependent)
   * - missing/unknown @context term issues (via reconciliation suggestions)
   */
  function validateCrateAgainstProfileConstraints(
    crate: RoCrate,
    constraints: ProfileConstraints,
    options: { requiredMode: ProfileRequiredMode } = { requiredMode: 'allow_missing' },
  ): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings = [...constraints.resolution.warnings]
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
      return { valid: false, errors, warnings }
    }

    const declaredContextTerms = deps.collectDeclaredContextTerms(crate)
    const isKnownContextTerm = (term: string): boolean =>
      declaredContextTerms.has(term) || deps.defaultContextKnownTerms.has(term)

    const mergeRuleSets = (profileUrls: string[]): ProfileRuleSet => {
      const merged: ProfileRuleSet = {
        allowedClasses: new Set<string>(),
        allowedPropertiesByClass: new Map<string, Set<string>>(),
        requiredPropertiesByClass: new Map<string, Set<string>>(),
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
      }
      return merged
    }

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

      const entityProfileUrls = deps.extractConformsToUrls(entity.conformsTo).filter(
        (url) => url !== deps.rocrateConformsToUrl,
      )
      const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : '<unknown>'

      if (entityProfileUrls.length === 0) {
        for (const key of Object.keys(entity)) {
          if (key.startsWith('@')) {
            continue
          }
          if (!isKnownContextTerm(key)) {
            errors.push(
              `Entity ${entityId} contains property not defined by @context: ${key}`,
            )
          }
        }
        continue
      }

      const unresolvedEntityProfileUrls = entityProfileUrls.filter(
        (url) => !constraints.rulesByProfileUrl.has(url),
      )
      if (unresolvedEntityProfileUrls.length > 0) {
        errors.push(
          `Entity ${entityId} references unresolved profile URL(s): ${unresolvedEntityProfileUrls.join(', ')}`,
        )
        continue
      }

      const entityRules = mergeRuleSets(entityProfileUrls)
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
        if (allowedProperties.has(key)) {
          continue
        }
        errors.push(`Entity ${entityId} contains disallowed property: ${key}`)
      }

      const nameValue = entity.name
      const hasName = hasMeaningfulValue(nameValue)
      if (!hasName) {
        const message = `Entity ${entityId} is missing human-friendly name`
        if (options.requiredMode === 'enforce_required') {
          errors.push(message)
        } else {
          warnings.push(message)
        }
      } else if (typeof nameValue === 'string') {
        const candidate = getBestNameCandidate(entity)
        if (nameValue.trim() === entityId && candidate && candidate !== entityId) {
          const message = `Entity ${entityId} uses @id as name while descriptive field is available`
          if (options.requiredMode === 'enforce_required') {
            errors.push(message)
          } else {
            warnings.push(message)
          }
        }
      }

      if (options.requiredMode === 'enforce_required') {
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
            errors.push(
              `Entity ${entityId} is missing required property: ${requiredProperty}`,
            )
          }
        }
      }
    }

    const contextSuggestion = deps.buildContextTermSuggestion(crate, constraints)
    for (const term of contextSuggestion.missingTerms) {
      errors.push(`Missing @context mapping for used term: ${term}`)
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
