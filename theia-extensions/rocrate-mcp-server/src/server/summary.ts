import type { RoCrate, RoCrateChangeSet, RoCrateEntity } from '../core/types'
import type {
  AccessMode,
  ContextAutoPatchReport,
  ProfileConstraints,
  ProfileResolution,
} from './types'

type SummaryDeps = {
  defaultSummaryIssueLimit: number
  defaultSummaryEntityIdLimit: number
  pickMetadataDescriptor: (crate: RoCrate) => RoCrateEntity | undefined
  collectProfileUrls: (crate: RoCrate) => string[]
}

/**
 * Builds response-shaping helpers used by tool handlers for concise/consistent
 * summary payloads.
 */
export function createSummaryHelpers(deps: SummaryDeps) {
  /**
   * Handles summarize array.
   */
  function summarizeArray(
    values: unknown[],
    limit = deps.defaultSummaryIssueLimit,
  ): {
    items: unknown[]
    total: number
    truncated: boolean
  } {
    const safeLimit = Math.max(1, limit)
    return {
      items: values.slice(0, safeLimit),
      total: values.length,
      truncated: values.length > safeLimit,
    }
  }

  /**
   * Handles summarize string array.
   */
  function summarizeStringArray(
    values: string[],
    limit = deps.defaultSummaryEntityIdLimit,
  ): {
    items: string[]
    total: number
    truncated: boolean
  } {
    return summarizeArray(values, limit) as {
      items: string[]
      total: number
      truncated: boolean
    }
  }

  /**
   * Projects profile resolution into a transport-safe summary object.
   */
  function summarizeProfileResolution(
    resolution: ProfileResolution,
  ): Record<string, unknown> {
    return {
      mode: resolution.mode,
      inputProvided: resolution.inputProvided,
      profileContextId: resolution.profileContextId,
      profileUrls: resolution.profileUrls,
      unresolvedUrls: resolution.unresolvedUrls,
      warnings: resolution.warnings,
      indexPath: resolution.indexPath,
      aromaRootPath: resolution.aromaRootPath,
      profiles: resolution.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        version: profile.version,
        conformsTo: profile.conformsTo,
        convertedPath: profile.convertedPath,
        loaded: profile.loaded,
        loadError: profile.loadError,
      })),
    }
  }

  /**
   * Handles summarize entity type counts.
   */
  function summarizeEntityTypeCounts(crate: RoCrate): Record<string, number> {
    const counts = new Map<string, number>()
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      const rawType = entity['@type']
      const types = Array.isArray(rawType)
        ? rawType.filter((item): item is string => typeof item === 'string')
        : typeof rawType === 'string'
          ? [rawType]
          : ['Unknown']
      for (const type of types) {
        counts.set(type, (counts.get(type) ?? 0) + 1)
      }
    }
    return Object.fromEntries(
      Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  /**
   * Produces high-level crate diagnostics (entity counts, profile URLs, root info).
   */
  function summarizeCratePayload(
    crate: RoCrate,
    mode: AccessMode,
    cratePath?: string,
  ): Record<string, unknown> {
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const descriptor = deps.pickMetadataDescriptor(crate)
    const rootDataset =
      graph.find(
        (entity) =>
          !!entity &&
          typeof entity === 'object' &&
          !Array.isArray(entity) &&
          entity['@id'] === './',
      ) ?? null
    const rootDatasetSummary =
      rootDataset && typeof rootDataset === 'object' && !Array.isArray(rootDataset)
        ? {
            '@id': rootDataset['@id'],
            '@type': rootDataset['@type'],
            name: rootDataset.name ?? null,
            propertyKeys: Object.keys(rootDataset).sort(),
          }
        : null

    return {
      mode,
      metadataPath: cratePath,
      graphEntityCount: graph.length,
      hasRootDataset: rootDataset !== null,
      metadataDescriptorId:
        descriptor && typeof descriptor['@id'] === 'string' ? descriptor['@id'] : null,
      profileUrls: deps.collectProfileUrls(crate),
      entityTypeCounts: summarizeEntityTypeCounts(crate),
      rootDataset: rootDatasetSummary,
    }
  }

  /**
   * Summarizes change-set scope (counts, touched ids, root/context fields).
   */
  function summarizeChangeSet(changeSet: RoCrateChangeSet): Record<string, unknown> {
    const addEntities = Array.isArray(changeSet.addEntities) ? changeSet.addEntities : []
    const updateEntities = Array.isArray(changeSet.updateEntities)
      ? changeSet.updateEntities
      : []
    const removeEntities = Array.isArray(changeSet.removeEntities)
      ? changeSet.removeEntities
      : []
    const addHasPart = Array.isArray(changeSet.addHasPart) ? changeSet.addHasPart : []
    const removeHasPart = Array.isArray(changeSet.removeHasPart)
      ? changeSet.removeHasPart
      : []
    const setRootFields =
      changeSet.setRootFields &&
      typeof changeSet.setRootFields === 'object' &&
      !Array.isArray(changeSet.setRootFields)
        ? Object.keys(changeSet.setRootFields)
        : []
    const mergeContext =
      changeSet.mergeContext &&
      typeof changeSet.mergeContext === 'object' &&
      !Array.isArray(changeSet.mergeContext)
        ? Object.keys(changeSet.mergeContext)
        : []

    const addedIds = addEntities
      .map((entity) =>
        entity && typeof entity === 'object' && !Array.isArray(entity)
          ? entity['@id']
          : undefined,
      )
      .filter((id): id is string => typeof id === 'string')
    const updatedIds = updateEntities
      .map((entity) =>
        entity && typeof entity === 'object' && !Array.isArray(entity)
          ? entity['@id']
          : undefined,
      )
      .filter((id): id is string => typeof id === 'string')
    const removedIds = removeEntities.filter((id): id is string => typeof id === 'string')

    return {
      counts: {
        addEntities: addEntities.length,
        updateEntities: updateEntities.length,
        removeEntities: removeEntities.length,
        addHasPart: addHasPart.length,
        removeHasPart: removeHasPart.length,
        setRootFields: setRootFields.length,
        mergeContext: mergeContext.length,
      },
      changedEntityIds: {
        added: summarizeStringArray(addedIds),
        updated: summarizeStringArray(updatedIds),
        removed: summarizeStringArray(removedIds),
      },
      changedRootFields: setRootFields,
      mergeContextKeys: mergeContext,
    }
  }

  /**
   * Condenses full validation output to bounded error/warning samples while
   * retaining totals and truncation metadata.
   */
  function summarizeValidationPayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const errors = Array.isArray(payload.errors) ? payload.errors : []
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : []
    const profile =
      payload.profile &&
      typeof payload.profile === 'object' &&
      !Array.isArray(payload.profile)
        ? (payload.profile as Record<string, unknown>)
        : {}
    const profileErrors = Array.isArray(profile.errors) ? profile.errors : []
    const profileWarnings = Array.isArray(profile.warnings) ? profile.warnings : []
    const resolution =
      profile.resolution &&
      typeof profile.resolution === 'object' &&
      !Array.isArray(profile.resolution)
        ? (profile.resolution as ProfileResolution)
        : undefined

    const errorSummary = summarizeArray(errors)
    const warningSummary = summarizeArray(warnings)
    const profileErrorSummary = summarizeArray(profileErrors)
    const profileWarningSummary = summarizeArray(profileWarnings)

    return {
      valid: payload.valid === true,
      summary: payload.summary,
      errors: errorSummary.items,
      warnings: warningSummary.items,
      errorsTotal: errorSummary.total,
      warningsTotal: warningSummary.total,
      errorsTruncated: errorSummary.truncated,
      warningsTruncated: warningSummary.truncated,
      profile: {
        valid: profile.valid === true,
        errors: profileErrorSummary.items,
        warnings: profileWarningSummary.items,
        errorsTotal: profileErrorSummary.total,
        warningsTotal: profileWarningSummary.total,
        errorsTruncated: profileErrorSummary.truncated,
        warningsTruncated: profileWarningSummary.truncated,
        requiredMode: profile.requiredMode,
        resolution: resolution ? summarizeProfileResolution(resolution) : undefined,
      },
    }
  }

  /**
   * Handles summarize ro crate context.
   */
  function summarizeRoCrateContext(context: Record<string, unknown>): Record<string, unknown> {
    const profileResolution =
      context.profileResolution &&
      typeof context.profileResolution === 'object' &&
      !Array.isArray(context.profileResolution)
        ? (context.profileResolution as ProfileResolution)
        : undefined
    const conformance =
      context.conformance &&
      typeof context.conformance === 'object' &&
      !Array.isArray(context.conformance)
        ? (context.conformance as Record<string, unknown>)
        : {}
    const conformanceErrors = Array.isArray(conformance.errors) ? conformance.errors : []
    const conformanceWarnings = Array.isArray(conformance.warnings)
      ? conformance.warnings
      : []
    const errorSummary = summarizeArray(conformanceErrors)
    const warningSummary = summarizeArray(conformanceWarnings)
    const profileRules =
      context.profileRules &&
      typeof context.profileRules === 'object' &&
      !Array.isArray(context.profileRules)
        ? (context.profileRules as Record<string, unknown>)
        : {}
    const profileTargetsByUrlRaw =
      context.profileTargetsByUrl &&
      typeof context.profileTargetsByUrl === 'object' &&
      !Array.isArray(context.profileTargetsByUrl)
        ? (context.profileTargetsByUrl as Record<string, unknown>)
        : {}
    const profileTargetsByUrl = Object.fromEntries(
      Object.entries(profileTargetsByUrlRaw).map(([profileUrl, ids]) => {
        const entityIds = Array.isArray(ids)
          ? ids.filter((item): item is string => typeof item === 'string')
          : []
        const summary = summarizeStringArray(entityIds)
        return [
          profileUrl,
          {
            entityIds: summary.items,
            entityCount: summary.total,
            entityIdsTruncated: summary.truncated,
          },
        ]
      }),
    )
    const allowedClasses = Array.isArray(profileRules.allowedClasses)
      ? profileRules.allowedClasses.filter(
          (item): item is string => typeof item === 'string',
        )
      : []
    const allowedPropertiesByClassRaw =
      profileRules.allowedPropertiesByClass &&
      typeof profileRules.allowedPropertiesByClass === 'object' &&
      !Array.isArray(profileRules.allowedPropertiesByClass)
        ? (profileRules.allowedPropertiesByClass as Record<string, unknown>)
        : {}
    const allowedPropertiesByClass = Object.fromEntries(
      Object.entries(allowedPropertiesByClassRaw)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([className, props]) => {
          const values = Array.isArray(props)
            ? props.filter((item): item is string => typeof item === 'string')
            : []
          const summary = summarizeStringArray(values.sort())
          return [
            className,
            {
              properties: summary.items,
              propertyCount: summary.total,
              propertiesTruncated: summary.truncated,
            },
          ]
        }),
    )
    const valueSetsByClassRaw =
      profileRules.valueSetsByClass &&
      typeof profileRules.valueSetsByClass === 'object' &&
      !Array.isArray(profileRules.valueSetsByClass)
        ? (profileRules.valueSetsByClass as Record<string, unknown>)
        : {}
    const valueSetsByClass = Object.fromEntries(
      Object.entries(valueSetsByClassRaw)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([className, propertySetsRaw]) => {
          const propertySets =
            propertySetsRaw &&
            typeof propertySetsRaw === 'object' &&
            !Array.isArray(propertySetsRaw)
              ? (propertySetsRaw as Record<string, unknown>)
              : {}
          return [
            className,
            Object.fromEntries(
              Object.entries(propertySets)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([propertyName, valuesRaw]) => {
                  const values = Array.isArray(valuesRaw)
                    ? valuesRaw.filter((item): item is string => typeof item === 'string')
                    : []
                  const summary = summarizeStringArray(values.sort())
                  return [
                    propertyName,
                    {
                      values: summary.items,
                      valueCount: summary.total,
                      valuesTruncated: summary.truncated,
                    },
                  ]
                }),
            ),
          ]
        }),
    )

    return {
      mode: context.mode,
      metadataPath: context.metadataPath,
      graphEntityCount: context.graphEntityCount,
      hasRootDataset: context.hasRootDataset,
      metadataDescriptorId: context.metadataDescriptorId,
      profileResolution: profileResolution
        ? summarizeProfileResolution(profileResolution)
        : undefined,
      profileRules: {
        allowedClassCount: allowedClasses.length,
        allowedClasses: summarizeStringArray(allowedClasses).items,
        allowedPropertiesByClass,
        valueSetsByClass,
      },
      profileTargetsByUrl,
      conformance: {
        valid: conformance.valid === true,
        errors: errorSummary.items,
        warnings: warningSummary.items,
        errorsTotal: errorSummary.total,
        warningsTotal: warningSummary.total,
        errorsTruncated: errorSummary.truncated,
        warningsTruncated: warningSummary.truncated,
      },
      instructions: context.instructions,
    }
  }

  /**
   * Handles summarize apply changes payload.
   */
  function summarizeApplyChangesPayload(
    payload: Record<string, unknown>,
    crate: RoCrate,
    changeSet: RoCrateChangeSet,
    constraints: ProfileConstraints,
  ): Record<string, unknown> {
    const contextPatchReport =
      payload.contextPatchReport &&
      typeof payload.contextPatchReport === 'object' &&
      !Array.isArray(payload.contextPatchReport)
        ? (payload.contextPatchReport as ContextAutoPatchReport)
        : undefined
    return {
      mode: payload.mode,
      writeApplied: payload.writeApplied,
      cratePath: payload.cratePath,
      profileRequiredMode: payload.profileRequiredMode,
      contextMode: payload.contextMode,
      profileResolution: summarizeProfileResolution(constraints.resolution),
      graphEntityCount: Array.isArray(crate['@graph']) ? crate['@graph'].length : 0,
      changes: summarizeChangeSet(changeSet),
      contextPatch: contextPatchReport
        ? {
            addedTerms: contextPatchReport.addedTerms,
            reconciledTerms: contextPatchReport.reconciledTerms,
            skippedConflicts: contextPatchReport.skippedConflicts,
            ambiguousTerms: contextPatchReport.ambiguousTerms,
          }
        : undefined,
      note: payload.note,
    }
  }

  /**
   * Handles summarize dataverse upload payload.
   */
  function summarizeDataverseUploadPayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const ingestedCrate =
      payload.ingestedCrate &&
      typeof payload.ingestedCrate === 'object' &&
      !Array.isArray(payload.ingestedCrate)
        ? (payload.ingestedCrate as RoCrate)
        : undefined
    return {
      mode: payload.mode,
      writeApplied: payload.writeApplied,
      cratePath: payload.cratePath,
      status: payload.status,
      endpoint: payload.endpoint,
      requestUrl: payload.requestUrl,
      pid: payload.pid,
      dataverseUrl: payload.dataverseUrl,
      ingestedCrateSummary: ingestedCrate
        ? summarizeCratePayload(
            ingestedCrate,
            (payload.mode === 'remote' ? 'remote' : 'local') as AccessMode,
            typeof payload.cratePath === 'string' ? payload.cratePath : undefined,
          )
        : null,
      note: payload.note,
    }
  }

  /**
   * Handles summarize dataverse download payload.
   */
  function summarizeDataverseDownloadPayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const crate =
      payload.crate && typeof payload.crate === 'object' && !Array.isArray(payload.crate)
        ? (payload.crate as RoCrate)
        : undefined
    return {
      mode: payload.mode,
      writeApplied: payload.writeApplied,
      cratePath: payload.cratePath,
      status: payload.status,
      requestUrl: payload.requestUrl,
      pid: payload.pid,
      version: payload.version,
      crateSummary: crate
        ? summarizeCratePayload(
            crate,
            (payload.mode === 'remote' ? 'remote' : 'local') as AccessMode,
            typeof payload.cratePath === 'string' ? payload.cratePath : undefined,
          )
        : null,
      note: payload.note,
    }
  }

  return {
    summarizeArray,
    summarizeStringArray,
    summarizeProfileResolution,
    summarizeEntityTypeCounts,
    summarizeCratePayload,
    summarizeChangeSet,
    summarizeValidationPayload,
    summarizeRoCrateContext,
    summarizeApplyChangesPayload,
    summarizeDataverseUploadPayload,
    summarizeDataverseDownloadPayload,
  }
}
