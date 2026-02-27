export const DEFAULT_ROCRATE_CONTEXT = 'https://w3id.org/ro/crate/1.1/context'

export type RoCrateReference = { '@id': string }

export type RoCrateEntity = {
  '@id'?: string
  '@type'?: string | string[]
  name?: string
  hasPart?: RoCrateReference[] | RoCrateReference
  [key: string]: unknown
}

export type RoCrate = {
  '@context'?: unknown
  '@graph'?: RoCrateEntity[]
  [key: string]: unknown
}

export type RoCrateEntityUpdate = {
  '@id': string
  merge?: Record<string, unknown>
  [key: string]: unknown
}

export type RoCrateHasPartEdge = {
  dataset: string
  child: string
}

export type RoCrateChangeSet = {
  addEntities?: RoCrateEntity[]
  updateEntities?: RoCrateEntityUpdate[]
  removeEntities?: string[]
  setRootFields?: Record<string, unknown>
  addHasPart?: RoCrateHasPartEdge[]
  removeHasPart?: RoCrateHasPartEdge[]
  mergeContext?: Record<string, unknown>
}

export type RoCrateDelta = {
  summary: {
    newEntities: number
    newHasPartEdges: number
    directoriesSeen: number
    filesSeen: number
  }
  addEntities: RoCrateEntity[]
  addHasPart: RoCrateHasPartEdge[]
}

export type ValidationIssue = {
  code: string
  message: string
  path: string
}

export type RoCrateValidationReport = {
  valid: boolean
  summary: {
    errors: number
    warnings: number
  }
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}
