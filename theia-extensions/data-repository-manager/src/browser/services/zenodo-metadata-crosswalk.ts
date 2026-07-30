import crosswalk = require('../metadata-crosswalks/ro-crate-repository-crosswalk.json')

interface RequirementCondition {
  field: string
  equals?: unknown
  in?: unknown[]
}

interface ConditionalRequirement {
  when: RequirementCondition
}

interface ZenodoRequirements {
  alwaysRequired: string[]
  conditionalRequired: Record<string, ConditionalRequirement>
}

interface RepositoryCrosswalk {
  repositories: {
    zenodo: {
      officialRequirements: ZenodoRequirements
    }
  }
}

const repositoryCrosswalk = crosswalk as RepositoryCrosswalk

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false
  }
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  if (Array.isArray(value)) {
    return value.length > 0 && value.some(hasMeaningfulValue)
  }
  return true
}

function conditionMatches(
  metadata: Record<string, unknown>,
  condition: RequirementCondition,
): boolean {
  const value = metadata[condition.field]
  if (condition.equals !== undefined) {
    return value === condition.equals
  }
  if (condition.in) {
    return condition.in.includes(value)
  }
  return false
}

/**
 * Returns required Zenodo fields that are absent from a generated payload.
 *
 * Requiredness comes from the generated crosswalk's versioned Zenodo target
 * contract, keeping export validation synchronized with mapping generation.
 */
export function missingRequiredZenodoMetadataFields(
  metadata: Record<string, unknown>,
): string[] {
  const requirements =
    repositoryCrosswalk.repositories.zenodo.officialRequirements
  const required = new Set(requirements.alwaysRequired)

  for (const [field, requirement] of Object.entries(
    requirements.conditionalRequired,
  )) {
    if (conditionMatches(metadata, requirement.when)) {
      required.add(field)
    }
  }

  return Array.from(required)
    .filter((field) => !hasMeaningfulValue(metadata[field]))
    .sort()
}
