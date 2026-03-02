import type { McpToolTextResult, TransportMode } from './types'

type ToolCallTelemetryContext = {
  sessionKey: string
  transportMode: TransportMode
}

type TelemetryCollector = {
  startToolCall: (
    toolName: string,
    params: Record<string, unknown>,
    sessionKey?: string,
    transportMode?: TransportMode,
  ) => string
  completeToolCallSuccess: (telemetryId: string, payload: unknown) => void
  completeToolCallError: (telemetryId: string, error: unknown) => void
}

type DispatcherDeps = {
  getTelemetryCollector: () => TelemetryCollector | null
  parseWebSearchParams: (params: Record<string, unknown>) => unknown
  runWebSearch: (params: unknown) => Promise<unknown>
  textResult: (payload: unknown) => McpToolTextResult
  parseDownloadUrlParams: (params: Record<string, unknown>) => unknown
  runDownloadUrl: (params: unknown) => Promise<unknown>
  parseDataverseUploadParams: (params: Record<string, unknown>) => { responseMode: 'summary' | 'full' }
  runDataverseUpload: (params: unknown) => Promise<Record<string, unknown>>
  summarizeDataverseUploadPayload: (payload: Record<string, unknown>) => Record<string, unknown>
  parseDataverseDownloadParams: (params: Record<string, unknown>) => { responseMode: 'summary' | 'full' }
  runDataverseDownload: (params: unknown) => Promise<Record<string, unknown>>
  summarizeDataverseDownloadPayload: (payload: Record<string, unknown>) => Record<string, unknown>
  loadCrateFromParams: (params: Record<string, unknown>) => { mode: 'local' | 'remote'; crate: any; cratePath?: string }
  parseResponseMode: (
    params: Record<string, unknown>,
    defaultMode?: 'summary' | 'full',
  ) => 'summary' | 'full'
  summarizeCratePayload: (crate: any, mode: 'local' | 'remote', cratePath?: string) => Record<string, unknown>
  resolveCratePath: () => string
  ensureCratePath: (inputPath?: unknown) => string
  parseProfileResolutionInputs: (params: Record<string, unknown>) => unknown
  parseProfileRequiredMode: (
    params: Record<string, unknown>,
    fallback: 'allow_missing' | 'enforce_required',
  ) => 'allow_missing' | 'enforce_required'
  parseContextMode: (
    params: Record<string, unknown>,
    fallback: 'strict' | 'auto_add' | 'auto_reconcile',
  ) => 'strict' | 'auto_add' | 'auto_reconcile'
  normalizeChangeSet: (input: unknown) => unknown
  detectProfileChangeTargets: (crate: any, changeSet: unknown) => string[]
  applyChangeSet: (crate: any, changeSet: unknown) => any
  buildProfileConstraints: (crate: any, mode: 'local' | 'remote', resolutionInputs: unknown) => any
  applyContextModePatch: (crate: any, constraints: any, contextMode: unknown) => { crate: any; report: unknown }
  ensureProfileConformanceOrThrow: (
    crate: any,
    mode: 'local' | 'remote',
    resolutionInputs: unknown,
    options: { requiredMode: 'allow_missing' | 'enforce_required' },
  ) => any
  writeCrateAtomic: (cratePath: string, crate: any, indent: number) => void
  summarizeApplyChangesPayload: (
    payload: Record<string, unknown>,
    crate: any,
    changeSet: any,
    constraints: any,
  ) => Record<string, unknown>
  readProfileConformsToUpdateOps: (params: Record<string, unknown>) => { add: string[]; remove: string[]; set?: string[] }
  updateProfileConformsTo: (
    crate: any,
    entityId: string,
    ops: { add: string[]; remove: string[]; set?: string[] },
  ) => { previousUrls: string[]; addedUrls: string[]; removedUrls: string[]; finalUrls: string[] }
  validateCrate: (crate: any, options: { strict: boolean }) => any
  validateCrateAgainstProfileConstraints: (
    crate: any,
    constraints: any,
    options: { requiredMode: 'allow_missing' | 'enforce_required' },
  ) => { valid: boolean; errors: unknown[]; warnings: unknown[] }
  summarizeValidationPayload: (payload: Record<string, unknown>) => Record<string, unknown>
  parseAccessMode: (params: Record<string, unknown>) => 'local' | 'remote'
  asRoCrate: (value: unknown) => any
  summarizeProfileResolution: (resolution: unknown) => Record<string, unknown>
  buildRoCrateContext: (
    crate: any,
    mode: 'local' | 'remote',
    cratePath: string | undefined,
    resolutionInputs: unknown,
  ) => Record<string, unknown>
  summarizeRoCrateContext: (context: Record<string, unknown>) => Record<string, unknown>
  buildContextTermSuggestion: (
    crate: any,
    constraints: any,
  ) => {
    mergeContext: Record<string, string>
    missingTerms: string[]
    unknownTerms: string[]
    usedTerms: string[]
    declaredTerms: string[]
  }
  resolveProfileUrls: (
    profileUrls: string[],
    mode: 'local' | 'remote',
    includeProfileContent: boolean,
    resolutionInputs: unknown,
  ) => unknown
  prepareRemoteProfilePayload: (params: Record<string, unknown>) => Record<string, unknown>
  createProfileContext: (params: Record<string, unknown>) => Record<string, unknown>
  getProfileContextInfo: (params: Record<string, unknown>) => Record<string, unknown>
  deleteProfileContext: (params: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Handles create tool dispatcher.
 */
export function createToolDispatcher(deps: DispatcherDeps) {
  const {
    getTelemetryCollector,
    parseWebSearchParams,
    runWebSearch,
    textResult,
    parseDownloadUrlParams,
    runDownloadUrl,
    parseDataverseUploadParams,
    runDataverseUpload,
    summarizeDataverseUploadPayload,
    parseDataverseDownloadParams,
    runDataverseDownload,
    summarizeDataverseDownloadPayload,
    loadCrateFromParams,
    parseResponseMode,
    summarizeCratePayload,
    resolveCratePath,
    ensureCratePath,
    parseProfileResolutionInputs,
    parseProfileRequiredMode,
    parseContextMode,
    normalizeChangeSet,
    detectProfileChangeTargets,
    applyChangeSet,
    buildProfileConstraints,
    applyContextModePatch,
    ensureProfileConformanceOrThrow,
    writeCrateAtomic,
    summarizeApplyChangesPayload,
    readProfileConformsToUpdateOps,
    updateProfileConformsTo,
    validateCrate,
    validateCrateAgainstProfileConstraints,
    summarizeValidationPayload,
    parseAccessMode,
    asRoCrate,
    summarizeProfileResolution,
    buildRoCrateContext,
    summarizeRoCrateContext,
    buildContextTermSuggestion,
    resolveProfileUrls,
    prepareRemoteProfilePayload,
    createProfileContext,
    getProfileContextInfo,
    deleteProfileContext,
  } = deps

  return async function handleToolCall(
    toolName: string,
    params: Record<string, unknown>,
    telemetryContext?: ToolCallTelemetryContext,
  ): Promise<McpToolTextResult> {
    const collector = getTelemetryCollector()
    let telemetryId: string | undefined

    try {
      if (collector) {
        telemetryId = collector.startToolCall(
          toolName,
          params,
          telemetryContext?.sessionKey,
          telemetryContext?.transportMode,
        )
      }

      if (toolName === 'search') {
        const searchParams = parseWebSearchParams(params)
        const result = await runWebSearch(searchParams)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'download_url') {
        const downloadParams = parseDownloadUrlParams(params)
        const result = await runDownloadUrl(downloadParams)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'upload_rocrate_to_dataverse') {
        const uploadParams = parseDataverseUploadParams(params)
        const payload = await runDataverseUpload(uploadParams)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, payload)
        }
        if (uploadParams.responseMode === 'full') {
          return textResult(payload)
        }
        return textResult(summarizeDataverseUploadPayload(payload))
      }

      if (toolName === 'download_rocrate_from_dataverse') {
        const downloadParams = parseDataverseDownloadParams(params)
        const payload = await runDataverseDownload(downloadParams)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, payload)
        }
        if (downloadParams.responseMode === 'full') {
          return textResult(payload)
        }
        return textResult(summarizeDataverseDownloadPayload(payload))
      }

      if (toolName === 'read_crate') {
        const loaded = loadCrateFromParams(params)
        const responseMode = parseResponseMode(
          params,
          loaded.mode === 'remote' ? 'full' : 'summary',
        )
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, loaded.crate)
        }
        if (responseMode === 'full') {
          return textResult(loaded.crate)
        }
        return textResult(summarizeCratePayload(loaded.crate, loaded.mode, loaded.cratePath))
      }

      if (toolName === 'apply_changes') {
        if (params.write !== true) {
          throw new Error(
            'apply_changes requires write=true. Use explicit write intent for all apply_changes calls.',
          )
        }
        const loaded = loadCrateFromParams(params)
        const resolutionInputs = parseProfileResolutionInputs(params)
        const profileRequiredMode = parseProfileRequiredMode(params, 'allow_missing')
        const contextMode = parseContextMode(params, 'auto_reconcile')
        const normalizedChangeSet = normalizeChangeSet(params.changeSet)
        const profileChangeTargets = detectProfileChangeTargets(loaded.crate, normalizedChangeSet)
        if (profileChangeTargets.length > 0) {
          throw new Error(
            `conformsTo update blocked in apply_changes for Dataset/File entity IDs: ${profileChangeTargets.join(', ')}. Use update_profile_conforms_to.`,
          )
        }
        const changed = applyChangeSet(loaded.crate, normalizedChangeSet)
        const responseMode = parseResponseMode(
          params,
          loaded.mode === 'remote' ? 'full' : 'summary',
        )
        const preConstraints = buildProfileConstraints(changed, loaded.mode, resolutionInputs)
        const contextPatched = applyContextModePatch(changed, preConstraints, contextMode)
        const updated = contextPatched.crate
        const constraints = ensureProfileConformanceOrThrow(
          updated,
          loaded.mode,
          resolutionInputs,
          {
            requiredMode: profileRequiredMode,
          },
        )
        if (loaded.mode === 'local') {
          const indent = typeof params.indent === 'number' ? params.indent : 2
          writeCrateAtomic(loaded.cratePath ?? resolveCratePath(), updated, indent)
          const payload = {
            crate: updated,
            mode: loaded.mode,
            writeApplied: true,
            cratePath: loaded.cratePath ?? resolveCratePath(),
            profileRequiredMode,
            contextMode,
            contextPatchReport: contextPatched.report,
            profileResolution: constraints.resolution,
          }
          if (collector && telemetryId) {
            collector.completeToolCallSuccess(telemetryId, payload)
          }
          if (responseMode === 'full') {
            return textResult(payload)
          }
          return textResult(
            summarizeApplyChangesPayload(payload, updated, normalizedChangeSet, constraints),
          )
        }
        if (loaded.mode === 'remote') {
          const payload = {
            crate: updated,
            writeApplied: false,
            mode: 'remote',
            profileRequiredMode,
            contextMode,
            contextPatchReport: contextPatched.report,
            profileResolution: constraints.resolution,
            note: 'Remote mode does not persist files. Use returned crate payload.',
          }
          if (collector && telemetryId) {
            collector.completeToolCallSuccess(telemetryId, payload)
          }
          if (responseMode === 'full') {
            return textResult(payload)
          }
          return textResult(
            summarizeApplyChangesPayload(payload, updated, normalizedChangeSet, constraints),
          )
        }
        throw new Error(`Unsupported mode for apply_changes: ${loaded.mode}`)
      }

      if (toolName === 'update_profile_conforms_to') {
        if (params.write !== true) {
          throw new Error(
            'update_profile_conforms_to requires write=true. Use explicit write intent for all write operations.',
          )
        }
        const loaded = loadCrateFromParams(params)
        const entityId =
          typeof params.entityId === 'string' && params.entityId.trim() !== ''
            ? params.entityId.trim()
            : './'
        const ops = readProfileConformsToUpdateOps(params)

        const { previousUrls, addedUrls, removedUrls, finalUrls } = updateProfileConformsTo(
          loaded.crate,
          entityId,
          ops,
        )
        const responseMode = parseResponseMode(
          params,
          loaded.mode === 'remote' ? 'full' : 'summary',
        )

        if (loaded.mode === 'local') {
          const cratePath = loaded.cratePath ?? resolveCratePath()
          const indent = typeof params.indent === 'number' ? params.indent : 2
          writeCrateAtomic(cratePath, loaded.crate, indent)
          const payload = {
            mode: 'local',
            writeApplied: true,
            cratePath,
            entityId,
            requestedAddProfileUrls: ops.add,
            requestedRemoveProfileUrls: ops.remove,
            requestedSetProfileUrls: ops.set,
            previousProfileUrls: previousUrls,
            addedProfileUrls: addedUrls,
            removedProfileUrls: removedUrls,
            finalProfileUrls: finalUrls,
            crate: loaded.crate,
          }
          if (collector && telemetryId) {
            collector.completeToolCallSuccess(telemetryId, payload)
          }
          if (responseMode === 'full') {
            return textResult(payload)
          }
          return textResult({
            mode: payload.mode,
            writeApplied: payload.writeApplied,
            cratePath: payload.cratePath,
            entityId: payload.entityId,
            requestedAddProfileUrls: payload.requestedAddProfileUrls,
            requestedRemoveProfileUrls: payload.requestedRemoveProfileUrls,
            requestedSetProfileUrls: payload.requestedSetProfileUrls,
            previousProfileUrls: payload.previousProfileUrls,
            addedProfileUrls: payload.addedProfileUrls,
            removedProfileUrls: payload.removedProfileUrls,
            finalProfileUrls: payload.finalProfileUrls,
          })
        }

        if (loaded.mode === 'remote') {
          const payload = {
            mode: 'remote',
            writeApplied: false,
            entityId,
            requestedAddProfileUrls: ops.add,
            requestedRemoveProfileUrls: ops.remove,
            requestedSetProfileUrls: ops.set,
            previousProfileUrls: previousUrls,
            addedProfileUrls: addedUrls,
            removedProfileUrls: removedUrls,
            finalProfileUrls: finalUrls,
            crate: loaded.crate,
            note: 'Remote mode does not persist files. Use returned crate payload.',
          }
          if (collector && telemetryId) {
            collector.completeToolCallSuccess(telemetryId, payload)
          }
          if (responseMode === 'full') {
            return textResult(payload)
          }
          return textResult({
            mode: payload.mode,
            writeApplied: payload.writeApplied,
            entityId: payload.entityId,
            requestedAddProfileUrls: payload.requestedAddProfileUrls,
            requestedRemoveProfileUrls: payload.requestedRemoveProfileUrls,
            requestedSetProfileUrls: payload.requestedSetProfileUrls,
            previousProfileUrls: payload.previousProfileUrls,
            addedProfileUrls: payload.addedProfileUrls,
            removedProfileUrls: payload.removedProfileUrls,
            finalProfileUrls: payload.finalProfileUrls,
            note: payload.note,
          })
        }

        throw new Error(`Unsupported mode for update_profile_conforms_to: ${loaded.mode}`)
      }

      if (toolName === 'validate_crate') {
        const loaded = loadCrateFromParams(params)
        const resolutionInputs = parseProfileResolutionInputs(params)
        const strict = params.strict === true
        const profileRequiredMode = parseProfileRequiredMode(
          params,
          strict ? 'enforce_required' : 'allow_missing',
        )
        const report = validateCrate(loaded.crate, { strict })
        const constraints = buildProfileConstraints(
          loaded.crate,
          loaded.mode,
          resolutionInputs,
        )
        const profileValidation = validateCrateAgainstProfileConstraints(
          loaded.crate,
          constraints,
          {
            requiredMode: profileRequiredMode,
          },
        )
        const payload = {
          ...report,
          profile: {
            valid: profileValidation.valid,
            errors: profileValidation.errors,
            warnings: profileValidation.warnings,
            requiredMode: profileRequiredMode,
            resolution: constraints.resolution,
          },
        }
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, payload)
        }
        const responseMode = parseResponseMode(params, 'summary')
        if (responseMode === 'full') {
          return textResult(payload)
        }
        return textResult(summarizeValidationPayload(payload))
      }

      if (toolName === 'write_crate_atomic') {
        const mode = parseAccessMode(params)
        const responseMode = parseResponseMode(params, mode === 'remote' ? 'full' : 'summary')
        const resolutionInputs = parseProfileResolutionInputs(params)
        const profileRequiredMode = parseProfileRequiredMode(params, 'allow_missing')
        const crateParam = params.crate
        if (!crateParam || typeof crateParam !== 'object' || Array.isArray(crateParam)) {
          throw new Error('write_crate_atomic requires crate object.')
        }
        const crate = asRoCrate(crateParam)
        const constraints = ensureProfileConformanceOrThrow(
          crate,
          mode,
          resolutionInputs,
          {
            requiredMode: profileRequiredMode,
          },
        )
        if (mode === 'remote') {
          const payload = {
            ok: true,
            mode: 'remote',
            writeApplied: false,
            crate,
            profileRequiredMode,
            profileResolution: constraints.resolution,
            note: 'Remote mode does not persist files. Use returned crate payload.',
          }
          if (collector && telemetryId) {
            collector.completeToolCallSuccess(telemetryId, payload)
          }
          if (responseMode === 'full') {
            return textResult(payload)
          }
          return textResult({
            ok: true,
            mode: payload.mode,
            writeApplied: payload.writeApplied,
            profileRequiredMode: payload.profileRequiredMode,
            profileResolution: summarizeProfileResolution(constraints.resolution),
            crateSummary: summarizeCratePayload(crate, mode),
            note: payload.note,
          })
        }
        const cratePath = ensureCratePath(params.cratePath)
        const indent = typeof params.indent === 'number' ? params.indent : 2
        writeCrateAtomic(cratePath, crate, indent)
        const payload = {
          ok: true,
          mode: 'local',
          writeApplied: true,
          cratePath,
          profileRequiredMode,
          profileResolution: constraints.resolution,
        }
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, payload)
        }
        if (responseMode === 'full') {
          return textResult(payload)
        }
        return textResult({
          ok: payload.ok,
          mode: payload.mode,
          writeApplied: payload.writeApplied,
          cratePath: payload.cratePath,
          profileRequiredMode: payload.profileRequiredMode,
          profileResolution: summarizeProfileResolution(constraints.resolution),
          crateSummary: summarizeCratePayload(crate, mode, cratePath),
        })
      }

      if (toolName === 'get_rocrate_context') {
        const loaded = loadCrateFromParams(params)
        const resolutionInputs = parseProfileResolutionInputs(params)
        const context = buildRoCrateContext(
          loaded.crate,
          loaded.mode,
          loaded.cratePath,
          resolutionInputs,
        )
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, context)
        }
        const responseMode = parseResponseMode(params, 'summary')
        if (responseMode === 'full') {
          return textResult(context)
        }
        return textResult(summarizeRoCrateContext(context))
      }

      if (toolName === 'suggest_context_terms') {
        const loaded = loadCrateFromParams(params)
        const resolutionInputs = parseProfileResolutionInputs(params)
        const constraints = buildProfileConstraints(
          loaded.crate,
          loaded.mode,
          resolutionInputs,
        )
        const suggestion = buildContextTermSuggestion(loaded.crate, constraints)
        const payload = {
          mode: loaded.mode,
          cratePath: loaded.cratePath,
          profileResolution: summarizeProfileResolution(constraints.resolution),
          mergeContext: suggestion.mergeContext,
          missingTerms: suggestion.missingTerms,
          unknownTerms: suggestion.unknownTerms,
          usedTerms: suggestion.usedTerms,
          declaredTerms: suggestion.declaredTerms,
          note: 'Merge mergeContext into top-level @context alongside the default RO-Crate context URL.',
        }
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, payload)
        }
        const responseMode = parseResponseMode(
          params,
          loaded.mode === 'remote' ? 'full' : 'summary',
        )
        if (responseMode === 'full') {
          return textResult(payload)
        }
        return textResult({
          mode: payload.mode,
          cratePath: payload.cratePath,
          profileResolution: payload.profileResolution,
          mergeContext: payload.mergeContext,
          missingTerms: payload.missingTerms,
          unknownTerms: payload.unknownTerms,
          note: payload.note,
        })
      }

      if (toolName === 'resolve_profile_schema') {
        const profileUrl =
          typeof params.profileUrl === 'string' ? params.profileUrl.trim() : ''
        if (profileUrl === '') {
          throw new Error('resolve_profile_schema requires profileUrl.')
        }
        const mode = parseAccessMode(params)
        const includeProfileContent = params.includeProfileContent === true
        const resolutionInputs = parseProfileResolutionInputs(params)
        const result = resolveProfileUrls([profileUrl], mode, includeProfileContent, resolutionInputs)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'prepare_remote_profile_payload') {
        const result = prepareRemoteProfilePayload(params)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'create_profile_context') {
        const result = createProfileContext(params)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'get_profile_context_info') {
        const result = getProfileContextInfo(params)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'delete_profile_context') {
        const result = deleteProfileContext(params)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      throw new Error(`Unknown tool: ${toolName}`)
    } catch (error) {
      if (collector && telemetryId) {
        collector.completeToolCallError(telemetryId, error)
      }
      throw error
    }
  }
}
