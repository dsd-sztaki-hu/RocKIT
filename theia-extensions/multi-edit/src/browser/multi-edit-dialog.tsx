import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import * as React from '@theia/core/shared/react'
import { Alert, Button, DatePicker, Input, Select, Switch } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import type { MetadataSchemaManager, SchemaInfo } from 'aroma2-common/lib/browser'
import schemaTypeDefinitions = require('./schema-type-definitions.json')
import { isSchemaOrgPropertyAllowedForHierarchy } from './schema-type-property-restrictions'

import dayjs = require('dayjs')

type BulkOperator = 'add' | 'remove' | 'set' | 'unset'
type FieldValueKind = 'text' | 'url' | 'number' | 'date' | 'select' | 'json' | 'entity'

interface FieldDefinition {
  key: string
  className: string
  classLabel: string
  supportedClasses?: string[]
  schemaId: string
  schemaLabel: string
  schemaGroupName: string
  schemaUrl?: string
  propertyName: string
  label: string
  help?: string
  multiple: boolean
  valueKind: FieldValueKind
  valueKinds?: FieldValueKind[]
  selectValues: string[]
  entityTypes: string[]
  appliesToAll?: boolean
}

interface SchemaOption {
  id: string
  label: string
  url?: string
}

interface OperationRow {
  id: string
  fieldKey?: string
  operator: BulkOperator
  value: string
  valueKind?: FieldValueKind
}

interface PreparedOperation {
  operation: OperationRow
  rowIndex: number
  field?: FieldDefinition
  valueKind?: FieldValueKind
  parsedValue?: unknown
  schemaUrl?: string
}

interface EntitySummary {
  id: string
  name: string
  type: string | string[]
}

interface ExecutionSummary {
  processedEntities: number
  updatedEntities: number
  appliedOperations: number
  skippedOperations: number
  errors: string[]
}

interface SchemaMeta {
  id: string
  label: string
  url?: string
  selectable: boolean
}

interface SchemaTypeDefinitionInput {
  id?: string
  name?: string
  label?: string
  help?: string
  multiple?: boolean | string
  type?: string | string[]
  values?: unknown[]
}

interface SchemaTypeDefinition {
  id?: string
  name?: string
  label?: string
  help?: string
  subClassOf?: string[]
  hierarchy?: string[]
  inputs?: SchemaTypeDefinitionInput[]
}

const SCHEMA_TYPE_DEFINITIONS = schemaTypeDefinitions as Record<
  string,
  SchemaTypeDefinition
>
const SCHEMA_ORG_SCHEMA_ID = '__schemaorg__'
const SCHEMA_ORG_LABEL = 'schema.org'
const OTHER_ONTOLOGIES_LABEL = 'Other ontologies'

const OPERATOR_LABELS: Record<BulkOperator, string> = {
  add: 'Add',
  remove: 'Remove',
  set: 'Set',
  unset: 'Unset',
}

const VALUE_KIND_LABELS: Record<FieldValueKind, string> = {
  text: 'Text',
  url: 'URL',
  number: 'Number',
  date: 'Date',
  select: 'Option list',
  json: 'JSON',
  entity: 'PropertyValue',
}

const VALUE_KIND_PRIORITY: Record<FieldValueKind, number> = {
  select: 0,
  entity: 1,
  date: 2,
  number: 3,
  json: 4,
  text: 5,
  url: 6,
}

export class MultiEditDialog extends ReactDialog<string> {
  protected readonly fieldsByKey = new Map<string, FieldDefinition>()
  protected readonly schemaOrgFieldsByKey = new Map<string, FieldDefinition>()
  protected readonly operations: OperationRow[] = []

  protected schemaOptions: SchemaOption[] = []
  protected selectedSchemaIds = new Set<string>()
  protected schemaUrlsById = new Map<string, string>()
  protected schemaConformsLookupCache?: Map<string, string>

  protected schemaOrgEnabled = false
  protected selectedEntities: Record<string, any>[] = []

  protected startButton?: HTMLButtonElement
  protected hideSetupWarning = false

  protected entitySummaries: EntitySummary[] = []
  protected showEntityList = false
  protected entitySearch = ''

  protected executionSummary?: ExecutionSummary
  protected configurationError?: string
  protected isExecuting = false
  protected profileData?: Record<string, any>
  protected readonly operationSearch = new Map<string, string>()
  protected readonly pendingMultiTextSelection = new Map<
    string,
    { start: number; end: number }
  >()

  constructor(
    private readonly entityIds: string[],
    private readonly appStateService: AppStateService,
    private readonly schemaManagerService?: MetadataSchemaManager,
    private readonly roCrateHistoryService?: RoCrateHistoryService,
  ) {
    super({ title: 'Multi Edit' })
    this.startButton = this.appendButton('Start multi-edit', true)
    this.startButton.addEventListener('click', () => void this.runOperations())
    this.appendCloseButton('Close')
    this.initialize()
  }

  /**
   * Initializes dialog state from current crate/profile data.
   * @returns void
   * @protected
   */
  protected initialize(): void {
    const crate = this.appStateService.roCrate
    const profile = this.appStateService.completeProfile ?? this.appStateService.profile
    this.profileData = profile

    if (!crate || !Array.isArray(crate['@graph'])) {
      this.configurationError = 'RO-Crate data is not available.'
      return
    }

    if (!profile?.classes) {
      this.configurationError = 'Profile data is not available.'
      return
    }

    this.entitySummaries = this.buildEntitySummaries(crate, profile)
    this.selectedEntities = this.collectSelectedEntities(crate)

    const entityTypes = this.collectEntityTypes(crate)
    if (entityTypes.length === 0) {
      this.configurationError =
        'No editable entities were found in the current selection.'
      return
    }

    const { fields, schemas } = this.buildFieldCatalog(profile, entityTypes)
    for (const field of fields) {
      this.fieldsByKey.set(field.key, field)
    }
    const schemaOrgFields = this.buildSchemaOrgFields(crate, profile)
    for (const field of schemaOrgFields) {
      this.schemaOrgFieldsByKey.set(field.key, field)
    }

    this.schemaOptions = this.mergeSchemaOptions(schemas)
    this.selectedSchemaIds = new Set()

    if (this.operations.length === 0) {
      this.operations.push(this.createOperation())
    }
  }

  /**
   * Creates a default empty operation row.
   * @returns New operation definition.
   * @protected
   */
  protected createOperation(): OperationRow {
    return {
      id: `op-${Math.random().toString(36).slice(2, 10)}`,
      operator: 'set',
      value: '',
    }
  }

