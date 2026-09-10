import type { McpToolTextResult, TransportMode } from './types'
import type { SchemaRegistryEntry } from './schema-registry-store'
import {
  DataverseAuthenticationError,
  DataversePreflightValidationError,
} from './dataverse'
import { readAgentWorkflowDoc } from './workflow-docs'
import { registerLocalFileForAroma } from '../dashboard/local-file-bridge'
import {
  getAgentSessionContext,
  setAgentSessionContext,
} from './agent-session-context'

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
  runWithToolCallContext: <T>(toolCallId: string, fn: () => Promise<T>) => Promise<T>
}

type DispatcherDeps = {
  getTelemetryCollector: () => TelemetryCollector | null
  parseWebSearchParams: (params: Record<string, unknown>) => unknown
  runWebSearch: (params: unknown) => Promise<unknown>
  textResult: (payload: unknown, isError?: boolean) => McpToolTextResult
  parseDownloadUrlParams: (params: Record<string, unknown>) => unknown
  runDownloadUrl: (params: unknown) => Promise<unknown>
  parseDataverseUploadParams: (params: Record<string, unknown>) => {
    responseMode: 'summary' | 'full'
  }
  runDataverseUpload: (params: unknown) => Promise<Record<string, unknown>>
  summarizeDataverseUploadPayload: (
    payload: Record<string, unknown>,
  ) => Record<string, unknown>
  parsePendingDataverseCrateAdoptionParams: (params: Record<string, unknown>) => unknown
  adoptPendingDataverseRoCrate: (params: unknown) => Promise<Record<string, unknown>>
  parseDataverseDownloadParams: (params: Record<string, unknown>) => {
    responseMode: 'summary' | 'full'
  }
  runDataverseDownload: (params: unknown) => Promise<Record<string, unknown>>
  summarizeDataverseDownloadPayload: (
    payload: Record<string, unknown>,
  ) => Record<string, unknown>
  runCreateDefaultRoCrate: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
  loadCrateFromParams: (params: Record<string, unknown>) => {
    mode: 'local' | 'remote'
    crate: any
    cratePath?: string
  }
  parseResponseMode: (
    params: Record<string, unknown>,
    defaultMode?: 'summary' | 'full',
  ) => 'summary' | 'full'
  summarizeCratePayload: (
    crate: any,
    mode: 'local' | 'remote',
    cratePath?: string,
  ) => Record<string, unknown>
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
  collectMissingUpdateEntityIds: (crate: any, changeSet: unknown) => string[]
  applyChangeSet: (crate: any, changeSet: unknown) => any
  buildProfileConstraints: (
    crate: any,
    mode: 'local' | 'remote',
    resolutionInputs: unknown,
  ) => any
  applyContextModePatch: (
    crate: any,
    constraints: any,
    contextMode: unknown,
  ) => { crate: any; report: unknown }
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
  readProfileConformsToUpdateOps: (params: Record<string, unknown>) => {
    add: string[]
    remove: string[]
    set?: string[]
  }
  updateProfileConformsTo: (
    crate: any,
    entityId: string,
    ops: { add: string[]; remove: string[]; set?: string[] },
  ) => {
    previousUrls: string[]
    addedUrls: string[]
    removedUrls: string[]
    finalUrls: string[]
  }
  validateCrate: (crate: any, options: { strict: boolean }) => any
  validateCrateAgainstProfileConstraints: (
    crate: any,
    constraints: any,
    options: { requiredMode: 'allow_missing' | 'enforce_required' },
  ) => {
    valid: boolean
    errors: unknown[]
    warnings: unknown[]
    valueSetHints?: Record<string, unknown>
    valueSetViolations?: unknown[]
  }
  parseAccessMode: (params: Record<string, unknown>) => 'local' | 'remote'
  asRoCrate: (value: unknown) => any
  resolveMissingMetadataProfiles: (
    crate: any,
    mode: 'local' | 'remote',
    params?: Record<string, unknown>,
  ) => Promise<unknown>
  listWellKnownSchemas: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  listRemoteSchemaTree: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  importWellKnownSchema: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  listMetadataProfiles: (params: Record<string, unknown>) => Record<string, unknown>
  importMetadataProfile: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  deleteMetadataProfileTool: (params: Record<string, unknown>) => Promise<Record<string, unknown>>
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
  prepareRemoteProfilePayload: (
    params: Record<string, unknown>,
  ) => Record<string, unknown>
  createProfileContext: (params: Record<string, unknown>) => Record<string, unknown>
  getProfileContextInfo: (params: Record<string, unknown>) => Record<string, unknown>
  deleteProfileContext: (params: Record<string, unknown>) => Record<string, unknown>
  listSchemaRegistry: (params: Record<string, unknown>) => Record<string, unknown>
  registerSchemaRegistry: (params: Record<string, unknown>) => Record<string, unknown>
  runOntologyTool: (
    toolName: string,
    loaded: { mode: 'local' | 'remote'; crate: any; cratePath?: string },
    params: Record<string, unknown>,
    registeredSchemas: SchemaRegistryEntry[],
  ) => Promise<Record<string, unknown> | null>
  getRegisteredSchemasForMode: (mode: 'local' | 'remote') => SchemaRegistryEntry[]
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
    parsePendingDataverseCrateAdoptionParams,
    adoptPendingDataverseRoCrate,
    parseDataverseDownloadParams,
    runDataverseDownload,
    summarizeDataverseDownloadPayload,
    runCreateDefaultRoCrate,
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
    collectMissingUpdateEntityIds,
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
    parseAccessMode,
    asRoCrate,
    resolveMissingMetadataProfiles,
    listWellKnownSchemas,
    listRemoteSchemaTree,
    importWellKnownSchema,
    listMetadataProfiles,
    importMetadataProfile,
    deleteMetadataProfileTool,
    summarizeProfileResolution,
    buildRoCrateContext,
    summarizeRoCrateContext,
    buildContextTermSuggestion,
    resolveProfileUrls,
    prepareRemoteProfilePayload,
    createProfileContext,
    getProfileContextInfo,
    deleteProfileContext,
    listSchemaRegistry,
    registerSchemaRegistry,
    runOntologyTool,
    getRegisteredSchemasForMode,
  } = deps

  function collectDestructiveChangeReasons(changeSet: unknown): string[] {
    if (!changeSet || typeof changeSet !== 'object' || Array.isArray(changeSet)) {
      return []
    }
    const record = changeSet as Record<string, unknown>
    const reasons: string[] = []

    const removeEntities = Array.isArray(record.removeEntities)
      ? record.removeEntities.filter((item): item is string => typeof item === 'string')
      : []
    if (removeEntities.length > 0) {
      reasons.push(`removeEntities(${removeEntities.length})`)
    }

    const removeHasPart = Array.isArray(record.removeHasPart)
      ? record.removeHasPart
      : []
    if (removeHasPart.length > 0) {
      reasons.push(`removeHasPart(${removeHasPart.length})`)
    }

    const updates = Array.isArray(record.updateEntities)
      ? record.updateEntities
      : []
    let unsetCount = 0
    for (const update of updates) {
      if (!update || typeof update !== 'object' || Array.isArray(update)) {
        continue
      }
      const unsetRaw = (update as Record<string, unknown>).unset
      const unset = Array.isArray(unsetRaw)
        ? unsetRaw.filter((item): item is string => typeof item === 'string')
        : []
      unsetCount += unset.length
    }
    if (unsetCount > 0) {
      reasons.push(`updateEntities.unset(${unsetCount})`)
    }

    const setRootFields =
      record.setRootFields &&
      typeof record.setRootFields === 'object' &&
      !Array.isArray(record.setRootFields)
        ? (record.setRootFields as Record<string, unknown>)
        : undefined
    if (setRootFields && Object.prototype.hasOwnProperty.call(setRootFields, 'hasPart')) {
      reasons.push('setRootFields.hasPart')
    }

    return reasons
  }

  function collectInvalidGraphMutationReasons(changeSet: unknown): string[] {
    if (!changeSet || typeof changeSet !== 'object' || Array.isArray(changeSet)) {
      return []
    }
    const record = changeSet as Record<string, unknown>
    const reasons: string[] = []

    const setRootFields =
      record.setRootFields &&
      typeof record.setRootFields === 'object' &&
      !Array.isArray(record.setRootFields)
        ? (record.setRootFields as Record<string, unknown>)
        : undefined
    if (setRootFields && Object.prototype.hasOwnProperty.call(setRootFields, '@graph')) {
      reasons.push('setRootFields.@graph')
    }

    const addEntities = Array.isArray(record.addEntities) ? record.addEntities : []
    for (const entity of addEntities) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      const entityId =
        typeof (entity as Record<string, unknown>)['@id'] === 'string'
          ? String((entity as Record<string, unknown>)['@id'])
          : '<unknown>'
      if (Object.prototype.hasOwnProperty.call(entity, '@graph')) {
        reasons.push(`addEntities(${entityId}).@graph`)
      }
    }

    const updates = Array.isArray(record.updateEntities) ? record.updateEntities : []
    for (const update of updates) {
      if (!update || typeof update !== 'object' || Array.isArray(update)) {
        continue
      }
      const updateRecord = update as Record<string, unknown>
      const entityId =
        typeof updateRecord['@id'] === 'string' ? updateRecord['@id'] : '<unknown>'
      const merge =
        updateRecord.merge &&
        typeof updateRecord.merge === 'object' &&
        !Array.isArray(updateRecord.merge)
          ? (updateRecord.merge as Record<string, unknown>)
          : undefined
      if (merge && Object.prototype.hasOwnProperty.call(merge, '@graph')) {
        reasons.push(`updateEntities(${entityId}).merge.@graph`)
      }
      if (
        Object.prototype.hasOwnProperty.call(updateRecord, '@graph') &&
        updateRecord['@graph'] !== undefined
      ) {
        reasons.push(`updateEntities(${entityId}).@graph`)
      }
    }

    return reasons
  }

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

      const runInTelemetryContext = async <T>(fn: () => Promise<T>): Promise<T> => {
        if (collector && telemetryId) {
          return collector.runWithToolCallContext(telemetryId, fn)
        }
        return fn()
      }

      if (toolName === 'set_agent_session_context') {
        const result = setAgentSessionContext(telemetryContext?.sessionKey, params)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'read_agent_workflow_doc') {
        const result = readAgentWorkflowDoc(
          params,
          getAgentSessionContext(telemetryContext?.sessionKey),
        )
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'open_aroma_for_local_file') {
        const result = registerLocalFileForAroma(params)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'search') {
        const result = await runInTelemetryContext(async () => {
          const searchParams = parseWebSearchParams(params)
          return runWebSearch(searchParams)
        })
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'download_url') {
        const result = await runInTelemetryContext(async () => {
          const downloadParams = parseDownloadUrlParams(params)
          return runDownloadUrl(downloadParams)
        })
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'list_well_known_schemas') {
        const result = await runInTelemetryContext(async () => listWellKnownSchemas(params))
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'list_remote_schema_tree') {
        const result = await runInTelemetryContext(async () => listRemoteSchemaTree(params))
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'import_well_known_schema') {
        const result = await runInTelemetryContext(async () => importWellKnownSchema(params))
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'list_metadata_profiles') {
        const result = listMetadataProfiles(params)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'import_metadata_profile') {
        const result = await runInTelemetryContext(async () => importMetadataProfile(params))
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'delete_metadata_profile') {
        const result = await runInTelemetryContext(async () =>
          deleteMetadataProfileTool(params),
        )
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'upload_rocrate_to_dataverse') {
        try {
          const { uploadParams, payload } = await runInTelemetryContext(async () => {
            const uploadParams = parseDataverseUploadParams(params)
            const payload = await runDataverseUpload(uploadParams)
            return { uploadParams, payload }
          })
          if (collector && telemetryId) {
            collector.completeToolCallSuccess(telemetryId, payload)
          }
          if (uploadParams.responseMode === 'full') {
            return textResult(payload)
          }
          return textResult(summarizeDataverseUploadPayload(payload))
        } catch (error) {
          if (
            error instanceof DataversePreflightValidationError ||
            error instanceof DataverseAuthenticationError
          ) {
            if (collector && telemetryId) {
              collector.completeToolCallError(telemetryId, error)
            }
            return textResult(error.toMcpPayload(), true)
          }
          throw error
        }
      }

      if (toolName === 'adopt_pending_dataverse_rocrate') {
        const payload = await runInTelemetryContext(async () => {
          const adoptParams = parsePendingDataverseCrateAdoptionParams(params)
          return adoptPendingDataverseRoCrate(adoptParams)
        })
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, payload)
        }
        return textResult(payload)
      }

      if (toolName === 'download_rocrate_from_dataverse') {
        const { downloadParams, payload } = await runInTelemetryContext(async () => {
          const downloadParams = parseDataverseDownloadParams(params)
          const payload = await runDataverseDownload(downloadParams)
          return { downloadParams, payload }
        })
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
        return textResult(
          summarizeCratePayload(loaded.crate, loaded.mode, loaded.cratePath),
        )
      }

      if (toolName === 'create_default_rocrate') {
        const payload = await runCreateDefaultRoCrate(params)
        const responseMode = parseResponseMode(params, 'summary')
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
          directoryPath: payload.directoryPath,
          cratePath: payload.cratePath,
          ignoredFilePath: payload.ignoredFilePath,
          summary: payload.summary,
          crateSummary: payload.crateSummary,
        })
      }

      if (toolName === 'apply_changes') {
        const loaded = loadCrateFromParams(params)
        const dryRun = params.dryRun === true
        const resolutionInputs = parseProfileResolutionInputs(params)
        const profileRequiredMode = parseProfileRequiredMode(params, 'allow_missing')
        const contextMode = parseContextMode(params, 'auto_reconcile')
        const normalizedChangeSet = normalizeChangeSet(params.changeSet)
        const missingUpdateTargets = collectMissingUpdateEntityIds(
          loaded.crate,
          normalizedChangeSet,
        )
        if (missingUpdateTargets.length > 0) {
          throw new Error(
            `apply_changes updateEntities target(s) not found in @graph: ${missingUpdateTargets.join(', ')}. Add entities first via addEntities or correct the IDs.`,
          )
        }
        const profileChangeTargets = detectProfileChangeTargets(
          loaded.crate,
          normalizedChangeSet,
        )
        if (profileChangeTargets.length > 0) {
          throw new Error(
            `conformsTo update blocked in apply_changes for Dataset/File entity IDs: ${profileChangeTargets.join(', ')}. Use update_profile_conforms_to.`,
          )
        }
        const destructiveReasons = collectDestructiveChangeReasons(normalizedChangeSet)
        const invalidGraphMutationReasons =
          collectInvalidGraphMutationReasons(normalizedChangeSet)
        if (invalidGraphMutationReasons.length > 0) {
          throw new Error(
            `Invalid @graph mutation blocked (${invalidGraphMutationReasons.join(', ')}). @graph may only appear at the top level of the RO-Crate, never on individual entities or inside setRootFields.`,
          )
        }
        if (
          destructiveReasons.length > 0 &&
          !dryRun &&
          params.confirmDestructive !== true
        ) {
          throw new Error(
            `Destructive apply_changes blocked (${destructiveReasons.join(', ')}). Re-run only after explicit user approval with confirmDestructive=true.`,
          )
        }
        const changed = applyChangeSet(loaded.crate, normalizedChangeSet)
        await runInTelemetryContext(async () =>
          resolveMissingMetadataProfiles(changed, loaded.mode, params),
        )
        const responseMode = parseResponseMode(
          params,
          loaded.mode === 'remote' ? 'full' : 'summary',
        )
        const preConstraints = buildProfileConstraints(
          changed,
          loaded.mode,
          resolutionInputs,
        )
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
          const cratePath = loaded.cratePath ?? resolveCratePath()
          const indent = typeof params.indent === 'number' ? params.indent : 2
          if (!dryRun) {
            writeCrateAtomic(cratePath, updated, indent)
          }
          const payload = {
            crate: updated,
            mode: loaded.mode,
            writeApplied: dryRun ? false : true,
            cratePath,
            profileRequiredMode,
            contextMode,
            contextPatchReport: contextPatched.report,
            profileResolution: constraints.resolution,
            note: dryRun
              ? 'Dry-run mode: no file was written. Re-run with dryRun=false (default) to persist.'
              : undefined,
          }
          if (collector && telemetryId) {
            collector.completeToolCallSuccess(telemetryId, payload)
          }
          if (responseMode === 'full') {
            return textResult(payload)
          }
          return textResult(
            summarizeApplyChangesPayload(
              payload,
              updated,
              normalizedChangeSet,
              constraints,
            ),
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
            summarizeApplyChangesPayload(
              payload,
              updated,
              normalizedChangeSet,
              constraints,
            ),
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

        const { previousUrls, addedUrls, removedUrls, finalUrls } =
          updateProfileConformsTo(loaded.crate, entityId, ops)
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
        await runInTelemetryContext(async () =>
          resolveMissingMetadataProfiles(loaded.crate, loaded.mode, params),
        )
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
        const coreErrors = Array.isArray(report.errors) ? report.errors : []
        const coreWarnings = Array.isArray(report.warnings) ? report.warnings : []
        const profileErrors = Array.isArray(profileValidation.errors)
          ? profileValidation.errors
          : []
        const profileWarnings = Array.isArray(profileValidation.warnings)
          ? profileValidation.warnings
          : []
        const errors = [...coreErrors, ...profileErrors]
        const warnings = [...coreWarnings, ...profileWarnings]
        const payload = {
          valid: report.valid === true && profileValidation.valid === true,
          summary: {
            errors: errors.length,
            warnings: warnings.length,
          },
          errors,
          warnings,
          valueSetHints:
            profileValidation.valueSetHints &&
            typeof profileValidation.valueSetHints === 'object'
              ? profileValidation.valueSetHints
              : {},
          valueSetViolations: Array.isArray(profileValidation.valueSetViolations)
            ? profileValidation.valueSetViolations
            : [],
        }
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, payload)
        }
        return textResult(payload)
      }

      if (toolName === 'write_crate_atomic') {
        const mode = parseAccessMode(params)
        const responseMode = parseResponseMode(
          params,
          mode === 'remote' ? 'full' : 'summary',
        )
        const resolutionInputs = parseProfileResolutionInputs(params)
        const profileRequiredMode = parseProfileRequiredMode(params, 'allow_missing')
        const contextMode = parseContextMode(params, 'auto_reconcile')
        const crateParam = params.crate
        if (!crateParam || typeof crateParam !== 'object' || Array.isArray(crateParam)) {
          throw new Error('write_crate_atomic requires crate object.')
        }
        const crate = asRoCrate(crateParam)
        await runInTelemetryContext(async () =>
          resolveMissingMetadataProfiles(crate, mode, params),
        )
        const preConstraints = buildProfileConstraints(
          crate,
          mode,
          resolutionInputs,
        )
        const contextPatched = applyContextModePatch(crate, preConstraints, contextMode)
        const updated = contextPatched.crate
        const constraints = ensureProfileConformanceOrThrow(
          updated,
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
            crate: updated,
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
          return textResult({
            ok: true,
            mode: payload.mode,
            writeApplied: payload.writeApplied,
            profileRequiredMode: payload.profileRequiredMode,
            contextMode: payload.contextMode,
            profileResolution: summarizeProfileResolution(constraints.resolution),
            crateSummary: summarizeCratePayload(updated, mode),
            note: payload.note,
          })
        }
        const cratePath = ensureCratePath(params.cratePath)
        const indent = typeof params.indent === 'number' ? params.indent : 2
        writeCrateAtomic(cratePath, updated, indent)
        const payload = {
          ok: true,
          mode: 'local',
          writeApplied: true,
          cratePath,
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
        return textResult({
          ok: payload.ok,
          mode: payload.mode,
          writeApplied: payload.writeApplied,
          cratePath: payload.cratePath,
          profileRequiredMode: payload.profileRequiredMode,
          contextMode: payload.contextMode,
          profileResolution: summarizeProfileResolution(constraints.resolution),
          crateSummary: summarizeCratePayload(updated, mode, cratePath),
        })
      }

      if (toolName === 'get_rocrate_context') {
        const loaded = loadCrateFromParams(params)
        const resolutionInputs = parseProfileResolutionInputs(params)
        await runInTelemetryContext(async () =>
          resolveMissingMetadataProfiles(loaded.crate, loaded.mode, params),
        )
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
        await runInTelemetryContext(async () =>
          resolveMissingMetadataProfiles(loaded.crate, loaded.mode, params),
        )
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

      if (
        toolName === 'list_types' ||
        toolName === 'suggest_types' ||
        toolName === 'get_type_details' ||
        toolName === 'list_properties_for_type' ||
        toolName === 'suggest_properties' ||
        toolName === 'get_property_details'
      ) {
        const loaded = loadCrateFromParams(params)
        const registeredSchemas = getRegisteredSchemasForMode(loaded.mode)
        const payload = await runOntologyTool(
          toolName,
          loaded,
          params,
          registeredSchemas,
        )
        if (!payload) {
          throw new Error(`Ontology tool handler returned no payload for tool ${toolName}`)
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
        return textResult(payload)
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
        if (mode === 'local') {
          await runInTelemetryContext(async () =>
            resolveMissingMetadataProfiles(
              { '@graph': [{ '@id': './', '@type': 'Dataset', conformsTo: { '@id': profileUrl } }] },
              mode,
              params,
            ),
          )
        }
        const result = resolveProfileUrls(
          [profileUrl],
          mode,
          includeProfileContent,
          resolutionInputs,
        )
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

      if (toolName === 'list_schema_registry') {
        const result = listSchemaRegistry(params)
        if (collector && telemetryId) {
          collector.completeToolCallSuccess(telemetryId, result)
        }
        return textResult(result)
      }

      if (toolName === 'register_schema') {
        const result = registerSchemaRegistry(params)
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
