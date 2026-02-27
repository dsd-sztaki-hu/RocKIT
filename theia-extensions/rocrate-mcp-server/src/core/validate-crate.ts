import { type RoCrate, type RoCrateEntity, type RoCrateValidationReport } from './types'

type ValidateOptions = {
  strict?: boolean
}

function normalizeTypes(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  return []
}

function isExternalReference(referenceId: string): boolean {
  return (
    referenceId.startsWith('http://') ||
    referenceId.startsWith('https://') ||
    referenceId.startsWith('doi:') ||
    referenceId.startsWith('urn:') ||
    referenceId.startsWith('mailto:')
  )
}

function extractHasPart(entity: RoCrateEntity): string[] {
  const raw = entity.hasPart
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)['@id']
          : undefined,
      )
      .filter((item): item is string => typeof item === 'string')
  }
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as Record<string, unknown>)['@id'] === 'string'
  ) {
    return [(raw as Record<string, string>)['@id']]
  }
  return []
}

export function validateCrate(
  crate: RoCrate,
  options: ValidateOptions = {},
): RoCrateValidationReport {
  const strict = options.strict ?? false
  const errors: RoCrateValidationReport['errors'] = []
  const warnings: RoCrateValidationReport['warnings'] = []

  if (crate['@context'] === undefined) {
    warnings.push({
      code: 'missing_context',
      message: 'Top-level @context is missing.',
      path: '@context',
    })
  }

  const graph = crate['@graph']
  if (!Array.isArray(graph)) {
    errors.push({
      code: 'invalid_graph',
      message: 'Top-level @graph must be an array.',
      path: '@graph',
    })
    return {
      valid: false,
      summary: { errors: errors.length, warnings: warnings.length },
      errors,
      warnings,
    }
  }

  const entitiesById = new Map<string, RoCrateEntity>()
  const duplicateIds = new Set<string>()

  graph.forEach((entity, index) => {
    const basePath = `@graph[${index}]`
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      errors.push({
        code: 'entity_not_object',
        message: 'Entity must be a JSON object.',
        path: basePath,
      })
      return
    }

    const entityId = entity['@id']
    if (typeof entityId !== 'string' || entityId.trim() === '') {
      errors.push({
        code: 'missing_entity_id',
        message: 'Entity is missing @id.',
        path: `${basePath}.@id`,
      })
    } else if (entitiesById.has(entityId)) {
      duplicateIds.add(entityId)
    } else {
      entitiesById.set(entityId, entity)
    }

    const types = normalizeTypes(entity['@type'])
    if (types.length === 0) {
      errors.push({
        code: 'missing_entity_type',
        message: 'Entity is missing @type.',
        path: `${basePath}.@type`,
      })
    }

    const entityName = entity.name
    if (typeof entityName !== 'string' || entityName.trim() === '') {
      const target = strict ? errors : warnings
      target.push({
        code: 'missing_entity_name',
        message: 'Entity should define a human-friendly name.',
        path: `${basePath}.name`,
      })
    }
  })

  for (const duplicateId of duplicateIds) {
    errors.push({
      code: 'duplicate_entity_id',
      message: `Duplicate @id found: ${duplicateId}`,
      path: '@graph',
    })
  }

  if (!entitiesById.has('./')) {
    const target = strict ? errors : warnings
    target.push({
      code: 'missing_root_dataset',
      message: "Root dataset './' is missing.",
      path: '@graph',
    })
  }

  const metadataEntity =
    entitiesById.get('ro-crate-metadata.json') ??
    entitiesById.get('file://./ro-crate-metadata.json')
  if (!metadataEntity) {
    errors.push({
      code: 'missing_metadata_descriptor',
      message: 'Metadata descriptor entity is missing.',
      path: '@graph',
    })
  } else {
    const conforms = metadataEntity.conformsTo
    const conformsId =
      conforms && typeof conforms === 'object'
        ? (conforms as Record<string, unknown>)['@id']
        : undefined
    if (conformsId !== 'https://w3id.org/ro/crate/1.1') {
      warnings.push({
        code: 'metadata_conforms_to',
        message: 'Metadata descriptor should conform to RO-Crate 1.1.',
        path: 'metadataDescriptor.conformsTo',
      })
    }
  }

  for (const [entityId, entity] of entitiesById.entries()) {
    const rawHasPart = entity.hasPart
    if (
      rawHasPart !== undefined &&
      !Array.isArray(rawHasPart) &&
      !(rawHasPart && typeof rawHasPart === 'object')
    ) {
      errors.push({
        code: 'invalid_has_part',
        message: 'hasPart must be an object or array of objects.',
        path: `${entityId}.hasPart`,
      })
      continue
    }
    const refs = extractHasPart(entity)
    for (const refId of refs) {
      if (entitiesById.has(refId)) {
        continue
      }
      if (isExternalReference(refId)) {
        continue
      }
      warnings.push({
        code: 'dangling_reference',
        message: `hasPart references missing local entity: ${refId}`,
        path: `${entityId}.hasPart`,
      })
    }
  }

  return {
    valid: errors.length === 0,
    summary: {
      errors: errors.length,
      warnings: warnings.length,
    },
    errors,
    warnings,
  }
}
