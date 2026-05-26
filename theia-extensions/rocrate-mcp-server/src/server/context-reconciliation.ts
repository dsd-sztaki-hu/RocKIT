import { applyChangeSet } from '../core'
import type { RoCrate } from '../core/types'
import type {
  ContextAutoPatchReport,
  ContextMode,
  ProfileConstraints,
  ProfileTermIriResolution,
} from './types'

type ContextDeps = {
  defaultContextKnownTerms: Set<string>
}

/**
 * Builds helpers that detect and reconcile @context term issues using
 * declared profile input definitions.
 */
export function createContextReconciliationHelpers(deps: ContextDeps) {
  /**
   * Handles collect declared context terms.
   */
  function collectDeclaredContextTerms(crate: RoCrate): Set<string> {
    const terms = new Set<string>()
    const context = crate['@context']
    const collect = (item: unknown): void => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return
      }
      for (const [key] of Object.entries(item as Record<string, unknown>)) {
        if (typeof key === 'string' && key.trim() !== '') {
          terms.add(key)
        }
      }
    }

    if (Array.isArray(context)) {
      for (const item of context) {
        collect(item)
      }
      return terms
    }

    collect(context)
    return terms
  }

  /**
   * Handles collect used graph terms.
   */
  function collectUsedGraphTerms(crate: RoCrate): Set<string> {
    const terms = new Set<string>()
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      for (const key of Object.keys(entity)) {
        if (key.startsWith('@')) {
          continue
        }
        terms.add(key)
      }
    }
    return terms
  }

  /**
   * Builds a term -> IRI map from resolved profiles.
   *
   * Terms mapping to multiple different IRIs are marked as ambiguous and excluded
   * from auto-merge to avoid unsafe automatic changes.
   */
  function collectProfileTermIriResolution(
    constraints: ProfileConstraints,
  ): ProfileTermIriResolution {
    const iriCandidates = new Map<string, Set<string>>()
    for (const profile of constraints.resolution.profiles) {
      const content = profile.profile
      if (!content) {
        continue
      }
      const classesValue = content.classes
      if (
        !classesValue ||
        typeof classesValue !== 'object' ||
        Array.isArray(classesValue)
      ) {
        continue
      }
      for (const classValue of Object.values(classesValue as Record<string, unknown>)) {
        if (!classValue || typeof classValue !== 'object' || Array.isArray(classValue)) {
          continue
        }
        const inputs = (classValue as Record<string, unknown>).inputs
        if (!Array.isArray(inputs)) {
          continue
        }
        for (const input of inputs) {
          if (!input || typeof input !== 'object' || Array.isArray(input)) {
            continue
          }
          const name = (input as Record<string, unknown>).name
          const iri = (input as Record<string, unknown>).id
          if (
            typeof name === 'string' &&
            name.trim() !== '' &&
            typeof iri === 'string' &&
            iri.trim() !== ''
          ) {
            const trimmedName = name.trim()
            const trimmedIri = iri.trim()
            const existing = iriCandidates.get(trimmedName)
            if (existing) {
              existing.add(trimmedIri)
            } else {
              iriCandidates.set(trimmedName, new Set<string>([trimmedIri]))
            }
          }
        }
      }
    }
    const termToIri: Record<string, string> = {}
    const ambiguousTerms: string[] = []
    for (const [term, iris] of Array.from(iriCandidates.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const values = Array.from(iris.values()).sort((a, b) => a.localeCompare(b))
      if (values.length === 1) {
        termToIri[term] = values[0]
        continue
      }
      ambiguousTerms.push(term)
    }
    return {
      termToIri,
      ambiguousTerms,
    }
  }

  /**
   * Handles collect declared context mappings.
   */
  function collectDeclaredContextMappings(crate: RoCrate): Record<string, string> {
    const mappings: Record<string, string> = {}
    const context = crate['@context']
    const collect = (item: unknown): void => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return
      }
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim() !== '') {
          mappings[key] = value.trim()
        }
      }
    }
    if (Array.isArray(context)) {
      for (const item of context) {
        collect(item)
      }
      return mappings
    }
    collect(context)
    return mappings
  }

  /**
   * Handles apply context update.
   */
  function applyContextUpdate(
    crate: RoCrate,
    contextUpdate: Record<string, string>,
  ): RoCrate {
    if (Object.keys(contextUpdate).length === 0) {
      return crate
    }
    return applyChangeSet(crate, { mergeContext: contextUpdate })
  }

  /**
   * Suggests `mergeContext` additions for terms used in @graph but missing
   * from @context/default terms.
   *
   * Returns both resolvable additions and unresolved/ambiguous term lists.
   */
  function buildContextTermSuggestion(
    crate: RoCrate,
    constraints?: ProfileConstraints,
  ): {
    mergeContext: Record<string, string>
    missingTerms: string[]
    unknownTerms: string[]
    usedTerms: string[]
    declaredTerms: string[]
  } {
    const usedTerms = collectUsedGraphTerms(crate)
    const declaredTerms = collectDeclaredContextTerms(crate)
    const termResolution = constraints
      ? collectProfileTermIriResolution(constraints)
      : { termToIri: {}, ambiguousTerms: [] }
    const profileTermIriMap = termResolution.termToIri
    const ambiguousTerms = new Set<string>(termResolution.ambiguousTerms)
    const mergeContext: Record<string, string> = {}
    const missingTerms: string[] = []
    const unknownTerms: string[] = []
    for (const term of Array.from(usedTerms).sort((a, b) => a.localeCompare(b))) {
      if (declaredTerms.has(term)) {
        continue
      }
      if (deps.defaultContextKnownTerms.has(term)) {
        continue
      }
      missingTerms.push(term)
      if (ambiguousTerms.has(term)) {
        unknownTerms.push(term)
        continue
      }
      const profileIri = profileTermIriMap[term]
      if (profileIri) {
        mergeContext[term] = profileIri
      } else {
        unknownTerms.push(term)
      }
    }

    return {
      mergeContext,
      missingTerms,
      unknownTerms,
      usedTerms: Array.from(usedTerms).sort((a, b) => a.localeCompare(b)),
      declaredTerms: Array.from(declaredTerms).sort((a, b) => a.localeCompare(b)),
    }
  }

  /**
   * Applies context auto-patching according to mode:
   * - `strict`: no changes
   * - `auto_add`: add only missing unambiguous terms
   * - `auto_reconcile`: add missing terms and reconcile conflicting mappings
   */
  function applyContextModePatch(
    crate: RoCrate,
    constraints: ProfileConstraints,
    contextMode: ContextMode,
  ): { crate: RoCrate; report: ContextAutoPatchReport } {
    const report: ContextAutoPatchReport = {
      mode: contextMode,
      addedTerms: [],
      reconciledTerms: [],
      skippedConflicts: [],
      ambiguousTerms: [],
    }
    if (contextMode === 'strict') {
      return { crate, report }
    }

    const suggestion = buildContextTermSuggestion(crate, constraints)
    const usedTerms = new Set<string>(suggestion.usedTerms)
    const declaredMappings = collectDeclaredContextMappings(crate)
    const termResolution = collectProfileTermIriResolution(constraints)
    report.ambiguousTerms = termResolution.ambiguousTerms

    const contextUpdate: Record<string, string> = {}
    for (const [term, iri] of Object.entries(suggestion.mergeContext)) {
      contextUpdate[term] = iri
      report.addedTerms.push(term)
    }

    if (contextMode === 'auto_reconcile') {
      for (const term of usedTerms) {
        const expectedIri = termResolution.termToIri[term]
        const currentIri = declaredMappings[term]
        if (!expectedIri || !currentIri || expectedIri === currentIri) {
          continue
        }
        contextUpdate[term] = expectedIri
        report.reconciledTerms.push({ term, from: currentIri, to: expectedIri })
      }
    } else if (contextMode === 'auto_add') {
      for (const term of usedTerms) {
        const expectedIri = termResolution.termToIri[term]
        const currentIri = declaredMappings[term]
        if (!expectedIri || !currentIri || expectedIri === currentIri) {
          continue
        }
        report.skippedConflicts.push({ term, from: currentIri, expected: expectedIri })
      }
    }

    if (Object.keys(contextUpdate).length === 0) {
      return { crate, report }
    }
    return { crate: applyContextUpdate(crate, contextUpdate), report }
  }

  return {
    collectDeclaredContextTerms,
    collectUsedGraphTerms,
    collectProfileTermIriResolution,
    collectDeclaredContextMappings,
    applyContextUpdate,
    applyContextModePatch,
    buildContextTermSuggestion,
  }
}