  /**
   * Builds display metadata for selected entities.
   * @param crate Active RO-Crate document.
   * @param profile Active profile definition.
   * @returns Entity summary rows for the UI.
   * @protected
   */
  protected buildEntitySummaries(
    crate: Record<string, any>,
    profile: Record<string, any>,
  ): EntitySummary[] {
    const graph = Array.isArray(crate['@graph'])
      ? (crate['@graph'] as Record<string, any>[])
      : []
    const entitiesById = new Map<string, Record<string, any>>()
    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      const id = typeof entry['@id'] === 'string' ? entry['@id'] : ''
      if (!id || entitiesById.has(id)) {
        continue
      }
      entitiesById.set(id, entry)
    }
    const result: EntitySummary[] = []
    for (const entityId of this.entityIds) {
      const entity = entitiesById.get(entityId)
      if (!entity) {
        result.push({ id: entityId, name: entityId, type: 'Unknown' })
        continue
      }
      const typeNames = this.getEntityTypeNames(entity)
      const localizedTypes = typeNames.length
        ? typeNames.map((typeName) => {
            const localized =
              profile?.localisation?.[typeName] ?? profile?.classes?.[typeName]?.label
            return String(localized ?? typeName)
          })
        : ['Unknown']
      const displayName = this.getEntityDisplayName(entity)
      result.push({
        id: entityId,
        name: displayName,
        type: localizedTypes.length > 1 ? localizedTypes : localizedTypes[0],
      })
    }
    return result
  }

  /**
   * Collects unique entity types from the selected entity ids.
   * @param crate Active RO-Crate document.
   * @returns Sorted list of selected entity types.
   * @protected
   */
  protected collectEntityTypes(crate: Record<string, any>): string[] {
    const graph = Array.isArray(crate['@graph'])
      ? (crate['@graph'] as Record<string, any>[])
      : []
    const selected = new Set(this.entityIds)
    const types = new Set<string>()

    for (const entity of graph) {
      const id = entity?.['@id']
      if (!id || !selected.has(String(id))) {
        continue
      }
      const typeNames = this.getEntityTypeNames(entity)
      for (const typeName of typeNames) {
        types.add(typeName)
      }
    }

    return Array.from(types.values()).sort((a, b) => a.localeCompare(b))
  }

  /**
   * Collects selected entity records for field applicability checks.
   * @param crate Active RO-Crate document.
   * @returns Selected entity objects.
   * @protected
   */
  protected collectSelectedEntities(crate: Record<string, any>): Record<string, any>[] {
    const graph = Array.isArray(crate['@graph'])
      ? (crate['@graph'] as Record<string, any>[])
      : []
    const selected = new Set(this.entityIds)
    const entities: Record<string, any>[] = []
    for (const entity of graph) {
      const id = typeof entity?.['@id'] === 'string' ? entity['@id'] : ''
      if (!id || !selected.has(id)) {
        continue
      }
      entities.push(entity)
    }
    return entities
  }

  /**
   * Builds editable field definitions and schema options from profile classes/layouts.
   * @param profile Active profile definition.
   * @param entityTypes Selected entity types.
   * @returns Field catalog and selectable schema list.
   * @protected
   */
  protected buildFieldCatalog(
    profile: Record<string, any>,
    entityTypes: string[],
  ): { fields: FieldDefinition[]; schemas: SchemaOption[] } {
    const classes = profile.classes as Record<string, any>
    const layouts = Array.isArray(profile.layouts)
      ? (profile.layouts as Record<string, any>[])
      : []
    const localisation = (profile.localisation ?? {}) as Record<string, string>

    const fieldsByKey = new Map<string, FieldDefinition>()
    const schemasById = new Map<string, SchemaOption>()
    this.schemaUrlsById = new Map()

    for (const className of entityTypes) {
      const classDef = classes[className]
      if (!classDef) {
        continue
      }
      const classLabel = String(localisation[className] ?? classDef.label ?? className)
      const inputs = Array.isArray(classDef.inputs)
        ? (classDef.inputs as Record<string, any>[])
        : []
      const layout = this.findLayoutForClass(layouts, className)

      for (const input of inputs) {
        const propertyName = typeof input.name === 'string' ? input.name.trim() : ''
        if (!propertyName) {
          continue
        }

        const groupName = this.getFieldGroup(input)
        const schemaMeta = this.resolveSchemaMeta(layout, groupName)
        if (schemaMeta.selectable && !schemasById.has(schemaMeta.id)) {
          schemasById.set(schemaMeta.id, {
            id: schemaMeta.id,
            label: schemaMeta.label,
            url: schemaMeta.url,
          })
          if (schemaMeta.url && schemaMeta.url.trim().length > 0) {
            this.schemaUrlsById.set(schemaMeta.id, schemaMeta.url.trim())
          }
        }

        const relationshipTypes = this.extractEntityTypes(input, classes)
        const valueKinds = this.resolveValueKinds(input, classes, relationshipTypes)
        const field: FieldDefinition = {
          key: `${className}::${propertyName}`,
          className,
          classLabel,
          supportedClasses: [className],
          schemaId: schemaMeta.id,
          schemaLabel: schemaMeta.label,
          schemaGroupName: groupName,
          schemaUrl: schemaMeta.url,
          propertyName,
          label: String(input.label ?? propertyName),
          help: typeof input.help === 'string' ? input.help : undefined,
          multiple: this.parseBoolean(input.multiple),
          valueKind: valueKinds[0] ?? 'text',
          valueKinds,
          selectValues: Array.isArray(input.values)
            ? input.values
                .map((value) => String(value))
                .filter((value) => value.trim().length > 0)
            : [],
          entityTypes: relationshipTypes,
        }

        this.upsertFieldDefinition(fieldsByKey, field)
      }
    }

    this.addSchemaProfileFields(fieldsByKey, schemasById)

    const fields = Array.from(fieldsByKey.values())
    fields.sort((a, b) => {
      const labelCompare = a.label.localeCompare(b.label)
      if (labelCompare !== 0) {
        return labelCompare
      }
      return a.schemaLabel.localeCompare(b.schemaLabel)
    })

    const schemas = Array.from(schemasById.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    )

    return { fields, schemas }
  }

  /**
   * Builds and appends fields from crate-level schema profiles (profileList entries).
   * These fields are applicable to all selected entities when their schema is selected.
   * @param fieldsByKey Mutable field map.
   * @param schemasById Mutable schema map.
   * @returns void
   * @protected
   */
  protected addSchemaProfileFields(
    fieldsByKey: Map<string, FieldDefinition>,
    schemasById: Map<string, SchemaOption>,
  ): void {
    const profileList = Array.isArray(this.appStateService.profileList)
      ? this.appStateService.profileList
      : []
    const allowedSchemaUrls = new Set(this.extractConformsToUrlsFromCrate())

    for (const entry of profileList) {
      const schemaUrl = typeof entry?.id === 'string' ? entry.id.trim() : ''
      if (!schemaUrl || !allowedSchemaUrls.has(schemaUrl)) {
        continue
      }

      const schemaLabel = this.resolveSchemaLabelFromProfileEntry(entry, schemaUrl)
      const schemaId = this.normalizeSchemaId(schemaLabel)
      if (!schemaId) {
        continue
      }

      if (!schemasById.has(schemaId)) {
        schemasById.set(schemaId, { id: schemaId, label: schemaLabel, url: schemaUrl })
      }
      this.schemaUrlsById.set(schemaId, schemaUrl)

      const schemaProfile = entry?.content
      const schemaClasses =
        schemaProfile && typeof schemaProfile === 'object'
          ? ((schemaProfile.classes as Record<string, any> | undefined) ?? {})
          : {}
      const datasetClass = schemaClasses.Dataset
      const schemaInputs = Array.isArray(datasetClass?.inputs)
        ? (datasetClass.inputs as Record<string, any>[])
        : []
      if (schemaInputs.length === 0) {
        continue
      }

      const schemaLayouts = Array.isArray(schemaProfile?.layouts)
        ? (schemaProfile.layouts as Record<string, any>[])
        : []
      const datasetLayout = this.findLayoutForClass(schemaLayouts, 'Dataset')

      for (const input of schemaInputs) {
        const propertyName = typeof input?.name === 'string' ? input.name.trim() : ''
        if (!propertyName) {
          continue
        }

        const relationshipTypes = this.extractEntityTypes(input, schemaClasses)
        const valueKinds = this.resolveValueKinds(
          input,
          schemaClasses,
          relationshipTypes,
        )
        const groupName = this.getFieldGroup(input)
        const schemaMeta = this.resolveSchemaMeta(datasetLayout, groupName)
        const field: FieldDefinition = {
          key: `schema::${schemaId}::${propertyName}`,
          className: '__any__',
          classLabel: 'Any',
          supportedClasses: [],
          schemaId,
          schemaLabel,
          schemaGroupName: schemaMeta.label || schemaLabel,
          schemaUrl,
          propertyName,
          label: String(input.label ?? propertyName),
          help: typeof input.help === 'string' ? input.help : undefined,
          multiple: this.parseBoolean(input.multiple),
          valueKind: valueKinds[0] ?? 'text',
          valueKinds,
          selectValues: Array.isArray(input.values)
            ? input.values
                .map((value) => String(value))
                .filter((value) => value.trim().length > 0)
            : [],
          entityTypes: relationshipTypes,
          appliesToAll: true,
        }

        this.upsertFieldDefinition(fieldsByKey, field)
      }
    }
  }

  /**
   * Inserts or merges one field into the deduplicated field map.
   * @param fieldsByKey Mutable field map.
   * @param field Candidate field.
   * @returns void
   * @protected
   */
  protected upsertFieldDefinition(
    fieldsByKey: Map<string, FieldDefinition>,
    field: FieldDefinition,
  ): void {
    const dedupeKey = `${field.schemaId}::${field.propertyName}::${field.label}`
    const existingField = fieldsByKey.get(dedupeKey)
    if (!existingField) {
      fieldsByKey.set(dedupeKey, field)
      return
    }

    const supported = new Set(existingField.supportedClasses ?? [])
    for (const className of field.supportedClasses ?? []) {
      if (className && className.trim().length > 0) {
        supported.add(className)
      }
    }
    existingField.supportedClasses = Array.from(supported.values())

    const mergedEntityTypes = new Set(existingField.entityTypes)
    for (const typeName of field.entityTypes) {
      mergedEntityTypes.add(typeName)
    }
    existingField.entityTypes = Array.from(mergedEntityTypes.values())

    if (field.multiple) {
      existingField.multiple = true
    }
    if (field.appliesToAll) {
      existingField.appliesToAll = true
    }
    if (!existingField.schemaUrl && field.schemaUrl) {
      existingField.schemaUrl = field.schemaUrl
    }
    if (field.selectValues.length > 0) {
      const mergedValues = new Set(existingField.selectValues)
      for (const value of field.selectValues) {
        mergedValues.add(value)
      }
      existingField.selectValues = Array.from(mergedValues.values())
    }

    existingField.valueKinds = this.sortValueKinds([
      ...this.getFieldValueKinds(existingField),
      ...this.getFieldValueKinds(field),
    ])
    existingField.valueKind = existingField.valueKinds[0] ?? existingField.valueKind
  }

  /**
   * Merges field-derived schema options with schemas detected in the currently opened RO-Crate.
   * @param baseSchemas Schema options derived from selected entity type fields.
   * @returns Deduplicated, sorted schema options.
   * @protected
   */
  protected mergeSchemaOptions(baseSchemas: SchemaOption[]): SchemaOption[] {
    const merged = new Map<string, SchemaOption>()
    for (const schema of baseSchemas) {
      merged.set(schema.id, schema)
    }

    const crateSchemas = this.collectSchemaOptionsFromCrate()
    for (const schema of crateSchemas) {
      const existing = merged.get(schema.id)
      if (!existing) {
        merged.set(schema.id, schema)
        continue
      }
      if (!existing.url && schema.url) {
        merged.set(schema.id, { ...existing, url: schema.url })
      }
    }

    return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  /**
   * Collects schema options from app-state profile list (all schemas referenced in the opened crate).
   * @returns Schema options mapped from crate-level schema entries.
   * @protected
   */
  protected collectSchemaOptionsFromCrate(): SchemaOption[] {
    const optionsById = new Map<string, SchemaOption>()
    const knownUrls = new Set<string>()
    const nonMetadataSchemaUrls = new Set(this.extractConformsToUrlsFromCrate())
    const profileList = Array.isArray(this.appStateService.profileList)
      ? this.appStateService.profileList
      : []

    for (const entry of profileList) {
      const schemaUrl = typeof entry?.id === 'string' ? entry.id.trim() : ''
      if (!schemaUrl || !nonMetadataSchemaUrls.has(schemaUrl)) {
        continue
      }
      const label = this.resolveSchemaLabelFromProfileEntry(entry, schemaUrl)
      const id = this.normalizeSchemaId(label)
      if (!id) {
        continue
      }

      const current = optionsById.get(id)
      if (!current) {
        optionsById.set(id, { id, label, url: schemaUrl })
      } else if (!current.url) {
        optionsById.set(id, { ...current, url: schemaUrl })
      }

      knownUrls.add(schemaUrl)
      this.schemaUrlsById.set(id, schemaUrl)
    }

    for (const schemaUrl of nonMetadataSchemaUrls) {
      if (!schemaUrl || knownUrls.has(schemaUrl)) {
        continue
      }
      const id = this.normalizeSchemaId(schemaUrl)
      if (!id || optionsById.has(id)) {
        continue
      }
      optionsById.set(id, { id, label: schemaUrl, url: schemaUrl })
      this.schemaUrlsById.set(id, schemaUrl)
    }

    return Array.from(optionsById.values())
  }

  /**
   * Extracts unique conformsTo URLs from the currently opened RO-Crate graph.
   * @returns Ordered list of unique schema URLs.
   * @protected
   */
  protected extractConformsToUrlsFromCrate(): string[] {
    const crate = this.appStateService.roCrate
    const graph = Array.isArray(crate?.['@graph'])
      ? (crate['@graph'] as Record<string, any>[])
      : []
    const urls = new Set<string>()

    const append = (value: unknown): void => {
      if (!value) {
        return
      }
      if (typeof value === 'string') {
        const normalized = value.trim()
        if (normalized.length > 0) {
          urls.add(normalized)
        }
        return
      }
      if (typeof value === 'object') {
        const candidate = (value as Record<string, any>)['@id'] ?? (value as Record<string, any>).id
        if (typeof candidate === 'string') {
          const normalized = candidate.trim()
          if (normalized.length > 0) {
            urls.add(normalized)
          }
        }
      }
    }

    for (const entity of graph) {
      if (this.isMetadataDescriptorEntity(entity)) {
        continue
      }
      const conformsTo = entity?.conformsTo
      if (Array.isArray(conformsTo)) {
        for (const value of conformsTo) {
          append(value)
        }
      } else {
        append(conformsTo)
      }
    }

    return Array.from(urls.values()).sort((a, b) => a.localeCompare(b))
  }

  /**
   * Checks whether an entity is the RO-Crate metadata descriptor.
   * @param entity Candidate graph entity.
   * @returns True when entity id points to ro-crate-metadata.json.
   * @protected
   */
  protected isMetadataDescriptorEntity(entity: Record<string, any>): boolean {
    const rawId = typeof entity?.['@id'] === 'string' ? entity['@id'].trim() : ''
    if (!rawId) {
      return false
    }
    const normalized = rawId.replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase()
    return normalized === 'ro-crate-metadata.json' || normalized.endsWith('/ro-crate-metadata.json')
  }

  /**
   * Resolves a readable schema label from a profile list entry.
   * @param entry Profile list item from app state.
   * @param fallback Fallback label when profile metadata is unavailable.
   * @returns Best-effort schema label.
   * @protected
   */
  protected resolveSchemaLabelFromProfileEntry(
    entry: { content?: Record<string, any> | undefined },
    fallback: string,
  ): string {
    const rawName =
      typeof entry?.content?.metadata?.name === 'string'
        ? entry.content.metadata.name.trim()
        : ''

    if (rawName.length > 0) {
      if (this.schemaManagerService) {
        const normalized = this.schemaManagerService.nameWithoutMetadataSuffix(rawName)
        if (normalized && normalized.trim().length > 0) {
          return normalized.trim()
        }
      }
      return rawName
    }

    return fallback
  }

  /**
   * Finds the first layout that applies to a class.
   * @param layouts Profile layout definitions.
   * @param className Class name to resolve.
   * @returns Matching layout or undefined.
   * @protected
   */
  protected findLayoutForClass(
    layouts: Record<string, any>[],
    className: string,
  ): Record<string, any> | undefined {
    return layouts.find((layout) => {
      const appliesTo = Array.isArray(layout?.appliesTo) ? layout.appliesTo : []
      return appliesTo.includes(className)
    })
  }

  /**
   * Resolves the schema group name for a profile input field.
   * @param input Profile input definition.
   * @returns Group name, defaulting to "about".
   * @protected
   */
  protected getFieldGroup(input: Record<string, any>): string {
    if (typeof input.group === 'string' && input.group.trim().length > 0) {
      return input.group.trim()
    }
    return 'about'
  }

  /**
   * Resolves schema metadata for a layout group.
   * @param layout Class layout definition.
   * @param group Group name from input definition.
   * @returns Normalized schema metadata.
   * @protected
   */
  protected resolveSchemaMeta(
    layout: Record<string, any> | undefined,
    group: string,
  ): SchemaMeta {
    if (group.toLowerCase() === 'about') {
      const about = layout?.about
      const label =
        typeof about?.label === 'string' && about.label.trim().length > 0
          ? about.label.trim()
          : 'About'
      const url =
        typeof about?.url === 'string' && about.url.trim().length > 0
          ? about.url.trim()
          : undefined
      return { id: '__about__', label, url, selectable: false }
    }

    const layoutGroup = layout?.[group]
    const label =
      typeof layoutGroup?.label === 'string' && layoutGroup.label.trim().length > 0
        ? layoutGroup.label.trim()
        : group
    const url =
      typeof layoutGroup?.url === 'string' && layoutGroup.url.trim().length > 0
        ? layoutGroup.url.trim()
        : undefined

    return {
      id: this.normalizeSchemaId(label),
      label,
      url,
      selectable: true,
    }
  }

  /**
   * Normalizes schema labels/names to stable ids.
   * @param label Schema label.
   * @returns Normalized schema id.
   * @protected
   */
  protected normalizeSchemaId(label: string): string {
    return label.trim().toLowerCase().replace(/\s+/g, ' ')
  }

  /**
   * Parses profile boolean-like values.
   * @param value Candidate boolean value.
   * @returns Parsed boolean result.
   * @protected
   */
  protected parseBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      return value.trim().toLowerCase() === 'true'
    }
    return false
  }

  /**
   * Resolves all editor value kinds from an input definition.
   * @param input Profile input definition.
   * @param classes Profile classes map.
   * @param entityTypes Linked entity target types.
   * @returns Sorted value editor kinds.
   * @protected
   */
  protected resolveValueKinds(
    input: Record<string, any>,
    classes: Record<string, any>,
    entityTypes: string[],
  ): FieldValueKind[] {
    const kinds = new Set<FieldValueKind>()

    if (Array.isArray(input.values) && input.values.length > 0) {
      kinds.add('select')
    }

    const types = Array.isArray(input.type)
      ? input.type.map((type: unknown) => String(type))
      : input.type
        ? [String(input.type)]
        : []

    if (entityTypes.length > 0) {
      kinds.add('entity')
    }

    for (const typeName of types) {
      const normalized = this.normalizeInputTypeName(typeName)
      if (!normalized) {
        continue
      }

      if (
        normalized.includes('number') ||
        normalized.includes('integer') ||
        normalized.includes('int') ||
        normalized.includes('float') ||
        normalized.includes('double') ||
        normalized.includes('decimal')
      ) {
        kinds.add('number')
        continue
      }

      if (
        normalized.includes('date') ||
        normalized.includes('time') ||
        normalized.includes('datetime')
      ) {
        kinds.add('date')
        continue
      }

      if (normalized.includes('json') || normalized.includes('object')) {
        kinds.add('json')
        continue
      }

      if (
        normalized.includes('text') ||
        normalized.includes('string') ||
        normalized.includes('boolean')
      ) {
        kinds.add('text')
        continue
      }

      if (
        normalized.includes('url') ||
        normalized.includes('uri') ||
        normalized.includes('iri')
      ) {
        kinds.add('url')
      }
    }

    if (kinds.size === 0) {
      kinds.add('text')
    }

    return this.sortValueKinds(Array.from(kinds.values()))
  }

  /**
   * Normalizes a profile input type token into a comparison-safe key.
   * @param rawType Raw type declaration.
   * @returns Normalized type token.
   * @protected
   */
  protected normalizeInputTypeName(rawType: string): string {
    return this.toTypeTail(String(rawType)).trim().toLowerCase()
  }

  /**
   * Sorts value kinds by UI/editor preference.
   * @param kinds Candidate value kinds.
   * @returns Sorted, deduplicated kinds.
   * @protected
   */
  protected sortValueKinds(kinds: FieldValueKind[]): FieldValueKind[] {
    return Array.from(new Set(kinds)).sort(
      (a, b) => (VALUE_KIND_PRIORITY[a] ?? 999) - (VALUE_KIND_PRIORITY[b] ?? 999),
    )
  }

  /**
   * Returns all configured value kinds for a field.
   * @param field Field definition.
   * @returns Sorted value kinds.
   * @protected
   */
  protected getFieldValueKinds(field: FieldDefinition): FieldValueKind[] {
    const configured =
      field.valueKinds && field.valueKinds.length > 0
        ? field.valueKinds
        : [field.valueKind]
    return this.sortValueKinds(configured)
  }

  /**
   * Extracts profile class names referenced by a field type declaration.
   * @param input Profile input definition.
   * @param classes Profile classes map.
   * @returns Entity type names usable for relation pickers.
   * @protected
   */
  protected extractEntityTypes(
    input: Record<string, any>,
    classes: Record<string, any>,
  ): string[] {
    const types = Array.isArray(input.type)
      ? input.type.map((type: unknown) => String(type))
      : input.type
        ? [String(input.type)]
        : []
    const typeSet = new Set<string>()
    for (const typeName of types) {
      const tail = this.toTypeTail(typeName)
      const schemaTypeHasInputs =
        tail &&
        Array.isArray(SCHEMA_TYPE_DEFINITIONS[tail]?.inputs) &&
        (SCHEMA_TYPE_DEFINITIONS[tail]?.inputs?.length ?? 0) > 0
      if (tail && (classes[tail]?.inputs || schemaTypeHasInputs)) {
        typeSet.add(tail)
      }
    }
    return Array.from(typeSet.values())
  }

  /**
   * Chooses a human-friendly display name for an entity.
   * @param entity Entity object.
   * @returns Display name text.
   * @protected
   */
  protected getEntityDisplayName(entity: Record<string, any>): string {
    const typeName = this.getEntityTypeName(entity)
    const nameKey = typeName ? this.getEntityNameField(typeName) : undefined
    const preferredName =
      (nameKey && typeof entity?.[nameKey] === 'string' && entity[nameKey]) || undefined
    const name =
      preferredName ?? entity?.name ?? entity?.title ?? entity?.label ?? entity?.['@id']
    return typeof name === 'string' && name.trim().length > 0 ? name.trim() : '(unnamed)'
  }

  /**
   * Resolves a primary entity type from @type. (entities can have multiple types, but this declares a primary type which is the first type of the entity)
   * @param entity Entity object.
   * @returns Preferred type name or undefined.
   * @protected
   */
  protected getEntityTypeName(entity: Record<string, any>): string | undefined {
    return this.getEntityTypeNames(entity)[0]
  }

  /**
   * Resolves all non-CreativeWork type names from an entity @type declaration.
   * @param entity Entity object.
   * @returns Ordered, de-duplicated type names.
   * @protected
   */
  protected getEntityTypeNames(entity: Record<string, any>): string[] {
    const raw = entity?.['@type']
    const candidates = Array.isArray(raw) ? raw : raw ? [raw] : []
    const names: string[] = []
    const seen = new Set<string>()

    for (const candidate of candidates) {
      const value = String(candidate).trim()
      if (!value) {
        continue
      }
      const tail = this.toTypeTail(value)
      if (!tail || tail === 'CreativeWork' || seen.has(tail)) {
        continue
      }
      seen.add(tail)
      names.push(tail)
    }

    if (names.length > 0) {
      return names
    }

    if (candidates.length > 0) {
      const fallback = this.toTypeTail(String(candidates[0]))
      return fallback ? [fallback] : []
    }

    return []
  }

  /**
   * Returns the last path segment for URL-like type names.
   * @param typeName Raw type value.
   * @returns Normalized short type name.
   * @protected
   */
  protected toTypeTail(typeName: string): string {
    const trimmed = typeName.trim()
    if (!trimmed) {
      return ''
    }
    if (trimmed.includes('/')) {
      const split = trimmed.split('/')
      return split[split.length - 1]
    }
    return trimmed
  }

  /**
   * Resolves localized class label for an entity type.
   * @param typeName Type name.
   * @returns Localized label when available.
   * @protected
   */
  protected getEntityTypeLabel(typeName: string): string {
    const profile = this.profileData
    const localized = profile?.localisation?.[typeName]
    if (typeof localized === 'string' && localized.trim().length > 0) {
      return localized.trim()
    }
    const classLabel = profile?.classes?.[typeName]?.label
    if (typeof classLabel === 'string' && classLabel.trim().length > 0) {
      return classLabel.trim()
    }
    return typeName
  }

  /**
   * Resolves a field by key from base or schema.org catalogs.
   * @param fieldKey Field key.
   * @returns Field definition or undefined.
   * @protected
   */
  protected getFieldByKey(fieldKey?: string): FieldDefinition | undefined {
    if (!fieldKey) {
      return undefined
    }
    return this.fieldsByKey.get(fieldKey) ?? this.schemaOrgFieldsByKey.get(fieldKey)
  }

  /**
   * Checks if a field applies to all currently selected entities.
   * @param field Field definition.
   * @returns True when every selected entity supports the field.
   * @protected
   */
  protected fieldAppliesToSelection(field: FieldDefinition): boolean {
    if (this.selectedEntities.length === 0) {
      return true
    }
    return this.selectedEntities.every((entity) => this.entitySupportsField(entity, field))
  }

  /**
   * Returns fields visible under current schema/schema.org selection.
   * @returns Visible field definitions.
   * @protected
   */
  protected getVisibleFields(): FieldDefinition[] {
    const baseFields = Array.from(this.fieldsByKey.values()).filter(
      (field) => this.selectedSchemaIds.has(field.schemaId) && this.fieldAppliesToSelection(field),
    )
    if (!this.schemaOrgEnabled) {
      return baseFields
    }
    const schemaOrgFields = Array.from(this.schemaOrgFieldsByKey.values()).filter((field) =>
      this.fieldAppliesToSelection(field),
    )
    return [...baseFields, ...schemaOrgFields]
  }

  /**
   * Computes valid operators for a field based on multiplicity.
   * @param field Optional field definition.
   * @returns Allowed operators.
   * @protected
   */
  protected getAllowedOperators(field?: FieldDefinition): BulkOperator[] {
    if (!field) {
      return ['set', 'unset']
    }
    return field.multiple ? ['add', 'remove', 'set', 'unset'] : ['set', 'unset']
  }

  /**
   * Updates selected schema ids.
   * @param schemaIds Selected schema identifiers.
   * @returns void
   * @protected
   */
  protected onSchemaSelectionChange = (schemaIds: string[]) => {
    this.selectedSchemaIds = new Set(schemaIds)
    this.update()
  }

  /**
   * Toggles schema.org mode.
   * @param enabled True when schema.org fields should be included.
   * @returns void
   * @protected
   */
  protected toggleSchemaOrg = (enabled: boolean) => {
    this.schemaOrgEnabled = enabled
    this.update()
  }

  /**
   * Resolves default value kind for a field.
   * @param field Field definition.
   * @returns Default value kind.
   * @protected
   */
  protected getDefaultValueKind(field: FieldDefinition): FieldValueKind {
    return this.getFieldValueKinds(field)[0] ?? field.valueKind
  }

  /**
   * Resolves effective value kind for an operation row and field.
   * @param row Operation row.
   * @param field Field definition.
   * @returns Effective value kind.
   * @protected
   */
  protected getEffectiveValueKind(
    row: OperationRow,
    field: FieldDefinition,
  ): FieldValueKind {
    const kinds = this.getFieldValueKinds(field)
    if (row.valueKind && kinds.includes(row.valueKind)) {
      return row.valueKind
    }
    return kinds[0] ?? field.valueKind
  }

  /**
   * Toggles visibility of selected entity list in the dialog.
   * @returns void
   * @protected
   */
  protected toggleEntityList = () => {
    this.showEntityList = !this.showEntityList
    this.update()
  }

  /**
   * Adds one new operation row.
   * @returns void
   * @protected
   */
  protected addOperation = () => {
    this.operations.push(this.createOperation())
    this.update()
  }

  /**
   * Dismisses setup warning banner until next validation state reset.
   * @returns void
   * @protected
   */
  protected dismissSetupWarning = () => {
    this.hideSetupWarning = true
    this.update()
  }

  /**
   * Removes an operation row by id.
   * @param id Operation row id.
   * @returns void
   * @protected
   */
  protected removeOperation = (id: string) => {
    const index = this.operations.findIndex((op) => op.id === id)
    if (index === -1) {
      return
    }
    this.operations.splice(index, 1)
    this.operationSearch.delete(id)
    if (this.operations.length === 0) {
      this.operations.push(this.createOperation())
    }
    this.update()
  }

  /**
   * Sets the property field for an operation row.
   * @param id Operation row id.
   * @param fieldKey Selected field key.
   * @returns void
   * @protected
   */
  protected setOperationField = (id: string, fieldKey?: string) => {
    const row = this.operations.find((operation) => operation.id === id)
    if (!row) {
      return
    }
    row.fieldKey = fieldKey
    row.value = ''
    this.operationSearch.delete(id)

    const field = this.getFieldByKey(fieldKey)
    row.valueKind = field ? this.getDefaultValueKind(field) : undefined
    const allowed = this.getAllowedOperators(field)
    if (!allowed.includes(row.operator)) {
      row.operator = allowed[0]
    }
    this.update()
  }

  /**
   * Sets the value kind for an operation row.
   * @param id Operation row id.
   * @param valueKind Selected value kind.
   * @returns void
   * @protected
   */
  protected setOperationValueKind = (id: string, valueKind: FieldValueKind) => {
    const row = this.operations.find((operation) => operation.id === id)
    if (!row) {
      return
    }
    const field = this.getFieldByKey(row.fieldKey)
    if (!field) {
      return
    }
    const kinds = this.getFieldValueKinds(field)
    if (!kinds.includes(valueKind)) {
      return
    }
    row.valueKind = valueKind
    row.value = ''
    this.operationSearch.delete(id)
    this.update()
  }

  /**
   * Sets the operator for an operation row.
   * @param id Operation row id.
   * @param operator Selected bulk operator.
   * @returns void
   * @protected
   */
  protected setOperationOperator = (id: string, operator: BulkOperator) => {
    const row = this.operations.find((operation) => operation.id === id)
    if (!row) {
      return
    }
    row.operator = operator
    if (operator === 'unset') {
      row.value = ''
    }
    this.update()
  }

  /**
   * Sets raw value text for an operation row.
   * @param id Operation row id.
   * @param value Raw user input value.
   * @returns void
   * @protected
   */
  protected setOperationValue = (id: string, value: string) => {
    const row = this.operations.find((operation) => operation.id === id)
    if (!row) {
      return
    }
    row.value = value
    this.update()
  }

  // Split stored multi-value text into editable rows (newline-delimited).
  protected getEditableMultiTextValues(rawValue: string): string[] {
    const normalized = rawValue.replace(/\r\n/g, '\n')
    if (normalized.length === 0) {
      return ['']
    }
    return normalized.split('\n')
  }

  // Update a specific row value and persist back to the operation.
  protected setOperationMultiTextValue = (
    id: string,
    valueIndex: number,
    value: string,
  ) => {
    const row = this.operations.find((operation) => operation.id === id)
    if (!row) {
      return
    }
    const values = this.getEditableMultiTextValues(row.value)
    while (values.length <= valueIndex) {
      values.push('')
    }
    values[valueIndex] = value
    row.value = values.join('\n')
    this.update()
  }

  // Track selection before update so caret position survives re-render.
  protected setOperationMultiTextValueFromEvent = (
    id: string,
    valueIndex: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.target
    const selectionStart = input.selectionStart
    const selectionEnd = input.selectionEnd
    const key = this.getMultiTextValueKey(id, valueIndex)
    if (selectionStart !== null && selectionEnd !== null) {
      this.pendingMultiTextSelection.set(key, {
        start: selectionStart,
        end: selectionEnd,
      })
    }
    this.setOperationMultiTextValue(id, valueIndex, input.value)
    requestAnimationFrame(() => this.restorePendingMultiTextSelection(key))
  }

  // Stable key used to track selection across re-renders.
  protected getMultiTextValueKey(operationId: string, valueIndex: number): string {
    return `${operationId}::${valueIndex}`
  }

  // DOM id for locating the input after re-render.
  protected getMultiTextInputId(operationId: string, valueIndex: number): string {
    const key = this.getMultiTextValueKey(operationId, valueIndex)
    return `multi-text-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  }

  // Restore a previously captured caret selection for a specific input.
  protected restorePendingMultiTextSelection(key: string): void {
    const pending = this.pendingMultiTextSelection.get(key)
    if (!pending) {
      return
    }
    const [operationId, rawIndex] = key.split('::')
    const valueIndex = Number(rawIndex)
    if (!operationId || !Number.isFinite(valueIndex)) {
      this.pendingMultiTextSelection.delete(key)
      return
    }
    const inputId = this.getMultiTextInputId(operationId, valueIndex)
    const input = document.getElementById(inputId) as HTMLInputElement | null
    if (!input) {
      return
    }
    try {
      input.focus()
      input.setSelectionRange(pending.start, pending.end)
    } catch {
      // no-op for unsupported input types/browsers
    }
    this.pendingMultiTextSelection.delete(key)
  }

  // Append a blank row for multi-value inputs.
  protected addOperationMultiTextValue = (id: string) => {
    const row = this.operations.find((operation) => operation.id === id)
    if (!row) {
      return
    }
    const values = this.getEditableMultiTextValues(row.value)
    values.push('')
    row.value = values.join('\n')
    this.update()
  }

  // Remove a specific row and keep at least one empty entry.
  protected removeOperationMultiTextValue = (id: string, valueIndex: number) => {
    const row = this.operations.find((operation) => operation.id === id)
    if (!row) {
      return
    }
    const values = this.getEditableMultiTextValues(row.value)
    if (valueIndex < 0 || valueIndex >= values.length) {
      return
    }
    values.splice(valueIndex, 1)
    if (values.length === 0) {
      values.push('')
    }
    row.value = values.join('\n')
    this.update()
  }

  // Render a single multi-value row input based on field type.
  protected renderMultiValueScalarInput(
    row: OperationRow,
    field: FieldDefinition,
    valueKind: FieldValueKind,
    value: string,
    valueIndex: number,
    disableRemove: boolean,
  ): React.ReactNode {
    const removeButton = (
      <button
        type="button"
        className="entities-overview-edit-modal-multi-text-suffix-remove"
        title="Remove value"
        aria-label="Remove value"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => this.removeOperationMultiTextValue(row.id, valueIndex)}
        disabled={disableRemove}
      >
        <span className="codicon codicon-trash" aria-hidden="true" />
      </button>
    )

    if (valueKind === 'date') {
      const parsed = value.trim().length > 0 ? dayjs(value) : null
      const pickerValue = parsed && parsed.isValid() ? parsed : null
      return (
        <div className="entities-overview-edit-modal-multi-text-date-wrap">
          <DatePicker
            value={pickerValue}
            onChange={(_, dateString) =>
              this.setOperationMultiTextValue(
                row.id,
                valueIndex,
                Array.isArray(dateString)
                  ? (dateString[0] ?? '')
                  : String(dateString ?? ''),
              )
            }
            format="YYYY-MM-DD"
            placeholder="Pick a date"
            style={{ width: '100%' }}
            getPopupContainer={() => document.body}
            popupClassName="entities-overview-edit-modal-date-popup"
          />
          {removeButton}
        </div>
      )
    }

    return (
      <Input
        id={this.getMultiTextInputId(row.id, valueIndex)}
        value={value}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
          this.setOperationMultiTextValueFromEvent(row.id, valueIndex, event)
        }
        placeholder={valueKind === 'url' ? 'Enter URL' : 'Enter value'}
        type={valueKind === 'number' ? 'number' : valueKind === 'url' ? 'url' : 'text'}
        suffix={removeButton}
      />
    )
  }

  /**
   * Validates the full multi-edit setup.
   * @returns List of validation messages.
   * @protected
   */
  protected getValidationErrors(): string[] {
    const errors: string[] = []

    if (this.operations.length === 0) {
      errors.push('Add at least one edit operation.')
      return errors
    }

    if (this.selectedSchemaIds.size === 0 && !this.schemaOrgEnabled) {
      errors.push('Select a schema or enable properties from other ontologies.')
      return errors
    }

    for (let index = 0; index < this.operations.length; index += 1) {
      const row = this.operations[index]
      const field = this.getFieldByKey(row.fieldKey)
      if (!field) {
        errors.push(`Row ${index + 1}: select a property.`)
        continue
      }
      const valueKind = this.getEffectiveValueKind(row, field)

      const schemaOrgFieldActive =
        field.schemaId === SCHEMA_ORG_SCHEMA_ID && this.schemaOrgEnabled
      if (
        !this.selectedSchemaIds.has(field.schemaId) &&
        !schemaOrgFieldActive &&
        !(field.appliesToAll && this.schemaOrgEnabled)
      ) {
        errors.push(`Row ${index + 1}: selected property is not part of active schemas.`)
        continue
      }

      const allowedOperators = this.getAllowedOperators(field)
      if (!allowedOperators.includes(row.operator)) {
        errors.push(
          `Row ${index + 1}: operator "${OPERATOR_LABELS[row.operator]}" is not valid for ${field.label}.`,
        )
      }

      if (row.operator !== 'unset' && row.value.trim().length === 0) {
        errors.push(`Row ${index + 1}: enter a value.`)
      }

      if (row.operator !== 'unset' && row.value.trim().length > 0) {
        const parseError = this.validateValue(field, row.value, valueKind)
        if (parseError) {
          errors.push(`Row ${index + 1}: ${parseError}`)
        }
      }
    }

    return errors
  }

  /**
   * Validates one raw input value against a field type.
   * @param field Field definition.
   * @param rawValue User-provided raw value.
   * @returns Validation error text or undefined.
   * @protected
   */
  protected validateValue(
    field: FieldDefinition,
    rawValue: string,
    valueKind: FieldValueKind,
  ): string | undefined {
    const tokens = this.splitMultiValue(rawValue, field, valueKind)
    if (tokens.length === 0) {
      return `value must be selected for ${field.label}.`
    }

    if (valueKind === 'entity') {
      const graph = this.getGraph()
      for (const token of tokens) {
        if (!token) {
          return `value must be selected for ${field.label}.`
        }
        if (this.isCreateToken(token)) {
          continue
        }
        const exists = graph.some((entry) => entry && String(entry['@id']) === token)
        if (!exists) {
          return `selected entity does not exist for ${field.label}.`
        }
      }
      return undefined
    }

    if (valueKind === 'number') {
      for (const token of tokens) {
        const numberValue = Number(token)
        if (!Number.isFinite(numberValue)) {
          return `value must be a number for ${field.label}.`
        }
      }
    }

    if (valueKind === 'json') {
      try {
        const parsed = JSON.parse(rawValue)
        if (field.multiple && !Array.isArray(parsed)) {
          return `value must be a JSON array for ${field.label}.`
        }
      } catch {
        return `value must be valid JSON for ${field.label}.`
      }
    }

    if (valueKind === 'select' && field.selectValues.length > 0) {
      const allowed = new Set(field.selectValues.map((value) => value.trim()))
      for (const token of tokens) {
        if (!allowed.has(token)) {
          return `value must be one of the allowed options for ${field.label}.`
        }
      }
    }

    return undefined
  }

  /**
   * Parses raw user input into operation-ready value.
   * @param field Field definition.
   * @param rawValue User-provided raw value.
   * @returns Parsed value.
   * @protected
   */
  protected parseValue(
    field: FieldDefinition,
    rawValue: string,
    valueKind: FieldValueKind,
  ): unknown {
    const tokens = this.splitMultiValue(rawValue, field, valueKind)
    if (valueKind === 'number') {
      const values = tokens.map((token) => Number(token))
      return field.multiple ? values : values[0]
    }
    if (valueKind === 'json') {
      return JSON.parse(rawValue)
    }
    if (valueKind === 'entity') {
      const values = tokens.map((token) => ({ '@id': token.trim() }))
      return field.multiple ? values : values[0]
    }
    return field.multiple ? tokens : tokens[0]
  }

  /**
   * Checks whether a field applies to a specific entity type.
   * @param entity Entity object.
   * @param field Field definition.
   * @returns True when field can be applied.
   * @protected
   */
  protected entitySupportsField(
    entity: Record<string, any>,
    field: FieldDefinition,
  ): boolean {
    if (field.appliesToAll) {
      return true
    }
    const rawType = entity?.['@type']
    const typeList = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
    const supported = field.supportedClasses
    if (supported && supported.length > 0) {
      return typeList.some((typeValue) =>
        supported.includes(this.toTypeTail(String(typeValue))),
      )
    }
    return typeList.some(
      (typeValue) => this.toTypeTail(String(typeValue)) === field.className,
    )
  }

  protected getSchemaTypeHierarchy(
    typeName: string,
    profileClasses: Record<string, any>,
  ): string[] {
    const normalized = this.toTypeTail(typeName)
    if (!normalized) {
      return []
    }

    const collected = new Set<string>()
    const queue: string[] = [normalized]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current || collected.has(current)) {
        continue
      }
      collected.add(current)

      const profileParents = Array.isArray(profileClasses[current]?.subClassOf)
        ? profileClasses[current].subClassOf
        : []
      for (const parent of profileParents) {
        const parentTail = this.toTypeTail(String(parent))
        if (parentTail && !collected.has(parentTail)) {
          queue.push(parentTail)
        }
      }

      const schemaDef = SCHEMA_TYPE_DEFINITIONS[current]
      const schemaHierarchy = Array.isArray(schemaDef?.hierarchy)
        ? schemaDef.hierarchy
        : []
      for (const parent of schemaHierarchy) {
        const parentTail = this.toTypeTail(String(parent))
        if (parentTail && !collected.has(parentTail)) {
          queue.push(parentTail)
        }
      }
    }

    if (!collected.has('Thing')) {
      collected.add('Thing')
    }
    return Array.from(collected.values())
  }

  protected buildSchemaOrgFields(
    crate: Record<string, any>,
    profile: Record<string, any>,
  ): FieldDefinition[] {
    const profileClasses = (profile?.classes ?? {}) as Record<string, any>
    const selectedEntities =
      this.selectedEntities.length > 0
        ? this.selectedEntities
        : this.collectSelectedEntities(crate)
    if (selectedEntities.length === 0) {
      return []
    }

    const maps: Array<Map<string, FieldDefinition>> = []
    for (const entity of selectedEntities) {
      const map = this.buildSchemaOrgFieldMapForEntity(entity, profileClasses)
      if (map.size === 0) {
        return []
      }
      maps.push(map)
    }

    const commonPropertyNames = this.intersectFieldPropertyNames(maps)
    const mergedFields: FieldDefinition[] = []
    for (const propertyName of commonPropertyNames) {
      const definitions = maps
        .map((map) => map.get(propertyName))
        .filter((field): field is FieldDefinition => !!field)
      const merged = this.mergeSchemaOrgFieldDefinitions(definitions)
      if (merged) {
        mergedFields.push(merged)
      }
    }

    return mergedFields.sort((a, b) => a.label.localeCompare(b.label))
  }

  protected buildSchemaOrgFieldMapForEntity(
    entity: Record<string, any>,
    profileClasses: Record<string, any>,
  ): Map<string, FieldDefinition> {
    const entityTypes = this.getEntityTypeNames(entity)
    if (entityTypes.length === 0) {
      return new Map()
    }

    const hierarchy = new Set<string>()
    for (const typeName of entityTypes) {
      const typeHierarchy = this.getSchemaTypeHierarchy(typeName, profileClasses)
      for (const item of typeHierarchy) {
        hierarchy.add(item)
      }
    }
    const hierarchyList = Array.from(hierarchy.values())

    const inputs: Array<{ input: SchemaTypeDefinitionInput; sourceType: string }> = []
    for (const typeName of hierarchy) {
      const profileClass = profileClasses[typeName]
      const profileInputs = Array.isArray(profileClass?.inputs)
        ? (profileClass.inputs as SchemaTypeDefinitionInput[])
        : []
      if (profileInputs.length > 0) {
        for (const input of profileInputs) {
          inputs.push({ input, sourceType: typeName })
        }
      }

      const shouldIncludeSchemaInputs =
        !profileClass || profileClass?.definition === 'inherit'
      if (shouldIncludeSchemaInputs) {
        const schemaInputs = Array.isArray(SCHEMA_TYPE_DEFINITIONS[typeName]?.inputs)
          ? (SCHEMA_TYPE_DEFINITIONS[typeName]?.inputs as SchemaTypeDefinitionInput[])
          : []
        if (schemaInputs.length > 0) {
          for (const input of schemaInputs) {
            inputs.push({ input, sourceType: typeName })
          }
        }
      }
    }

    const byProperty = new Map<string, FieldDefinition>()
    for (const inputEntry of inputs) {
      const { input, sourceType } = inputEntry
      const propertyName = typeof input?.name === 'string' ? input.name.trim() : ''
      if (
        propertyName &&
        !isSchemaOrgPropertyAllowedForHierarchy(propertyName, hierarchyList, {
          sourceType,
          hierarchy: hierarchyList,
          entityTypes,
        })
      ) {
        continue
      }
      const field = this.toSchemaOrgField(input, profileClasses, entityTypes)
      if (!field) {
        continue
      }
      const existing = byProperty.get(field.propertyName)
      if (!existing) {
        byProperty.set(field.propertyName, field)
        continue
      }
      const merged = this.mergeSchemaOrgFieldDefinitions([existing, field])
      if (merged) {
        byProperty.set(field.propertyName, merged)
      }
    }
    return byProperty
  }

  protected intersectFieldPropertyNames(
    fieldMaps: Array<Map<string, FieldDefinition>>,
  ): string[] {
    if (fieldMaps.length === 0) {
      return []
    }
    const firstMap = fieldMaps[0]
    const result: string[] = []
    for (const propertyName of firstMap.keys()) {
      const presentInAll = fieldMaps.every((map) => map.has(propertyName))
      if (presentInAll) {
        result.push(propertyName)
      }
    }
    return result
  }

  protected toSchemaOrgField(
    input: SchemaTypeDefinitionInput,
    profileClasses: Record<string, any>,
    supportedClasses: string[],
  ): FieldDefinition | undefined {
    const propertyName = typeof input?.name === 'string' ? input.name.trim() : ''
    if (!propertyName) {
      return undefined
    }

    const relationshipTypes = this.extractEntityTypes(input, profileClasses)
    const valueKinds = this.resolveValueKinds(input, profileClasses, relationshipTypes)
    const label =
      typeof input.label === 'string' && input.label.trim().length > 0
        ? input.label.trim()
        : propertyName
    const ontologyLabel = this.resolveOntologyLabelForSchemaInput(input)

    return {
      key: `schemaorg::${propertyName}`,
      className: '__schemaorg__',
      classLabel: ontologyLabel,
      supportedClasses,
      schemaId: SCHEMA_ORG_SCHEMA_ID,
      schemaLabel: ontologyLabel,
      schemaGroupName: ontologyLabel,
      propertyName,
      label,
      help: typeof input.help === 'string' ? input.help : undefined,
      multiple: this.parseBoolean(input.multiple),
      valueKind: valueKinds[0] ?? 'text',
      valueKinds,
      selectValues: Array.isArray(input.values)
        ? input.values
            .map((value) => String(value))
            .filter((value) => value.trim().length > 0)
        : [],
      entityTypes: relationshipTypes,
    }
  }

  protected resolveOntologyLabelForSchemaInput(input: SchemaTypeDefinitionInput): string {
    const id = typeof input?.id === 'string' ? input.id.toLowerCase() : ''
    return id.includes(SCHEMA_ORG_LABEL) ? SCHEMA_ORG_LABEL : OTHER_ONTOLOGIES_LABEL
  }

  protected mergeSchemaOrgFieldDefinitions(
    definitions: FieldDefinition[],
  ): FieldDefinition | undefined {
    if (definitions.length === 0) {
      return undefined
    }
    const base = { ...definitions[0] }
    base.multiple = definitions.every((definition) => definition.multiple)
    base.appliesToAll = definitions.every((definition) => definition.appliesToAll)

    const supported = new Set<string>()
    for (const definition of definitions) {
      for (const className of definition.supportedClasses ?? []) {
        supported.add(className)
      }
    }
    base.supportedClasses = Array.from(supported.values())
    const hasSchemaOrgSource = definitions.some((definition) =>
      definition.schemaLabel.toLowerCase().includes(SCHEMA_ORG_LABEL),
    )
    const ontologyLabel = hasSchemaOrgSource ? SCHEMA_ORG_LABEL : OTHER_ONTOLOGIES_LABEL
    base.classLabel = ontologyLabel
    base.schemaLabel = ontologyLabel
    base.schemaGroupName = ontologyLabel

    const intersectKinds = (lists: FieldValueKind[][]): FieldValueKind[] => {
      if (lists.length === 0) {
        return []
      }
      let current = new Set(lists[0])
      for (let index = 1; index < lists.length; index += 1) {
        const next = new Set(lists[index])
        current = new Set(Array.from(current).filter((item) => next.has(item)))
      }
      return Array.from(current.values())
    }
    const valueKindLists = definitions.map((definition) =>
      this.getFieldValueKinds(definition),
    )
    const intersectedKinds = intersectKinds(valueKindLists)
    const fallbackKinds = this.sortValueKinds(valueKindLists.flat())
    base.valueKinds = this.sortValueKinds(
      intersectedKinds.length > 0 ? intersectedKinds : fallbackKinds,
    )

    const intersectStrings = (lists: string[][]): string[] => {
      if (lists.length === 0) {
        return []
      }
      let current = new Set(lists[0])
      for (let index = 1; index < lists.length; index += 1) {
        const next = new Set(lists[index])
        current = new Set(Array.from(current).filter((item) => next.has(item)))
      }
      return Array.from(current.values())
    }

    const intersectedEntityTypes = intersectStrings(
      definitions.map((definition) => definition.entityTypes),
    )
    const allEntityTypes: string[] = []
    for (const definition of definitions) {
      for (const typeName of definition.entityTypes) {
        allEntityTypes.push(typeName)
      }
    }
    base.entityTypes =
      intersectedEntityTypes.length > 0
        ? intersectedEntityTypes
        : Array.from(new Set(allEntityTypes))

    const selectValueCandidates = definitions.map((definition) => definition.selectValues)
    const intersectedSelectValues = intersectStrings(selectValueCandidates)
    const allSelectValues: string[] = []
    for (const definition of definitions) {
      for (const value of definition.selectValues) {
        allSelectValues.push(value)
      }
    }
    base.selectValues =
      intersectedSelectValues.length > 0
        ? intersectedSelectValues
        : Array.from(new Set(allSelectValues))

    if (base.entityTypes.length === 0) {
      base.valueKinds = base.valueKinds.filter((kind) => kind !== 'entity')
    }
    if (base.selectValues.length === 0) {
      base.valueKinds = base.valueKinds.filter((kind) => kind !== 'select')
    }
    if (base.valueKinds.length === 0) {
      base.valueKinds = ['text']
    }
    base.valueKind = base.valueKinds[0] ?? 'text'
    return base
  }

  /**
   * Ensures an entity has a given conformsTo association.
   * @param entity Entity to mutate.
   * @param schemaUrl Schema URL to attach.
   * @returns True when entity was changed.
   * @protected
   */
  protected ensureSchemaAssociation(
    entity: Record<string, any>,
    schemaUrl?: string,
  ): boolean {
    if (!schemaUrl || schemaUrl.trim().length === 0) {
      return false
    }

    const normalizedUrl = schemaUrl.trim()
    const rawConformsTo = entity.conformsTo
    const items = rawConformsTo
      ? Array.isArray(rawConformsTo)
        ? [...rawConformsTo]
        : [rawConformsTo]
      : []

    const normalizedItems: { '@id': string }[] = []
    for (const item of items) {
      if (typeof item === 'string') {
        const value = item.trim()
        if (value) {
          normalizedItems.push({ '@id': value })
        }
        continue
      }
      if (item && typeof item === 'object') {
        const idValue =
          (item as Record<string, any>)['@id'] ?? (item as Record<string, any>).id
        if (typeof idValue === 'string' && idValue.trim().length > 0) {
          normalizedItems.push({ '@id': idValue.trim() })
        }
      }
    }

    const alreadyPresent = normalizedItems.some((item) => item['@id'] === normalizedUrl)
    if (alreadyPresent) {
      return false
    }

    normalizedItems.push({ '@id': normalizedUrl })
    entity.conformsTo = normalizedItems
    return true
  }

  /**
   * Applies one operation to one entity property.
   * @param entity Entity to mutate.
   * @param field Target field definition.
   * @param operator Operator to apply.
   * @param parsedValue Parsed value payload.
   * @returns True when entity changed.
   * @protected
   */
  protected executeOperationOnEntity(
    entity: Record<string, any>,
    field: FieldDefinition,
    operator: BulkOperator,
    parsedValue: unknown,
  ): boolean {
    const propertyName = field.propertyName

      if (operator === 'unset') {
        if (!Object.prototype.hasOwnProperty.call(entity, propertyName)) {
          return false
        }
      delete entity[propertyName]
      return true
    }

    if (operator === 'set') {
      const nextValue = field.multiple
        ? this.normalizeParsedValues(parsedValue)
        : parsedValue
      if (this.areValuesEqual(entity[propertyName], nextValue)) {
        return false
      }
      entity[propertyName] = nextValue
      return true
    }

    if (!field.multiple) {
      return false
    }

    const existingValues = this.toArray(entity[propertyName])

    if (operator === 'add') {
      const valuesToAdd = this.normalizeParsedValues(parsedValue)
      let changed = false
      for (const value of valuesToAdd) {
        if (this.arrayContains(existingValues, value)) {
          continue
        }
        existingValues.push(value)
        changed = true
      }
      if (!changed) {
        return false
      }
      entity[propertyName] = [...existingValues]
      return true
    }

    if (operator === 'remove') {
      const valuesToRemove = this.normalizeParsedValues(parsedValue)
      const filtered = existingValues.filter(
        (value) =>
          !valuesToRemove.some((candidate) => this.areValuesEqual(value, candidate)),
      )
      if (filtered.length === existingValues.length) {
        return false
      }
      if (filtered.length === 0) {
        delete entity[propertyName]
      } else {
        entity[propertyName] = filtered
      }
      return true
    }

    return false
  }

  /**
   * Normalizes a value to array form.
   * @param value Source value.
   * @returns Array-wrapped value.
   * @protected
   */
  protected toArray(value: unknown): unknown[] {
    if (value === undefined || value === null) {
      return []
    }
    if (Array.isArray(value)) {
      return [...value]
    }
    return [value]
  }

  protected normalizeParsedValues(value: unknown): unknown[] {
    if (value === undefined || value === null) {
      return []
    }
    if (Array.isArray(value)) {
      return value
    }
    return [value]
  }

  protected splitMultiValue(
    rawValue: string,
    field: FieldDefinition,
    valueKind: FieldValueKind,
  ): string[] {
    const trimmed = rawValue.trim()
    if (!field.multiple) {
      return trimmed ? [trimmed] : []
    }
    const separatorPattern =
      valueKind === 'text' || valueKind === 'url' ? /\r?\n+/ : /[\n;,]+/
    const parts = trimmed
      .split(separatorPattern)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
    return parts
  }

  /**
   * Checks if a value array contains a target value with deep comparison support.
   * @param values Existing values.
   * @param target Candidate value.
   * @returns True when present.
   * @protected
   */
  protected arrayContains(values: unknown[], target: unknown): boolean {
    return values.some((value) => this.areValuesEqual(value, target))
  }

  /**
   * Compares two values, including stable object comparison.
   * @param a First value.
   * @param b Second value.
   * @returns True when values are equivalent.
   * @protected
   */
  protected areValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true
    }

    const isObjectA = typeof a === 'object' && a !== null
    const isObjectB = typeof b === 'object' && b !== null
    if (!isObjectA || !isObjectB) {
      return false
    }

    return this.stableStringify(a) === this.stableStringify(b)
  }

  /**
   * Serializes values with stable key ordering.
   * @param value Value to serialize.
   * @returns Stable JSON-like string.
   * @protected
   */
  protected stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`
    }
    const objectValue = value as Record<string, any>
    const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b))
    const content = keys
      .map((key) => `${JSON.stringify(key)}:${this.stableStringify(objectValue[key])}`)
      .join(',')
    return `{${content}}`
  }

  protected cloneEntityForMutation(entity: Record<string, any>): Record<string, any> {
    const cloneFn: ((value: Record<string, any>) => Record<string, any>) | undefined = (
      globalThis as any
    ).structuredClone
    if (typeof cloneFn === 'function') {
      return cloneFn(entity)
    }
    return JSON.parse(JSON.stringify(entity))
  }

  /**
   * Executes schema attachment and value updates for all selected entities.
   * @returns Promise resolved when execution summary is updated.
   * @protected
   */
  protected async runOperations(): Promise<void> {
    if (this.isExecuting) {
      return
    }

    const validationErrors = this.getValidationErrors()
    if (validationErrors.length > 0) {
      this.executionSummary = {
        processedEntities: 0,
        updatedEntities: 0,
        appliedOperations: 0,
        skippedOperations: 0,
        errors: validationErrors,
      }
      this.update()
      return
    }

    const currentCrate = this.appStateService.roCrate
    if (!currentCrate || !Array.isArray(currentCrate['@graph'])) {
      this.executionSummary = {
        processedEntities: 0,
        updatedEntities: 0,
        appliedOperations: 0,
        skippedOperations: 0,
        errors: ['RO-Crate data is not available.'],
      }
      this.update()
      return
    }

    this.isExecuting = true
    this.executionSummary = undefined
    this.update()

    const selectedEntitySet = new Set(this.entityIds)
    const sourceGraph = currentCrate['@graph'] as Record<string, any>[]
    const graph = [...sourceGraph]
    const indexByEntityId = new Map<string, number>()
    for (let index = 0; index < sourceGraph.length; index += 1) {
      const entity = sourceGraph[index]
      const id = entity && typeof entity === 'object' ? String(entity['@id'] ?? '') : ''
      if (!id || indexByEntityId.has(id)) {
        continue
      }
      indexByEntityId.set(id, index)
    }

    const conformsLookup = await this.buildSchemaConformsLookup()

    const preparedOperations: PreparedOperation[] = []
    for (let rowIndex = 0; rowIndex < this.operations.length; rowIndex += 1) {
      const operation = this.operations[rowIndex]
      const field = this.getFieldByKey(operation.fieldKey)
      const valueKind = field ? this.getEffectiveValueKind(operation, field) : undefined
      const prepared: PreparedOperation = {
        operation,
        rowIndex,
        field,
        valueKind,
      }

      if (!field) {
        preparedOperations.push(prepared)
        continue
      }

      if (operation.operator === 'set' || operation.operator === 'add') {
        prepared.schemaUrl = this.resolveConformsToUrl(field, conformsLookup)
      }

      if (operation.operator !== 'unset') {
        const rawValue = operation.value.trim()
        if (rawValue.length > 0) {
          prepared.parsedValue =
            valueKind === 'entity'
              ? this.resolveEntityValues(field, rawValue, graph)
              : this.parseValue(field, rawValue, valueKind ?? field.valueKind)
        }
      }

      preparedOperations.push(prepared)
    }

    let processedEntities = 0
    let updatedEntities = 0
    let appliedOperations = 0
    let skippedOperations = 0
    const errors: string[] = []

    for (const entityId of selectedEntitySet) {
      const index = indexByEntityId.get(entityId)
      if (index === undefined) {
        errors.push(`Entity not found: ${entityId}`)
        continue
      }

      const sourceEntity = graph[index]
      if (!sourceEntity || typeof sourceEntity !== 'object') {
        errors.push(`Entity not found: ${entityId}`)
        continue
      }

      let entity = sourceEntity
      let changed = false
      processedEntities += 1

      for (const prepared of preparedOperations) {
        const { operation, field, schemaUrl } = prepared
        if (!field) {
          continue
        }
        if (!this.entitySupportsField(entity, field)) {
          continue
        }
        if (operation.operator !== 'set' && operation.operator !== 'add') {
          continue
        }
        if (entity === sourceEntity) {
          entity = this.cloneEntityForMutation(sourceEntity)
        }
        const schemaAdded = this.ensureSchemaAssociation(entity, schemaUrl)
        if (schemaAdded) {
          changed = true
        }
      }

      for (const prepared of preparedOperations) {
        const { operation, field, rowIndex } = prepared

        if (!field) {
          skippedOperations += 1
          continue
        }

        if (!this.entitySupportsField(entity, field)) {
          skippedOperations += 1
          continue
        }

        try {
          if (entity === sourceEntity) {
            entity = this.cloneEntityForMutation(sourceEntity)
          }
          const parsedValue = operation.operator === 'unset' ? undefined : prepared.parsedValue
          const changedByOperation = this.executeOperationOnEntity(
            entity,
            field,
            operation.operator,
            parsedValue,
          )
          if (changedByOperation) {
            appliedOperations += 1
            changed = true
          } else {
            skippedOperations += 1
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown execution error.'
          errors.push(`Entity ${entityId}, row ${rowIndex + 1}: ${message}`)
        }
      }

      if (changed) {
        graph[index] = entity
        updatedEntities += 1
      }
    }

    if (updatedEntities > 0) {
      const updatedCrate = {
        ...currentCrate,
        '@graph': graph,
      }
      this.roCrateHistoryService?.applyRoCrateChange(updatedCrate, {
        label: 'Apply multi-edit changes',
      }) ?? (this.appStateService.roCrate = updatedCrate)
      this.appStateService.dirty = this.appStateService.isRoCrateDirty(updatedCrate)
    }

    this.executionSummary = {
      processedEntities,
      updatedEntities,
      appliedOperations,
      skippedOperations,
      errors,
    }

    this.isExecuting = false
    this.update()
  }

  /**
   * Enables/disables the start button and updates its label.
   * @param canExecute True when execution can start.
   * @returns void
   * @protected
   */
  protected syncStartButton(canExecute: boolean): void {
    if (!this.startButton) {
      return
    }
    this.startButton.disabled = !canExecute
    this.startButton.textContent = this.isExecuting ? 'Running...' : 'Start multi-edit'
  }

  /**
   * Renders a value-kind selector when a field supports multiple value kinds.
   * @param row Operation row.
   * @param field Field definition.
   * @returns Selector UI or undefined.
   * @protected
   */
  protected renderValueKindSelector(
    row: OperationRow,
    field: FieldDefinition,
  ): React.ReactNode {
    const kinds = this.getFieldValueKinds(field)
    if (kinds.length <= 1) {
      return undefined
    }
    const currentKind = this.getEffectiveValueKind(row, field)
    return (
      <div className="entities-overview-edit-modal-value-kind">
        {kinds.map((kind) => {
          const active = kind === currentKind
          return (
            <button
              key={`${row.id}-${kind}`}
              type="button"
              className={`entities-overview-edit-modal-value-kind-button${active ? ' is-active' : ''}`}
              onClick={() => this.setOperationValueKind(row.id, kind)}
              aria-pressed={active}
            >
              <span className="codicon codicon-add" aria-hidden="true" />
              {VALUE_KIND_LABELS[kind]}
            </button>
          )
        })}
      </div>
    )
  }

  /**
   * Renders the appropriate input control for an operation value.
   * @param row Operation row.
   * @param field Selected field definition.
   * @returns Value editor node.
   * @protected
   */
  protected renderValueEditor(
    row: OperationRow,
    field: FieldDefinition | undefined,
  ): React.ReactNode {
    if (row.operator === 'unset') {
      return <span className="entities-overview-edit-modal-no-value">No value</span>
    }

    if (!field) {
      return <Input disabled placeholder="Select property first" />
    }

    const valueKind = this.getEffectiveValueKind(row, field)
    const valueKindSelector = this.renderValueKindSelector(row, field)

    let editor: React.ReactNode
    if (valueKind === 'select' && field.selectValues.length > 0) {
      const isMulti = field.multiple
      const multiValue = isMulti
        ? this.splitMultiValue(row.value, field, valueKind)
        : undefined
      editor = (
        <Select
          value={isMulti ? multiValue : row.value || undefined}
          onChange={(value) => {
            if (Array.isArray(value)) {
              this.setOperationValue(row.id, value.join(', '))
              return
            }
            this.setOperationValue(row.id, String(value ?? ''))
          }}
          getPopupContainer={() => document.body}
          classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
          styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
          mode={isMulti ? 'multiple' : undefined}
          options={field.selectValues.map((option) => ({
            label: option,
            value: option,
          }))}
          showSearch
          allowClear
          placeholder={isMulti ? 'Select one or more values' : 'Select value'}
          style={{ width: '100%' }}
        />
      )
    } else if (valueKind === 'entity') {
      editor = this.renderEntityValueEditor(row, field)
    } else if (valueKind === 'json') {
      editor = (
        <Input.TextArea
          value={row.value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            this.setOperationValue(row.id, event.target.value)
          }
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder='Enter JSON value, e.g. {"@id":"./file.txt"}'
        />
      )
    } else if (valueKind === 'date') {
      const parsed = row.value.trim().length > 0 ? dayjs(row.value) : null
      const pickerValue = parsed && parsed.isValid() ? parsed : null
      editor = (
        <DatePicker
          value={pickerValue}
          onChange={(_, dateString) =>
            this.setOperationValue(
              row.id,
              Array.isArray(dateString)
                ? (dateString[0] ?? '')
                : String(dateString ?? ''),
            )
          }
          format="YYYY-MM-DD"
          placeholder="Pick a date"
          style={{ width: '100%' }}
          getPopupContainer={() => document.body}
          popupClassName="entities-overview-edit-modal-date-popup"
          allowClear
        />
      )
    } else if (field.multiple) {
      const values = this.getEditableMultiTextValues(row.value)
      editor = (
        <div className="entities-overview-edit-modal-multi-text">
          {values.map((value, valueIndex) => (
            <div
              className="entities-overview-edit-modal-multi-text-row"
              key={`${row.id}-value-${valueIndex}`}
            >
              {this.renderMultiValueScalarInput(
                row,
                field,
                valueKind,
                value,
                valueIndex,
                values.length === 1 && values[0].trim().length === 0,
              )}
            </div>
          ))}
          <button
            type="button"
            className="entities-overview-edit-modal-multi-text-add"
            onClick={() => this.addOperationMultiTextValue(row.id)}
          >
            <span className="codicon codicon-add" aria-hidden="true" /> Add value
          </button>
        </div>
      )
    } else {
      editor = (
        <Input
          value={row.value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            this.setOperationValue(row.id, event.target.value)
          }
          placeholder={valueKind === 'url' ? 'Enter URL' : 'Enter value'}
          type={valueKind === 'number' ? 'number' : valueKind === 'url' ? 'url' : 'text'}
        />
      )
    }

    return (
      <div className="entities-overview-edit-modal-value-input">
        {valueKindSelector}
        {editor}
      </div>
    )
  }

  /**
   * Resolves a schema URL directly from field metadata.
   * @param field Field definition.
   * @returns Schema URL if available.
   * @protected
   */
  protected resolveSchemaUrl(field: FieldDefinition): string | undefined {
    if (field.schemaUrl && field.schemaUrl.trim().length > 0) {
      return field.schemaUrl.trim()
    }
    const mapped = this.schemaUrlsById.get(field.schemaId)
    if (mapped && mapped.trim().length > 0) {
      return mapped.trim()
    }
    return undefined
  }

  /**
   * Builds lookup map from schema references/names to conformsTo URLs.
   * @returns Lookup map used for schema attachment.
   * @protected
   */
  protected async buildSchemaConformsLookup(): Promise<Map<string, string>> {
    if (this.schemaConformsLookupCache) {
      return this.schemaConformsLookupCache
    }

    const lookup = new Map<string, string>()
    if (!this.schemaManagerService) {
      return lookup
    }
    let schemas: SchemaInfo[] = []
    try {
      schemas = await this.schemaManagerService.loadAllSchemas()
    } catch (error) {
      console.warn('Failed to load schemas for multi-edit lookup.', error)
      return lookup
    }
    for (const schema of schemas) {
      const conformsTo = schema.conformsTo?.trim()
      const reference = schema.aux?.reference?.trim()
      if (reference && conformsTo) {
        lookup.set(reference, conformsTo)
      }
      if (conformsTo) {
        lookup.set(conformsTo, conformsTo)
      }
      const normalizedName = this.schemaManagerService.nameWithoutMetadataSuffix(
        schema.name,
      )
      const key = this.normalizeSchemaId(normalizedName ?? schema.name)
      if (conformsTo && key) {
        lookup.set(`name:${key}`, conformsTo)
      }
    }
    this.schemaConformsLookupCache = lookup
    return lookup
  }

  /**
   * Resolves best conformsTo URL for a field.
   * @param field Field definition.
   * @param conformsLookup Reference-to-conformsTo lookup map.
   * @returns ConformsTo URL or undefined.
   * @protected
   */
  protected resolveConformsToUrl(
    field: FieldDefinition,
    conformsLookup: Map<string, string>,
  ): string | undefined {
    const candidate = this.resolveSchemaUrl(field)
    if (candidate) {
      const mapped = conformsLookup.get(candidate)
      return mapped ?? candidate
    }
    const groupKey = `name:${this.normalizeSchemaId(field.schemaGroupName)}`
    const byGroup = conformsLookup.get(groupKey)
    if (byGroup) {
      return byGroup
    }
    const nameKey = `name:${this.normalizeSchemaId(field.schemaLabel)}`
    const byName = conformsLookup.get(nameKey)
    if (byName) {
      return byName
    }
    return undefined
  }

  /**
   * Renders entity picker input for relation fields.
   * @param row Operation row.
   * @param field Field definition.
   * @returns Entity selector node.
   * @protected
   */
  protected renderEntityValueEditor(
    row: OperationRow,
    field: FieldDefinition,
  ): React.ReactNode {
    const searchText = this.operationSearch.get(row.id) ?? ''
    const allowCreate = row.operator === 'set' || row.operator === 'add'
    const options = this.getEntityOptions(field, searchText, allowCreate)
    const isMulti = field.multiple
    return (
      <Select
        value={this.getEntityValueInputValue(row, field, isMulti)}
        onChange={(value) => {
          if (Array.isArray(value)) {
            this.setOperationValue(row.id, value.join(', '))
            return
          }
          this.setOperationValue(row.id, String(value ?? ''))
        }}
        showSearch
        onSearch={(value: string) => this.setOperationSearch(row.id, value)}
        filterOption={false}
        allowClear
        placeholder={isMulti ? 'Select or create entities' : 'Select or create entity'}
        getPopupContainer={() => document.body}
        classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
        styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
        mode={isMulti ? 'multiple' : undefined}
        tagRender={(props) => this.renderEntityTag(props)}
        options={options}
        notFoundContent={
          <span className="entities-overview-entity-no-data">No matches</span>
        }
      />
    )
  }

  /**
   * Updates search text for one entity picker row.
   * @param id Operation row id.
   * @param value Current search text.
   * @returns void
   * @protected
   */
  protected setOperationSearch(id: string, value: string): void {
    this.operationSearch.set(id, value)
    this.update()
  }

  /**
   * Builds grouped entity-picker options and optional create action.
   * @param field Field definition.
   * @param searchText Current search text.
   * @param allowCreate Whether "create new entity" action is allowed.
   * @returns Grouped select options.
   * @protected
   */
  protected getEntityOptions(
    field: FieldDefinition,
    searchText: string,
    allowCreate: boolean,
  ): {
    label: React.ReactNode
    options: { value: string; label: React.ReactNode; title?: string }[]
  }[] {
    const graph = this.getGraph()
    const normalizedSearch = searchText.trim().toLowerCase()
    const candidates = graph.filter((entry) =>
      this.entityMatchesTypes(entry, field.entityTypes),
    )
    const existingOptionsWithLabel = candidates.map((entry) => {
      const id = String(entry['@id'])
      const name = this.getEntityDisplayName(entry)
      const rawType = this.getEntityTypeName(entry) ?? field.entityTypes[0] ?? 'Entity'
      const typeLabel = this.getEntityTypeLabel(rawType)
      return {
        value: id,
        label: (
          <span className="entities-overview-entity-option">
            <span className="entities-overview-entity-option-type">{typeLabel}</span>
            <span className="entities-overview-entity-option-name">{name}</span>
          </span>
        ),
        title: id,
        rawLabel: String(name ?? '').toLowerCase(),
      }
    })
    const existingOptions = existingOptionsWithLabel
      .filter((option) =>
        normalizedSearch.length === 0 ? true : option.rawLabel.includes(normalizedSearch),
      )
      .map(({ rawLabel, ...rest }) => rest)

    const groups: {
      label: React.ReactNode
      options: { value: string; label: React.ReactNode; title?: string }[]
    }[] = []

    groups.push({
      label: (
        <span className="entities-overview-entity-option-group">
          Associate an entity already defined in this crate
        </span>
      ),
      options: existingOptions,
    })

    if (allowCreate && normalizedSearch.length > 0) {
      const hasExactMatch = existingOptionsWithLabel.some(
        (option) => option.rawLabel === normalizedSearch,
      )
      if (!hasExactMatch) {
        const targetType = field.entityTypes[0] ?? 'Entity'
        const typeLabel = this.getEntityTypeLabel(targetType)
        const createLabel = searchText.trim()
        groups.push({
          label: (
            <span className="entities-overview-entity-option-group">
              Create new entity
            </span>
          ),
          options: [
            {
              value: this.buildCreateToken(targetType, createLabel),
              label: (
                <span className="entities-overview-entity-create-option">
                  <span className="entities-overview-entity-create-plus">+</span>
                  <span>
                    Create new {typeLabel}: {createLabel}
                  </span>
                </span>
              ),
              title: `Create new ${typeLabel}: ${createLabel}`,
            },
          ],
        })
      }
    }

    return groups
  }

  /**
   * Returns current crate graph.
   * @returns Graph entries or empty array.
   * @protected
   */
  protected getGraph(): Record<string, any>[] {
    const crate = this.appStateService.roCrate
    if (!crate || !Array.isArray(crate['@graph'])) {
      return []
    }
    return crate['@graph'] as Record<string, any>[]
  }

  /**
   * Checks whether an entity matches one of allowed target types.
   * @param entity Entity object.
   * @param types Allowed type names.
   * @returns True when entity type is accepted.
   * @protected
   */
  protected entityMatchesTypes(entity: Record<string, any>, types: string[]): boolean {
    if (types.length === 0) {
      return false
    }
    const entityTypes = this.getEntityTypeNames(entity)
    if (entityTypes.length === 0) {
      return false
    }
    const profileClasses = (this.profileData?.classes ?? {}) as Record<string, any>
    const entityHierarchy = new Set<string>()
    for (const typeName of entityTypes) {
      const hierarchy = this.getSchemaTypeHierarchy(typeName, profileClasses)
      for (const entry of hierarchy) {
        entityHierarchy.add(entry)
      }
      entityHierarchy.add(typeName)
    }

    return types.some((typeName) => entityHierarchy.has(typeName))
  }

  /**
   * Encodes a synthetic token for "create new entity" actions.
   * @param entityType Target entity type.
   * @param label Entity label entered by user.
   * @returns Encoded create token.
   * @protected
   */
  protected buildCreateToken(entityType: string, label: string): string {
    return `__create__::${encodeURIComponent(entityType)}::${encodeURIComponent(label)}`
  }

  /**
   * Decodes a create token into entity type and label.
   * @param token Encoded create token.
   * @returns Decoded token payload or undefined.
   * @protected
   */
  protected parseCreateToken(
    token: string,
  ): { entityType: string; label: string } | undefined {
    if (!token.startsWith('__create__::')) {
      return undefined
    }
    const parts = token.split('::')
    if (parts.length < 3) {
      return undefined
    }
    const entityType = decodeURIComponent(parts[1] ?? '')
    const label = decodeURIComponent(parts.slice(2).join('::'))
    if (!entityType || !label) {
      return undefined
    }
    return { entityType, label }
  }

  /**
   * Checks whether a value is a create-token marker.
   * @param value Raw value.
   * @returns True when value encodes "create new entity".
   * @protected
   */
  protected isCreateToken(value: string): boolean {
    return value.startsWith('__create__::')
  }

  /**
   * Resolves relation value to an existing or newly created entity reference.
   * @param field Field definition.
   * @param rawValue Raw selected value.
   * @param graph Mutable graph for optional entity creation.
   * @returns Resolved @id object.
   * @protected
   */
  protected resolveEntityValue(
    field: FieldDefinition,
    rawValue: string,
    graph: Record<string, any>[],
  ): unknown {
    const createToken = this.parseCreateToken(rawValue)
    if (!createToken) {
      return { '@id': rawValue }
    }
    const createdId = this.createEntityFromToken(field, createToken, graph)
    return { '@id': createdId }
  }

  protected resolveEntityValues(
    field: FieldDefinition,
    rawValue: string,
    graph: Record<string, any>[],
  ): unknown {
    const tokens = this.splitMultiValue(rawValue, field, 'entity')
    const resolved = tokens.map((token) => this.resolveEntityValue(field, token, graph))
    return field.multiple ? resolved : resolved[0]
  }

  protected getEntityValueInputValue(
    row: OperationRow,
    field: FieldDefinition,
    isMulti: boolean,
  ): string[] | string | undefined {
    if (isMulti) {
      return this.splitMultiValue(row.value, field, 'entity')
    }
    return row.value || undefined
  }

  protected renderEntityTag(props: any): React.ReactElement {
    const { label, value, closable, onClose } = props
    const stringValue = String(value ?? '')
    const isCreate = this.isCreateToken(stringValue)
    const createToken = isCreate ? this.parseCreateToken(stringValue) : undefined
    const renderedLabel = createToken
      ? `Create new ${createToken.entityType}: ${createToken.label}`
      : label
    return (
      <span
        className={`entities-overview-entity-tag${isCreate ? ' is-create' : ''}`}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <span className="entities-overview-entity-tag-label">
          {isCreate && (
            <span className="entities-overview-entity-tag-plus">
              <span className="entities-overview-entity-tag-plus-glyph">+</span>
            </span>
          )}
          {renderedLabel}
        </span>
        {closable && (
          <span
            className="entities-overview-entity-tag-close"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }}
            role="button"
            tabIndex={-1}
            aria-label="Remove"
          >
            ×
          </span>
        )}
      </span>
    )
  }

  /**
   * Creates a new entity from a create token and adds it to the graph.
   * @param field Field definition.
   * @param token Decoded token payload.
   * @param graph Mutable graph.
   * @returns Created entity id.
   * @protected
   */
  protected createEntityFromToken(
    field: FieldDefinition,
    token: { entityType: string; label: string },
    graph: Record<string, any>[],
  ): string {
    const entityType =
      token.entityType || field.entityTypes[0] || field.className || 'Thing'
    const entityId = this.normalizeCreatedEntityId(token.label, entityType)
    const existingEntity = graph.find(
      (entry) => entry && typeof entry === 'object' && String(entry['@id']) === entityId,
    )
    if (existingEntity) {
      return entityId
    }
    const entity: Record<string, any> = {
      '@id': entityId,
      '@type': entityType,
    }

    entity.name = token.label.trim() || entityId.replace(/^#/, '')

    graph.push(entity)
    return entityId
  }

  /**
   * Normalizes IDs for newly created entities so downstream editor state and
   * ReCrate identifier normalization stay in sync.
   * @param label Raw user label.
   * @param entityType Target entity type.
   * @returns Canonical entity id.
   * @protected
   */
  protected normalizeCreatedEntityId(label: string, entityType: string): string {
    const trimmed = String(label ?? '').trim()
    const fallback = `${entityType || 'Thing'}-${Date.now()}`
    const rawId = trimmed || fallback
    const encoded = this.isUriEncoded(rawId) ? rawId : encodeURI(rawId)
    const normalizedType = String(entityType ?? '').toLowerCase()
    const isDataset = normalizedType.includes('dataset')
    const isFile = normalizedType.includes('file')
    let entityId = encoded

    if (isDataset && entityId !== './' && entityId.slice(-1) !== '/') {
      entityId = `${entityId}/`
    }

    if (isFile || isDataset) {
      return entityId
    }

    const hasRelativePrefix =
      entityId.startsWith('/') ||
      entityId.startsWith('.') ||
      entityId.startsWith('#') ||
      entityId.startsWith('_:')
    const hasSchemePrefix = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(entityId)
    if (hasRelativePrefix || hasSchemePrefix) {
      return entityId
    }

    return `#${entityId}`
  }

  /**
   * Checks whether a URI-like string is already percent encoded.
   * @param value Candidate URI string.
   * @returns True when value appears encoded.
   * @protected
   */
  protected isUriEncoded(value: string): boolean {
    try {
      return value !== decodeURIComponent(value)
    } catch {
      return true
    }
  }

  /**
   * Resolves best candidate name field for a class from profile inputs.
   * @param entityType Entity class name.
   * @returns Name-like field key or undefined.
   * @protected
   */
  protected getEntityNameField(entityType: string): string | undefined {
    const profile = this.profileData
    const classDef = profile?.classes?.[entityType]
    const inputs = Array.isArray(classDef?.inputs)
      ? (classDef.inputs as Record<string, any>[])
      : []
    const exactName = inputs.find((input) => String(input.name) === 'name')
    if (exactName) {
      return 'name'
    }
    const labelName = inputs.find(
      (input) => String(input.label ?? '').toLowerCase() === 'name',
    )
    if (labelName && typeof labelName.name === 'string') {
      return labelName.name
    }
    const endsWithName = inputs.find((input) =>
      String(input.name ?? '')
        .toLowerCase()
        .endsWith('name'),
    )
    if (endsWithName && typeof endsWithName.name === 'string') {
      return endsWithName.name
    }
    const titleName = inputs.find(
      (input) => String(input.label ?? '').toLowerCase() === 'title',
    )
    if (titleName && typeof titleName.name === 'string') {
      return titleName.name
    }
    return undefined
  }

  /**
   * Renders operation rows section.
   * @returns Operations UI.
   * @protected
   */
  protected renderOperations(): React.ReactNode {
    const visibleFields = this.getVisibleFields()

    return (
      <div className="entities-overview-edit-modal-rows">
        {this.operations.map((row, index) => {
          const field = this.getFieldByKey(row.fieldKey)
          const allowedOperators = this.getAllowedOperators(field)
          return (
            <div className="entities-overview-edit-modal-row" key={row.id}>
              <div className="entities-overview-edit-modal-row-order">{index + 1}</div>
              <Select
                value={row.fieldKey}
                onChange={(value) => this.setOperationField(row.id, String(value))}
                placeholder="Select property"
                getPopupContainer={() => document.body}
                classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
                styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
                style={{ width: '38%' }}
                showSearch
                optionFilterProp="label"
                options={visibleFields.map((item) => ({
                  value: item.key,
                  label: `${item.label} - ${item.schemaLabel}`,
                  title: item.help ?? item.label,
                }))}
              />
              <Select
                value={row.operator}
                onChange={(value) =>
                  this.setOperationOperator(row.id, value as BulkOperator)
                }
                getPopupContainer={() => document.body}
                classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
                styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
                style={{ width: 110 }}
                options={allowedOperators.map((operator) => ({
                  value: operator,
                  label: OPERATOR_LABELS[operator],
                }))}
              />
              <div className="entities-overview-edit-modal-value">
                {this.renderValueEditor(row, field)}
              </div>
              <div className="entities-overview-edit-modal-row-actions">
                <button
                  type="button"
                  className="entities-overview-edit-modal-remove"
                  title="Remove rule"
                  aria-label="Remove rule"
                  onClick={() => this.removeOperation(row.id)}
                >
                  <span className="codicon codicon-trash" aria-hidden="true" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  /**
   * Renders post-execution summary panel.
   * @returns Summary UI or undefined.
   * @protected
   */
  protected renderSummary(): React.ReactNode {
    if (!this.executionSummary) {
      return undefined
    }

    const hasErrors = this.executionSummary.errors.length > 0

    return (
      <div className="entities-overview-edit-modal-summary">
        <Alert
          type={hasErrors ? 'warning' : 'success'}
          showIcon
          message={
            hasErrors
              ? 'Multi-edit finished with warnings.'
              : 'Multi-edit finished successfully.'
          }
          description={
            <div>
              <div>
                Processed entities:{' '}
                <strong>{this.executionSummary.processedEntities}</strong>
              </div>
              <div>
                Updated entities: <strong>{this.executionSummary.updatedEntities}</strong>
              </div>
              <div>
                Applied operations:{' '}
                <strong>{this.executionSummary.appliedOperations}</strong>
              </div>
              <div>
                Skipped operations:{' '}
                <strong>{this.executionSummary.skippedOperations}</strong>
              </div>
            </div>
          }
        />
        {hasErrors && (
          <ul className="entities-overview-edit-modal-errors">
            {this.executionSummary.errors.map((error, index) => (
              <li key={`${index}:${error}`}>{error}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  /**
   * Renders full dialog content.
   * @returns Dialog body UI.
   * @protected
   */
  protected render(): React.ReactNode {
    if (this.configurationError) {
      return (
        <div className="entities-overview-edit-modal-body">
          <Alert type="error" showIcon message={this.configurationError} />
        </div>
      )
    }

    const validationErrors = this.getValidationErrors()
    const visibleFields = this.getVisibleFields()
    const canExecute =
      !this.isExecuting &&
      this.entityIds.length > 0 &&
      this.operations.length > 0 &&
      validationErrors.length === 0
    this.syncStartButton(canExecute)
    if (validationErrors.length === 0) {
      this.hideSetupWarning = false
    }

    return (
      <div className="entities-overview-edit-modal-body">
        <div className="entities-overview-edit-modal-header">
          <p className="entities-overview-edit-modal-title">
            {this.entityIds.length} entities selected
          </p>
          <Button onClick={this.toggleEntityList}>
            {this.showEntityList ? 'Hide entities' : 'Show entities'}
          </Button>
        </div>

        {(() => {
          const normalizedSearch = this.entitySearch.trim().toLowerCase()
          const filteredEntities =
            normalizedSearch.length === 0
              ? this.entitySummaries
              : this.entitySummaries.filter((entity) =>
                  entity.name.toLowerCase().includes(normalizedSearch),
                )
          return (
            <div
              className={`entities-overview-edit-modal-entity-window${
                this.showEntityList ? '' : ' is-hidden'
              }`}
              aria-hidden={!this.showEntityList}
            >
              <div className="entities-overview-edit-modal-entity-window-header">
                <span>Selected entities</span>
                <button
                  type="button"
                  className="entities-overview-edit-modal-entity-window-close"
                  onClick={this.toggleEntityList}
                  aria-label="Close entity list"
                >
                  <span className="codicon codicon-close" aria-hidden="true" />
                </button>
              </div>
              <div className="entities-overview-edit-modal-entity-window-search">
                <Input
                  value={this.entitySearch}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    this.entitySearch = event.target.value
                    this.update()
                  }}
                  placeholder="Search entity names"
                  allowClear
                />
                <span className="entities-overview-edit-modal-entity-window-count">
                  {filteredEntities.length} / {this.entitySummaries.length}
                </span>
              </div>
              <div className="entities-overview-edit-modal-entity-window-body">
                <table className="entities-overview-edit-modal-entity-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntities.map((entity) => (
                      <tr key={entity.id} title={entity.id}>
                        <td>{entity.name}</td>
                        <td>
                          {Array.isArray(entity.type)
                            ? entity.type.join(', ')
                            : entity.type}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        <div className="entities-overview-edit-modal-section">
          <span className="entities-overview-edit-modal-label">Select schemas</span>
          <Select
            mode="multiple"
            value={Array.from(this.selectedSchemaIds.values())}
            options={this.schemaOptions.map((schema) => ({
              value: schema.id,
              label: schema.label,
            }))}
            onChange={this.onSchemaSelectionChange}
            placeholder="Select schemas"
            getPopupContainer={() => document.body}
            classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
            styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
            style={{ width: '100%' }}
            maxTagCount="responsive"
          />
          <div className="entities-overview-edit-modal-schema-org-toggle">
            <span className="entities-overview-edit-modal-label">
              Enable properties from other ontologies
            </span>
            <Switch
              checked={this.schemaOrgEnabled}
              onChange={this.toggleSchemaOrg}
            />
          </div>
        </div>

        <div className="entities-overview-edit-modal-section">
          <div className="entities-overview-edit-modal-row-header">
            <span className="entities-overview-edit-modal-label">Edit operations</span>
            <Button
              onClick={this.addOperation}
              type="dashed"
              disabled={visibleFields.length === 0}
            >
              Add rule
            </Button>
          </div>
          {visibleFields.length === 0 ? (
            <Alert
              type="info"
              showIcon
              message={
                this.schemaOrgEnabled
                  ? 'No properties are available for the selected schemas or other ontologies.'
                  : 'No properties are available for the selected schemas.'
              }
            />
          ) : (
            this.renderOperations()
          )}
        </div>

        {validationErrors.length > 0 && !this.hideSetupWarning && (
          <Alert
            type="warning"
            showIcon
            message="Multi-edit setup"
            closable
            onClose={this.dismissSetupWarning}
            description={
              <ol className="entities-overview-edit-modal-errors">
                <li>Select a schema or enable properties from other ontologies.</li>
                <li>Select a property, choose an operator, and enter a value.</li>
              </ol>
            }
          />
        )}

        {this.renderSummary()}
      </div>
    )
  }

  get value(): string {
    return ''
  }
}
