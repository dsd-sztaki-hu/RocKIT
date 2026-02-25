import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import * as React from '@theia/core/shared/react'
import { Alert, Button, Input, Select, Switch } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import type { MetadataSchemaManager, SchemaInfo } from 'aroma2-common/lib/browser'

type BulkOperator = 'add' | 'remove' | 'set' | 'unset'
type FieldValueKind = 'text' | 'number' | 'date' | 'select' | 'json' | 'entity'

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
}

interface EntitySummary {
  id: string
  name: string
  typeLabel: string
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

interface SchemaOrgProperty {
  label: string
  comment: string
}

const SCHEMA_ORG_PROPERTIES_URL =
  'https://schema.org/version/latest/schemaorg-current-http-properties.csv'
const SCHEMA_ORG_SCHEMA_ID = '__schemaorg__'

const OPERATOR_LABELS: Record<BulkOperator, string> = {
  add: 'Add',
  remove: 'Remove',
  set: 'Set',
  unset: 'Unset',
}

/**
 * Parses one CSV row while respecting quoted values and escaped quotes.
 * @param line Raw CSV row text.
 * @returns Parsed column values.
 */
const parseCsvLine = (line: string): string[] => {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (char === '"') {
      const nextChar = line[i + 1]
      if (inQuotes && nextChar === '"') {
        current += '"'
        i += 1
        continue
      }
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
      continue
    }

    current += char
  }

  result.push(current)
  return result.map((value) => value.trim().replace(/^"|"$/g, ''))
}

/**
 * Parses schema.org CSV content into label/comment property entries.
 * @param csvText Full CSV response text.
 * @returns Parsed schema.org properties.
 */
const parseSchemaOrgCsv = (csvText: string): SchemaOrgProperty[] => {
  const lines = csvText.split('\n').filter((line) => line.trim() !== '')
  if (lines.length <= 1) {
    return []
  }

  const headers = parseCsvLine(lines[0])

  const labelIndex = headers.indexOf('label')
  const commentIndex = headers.indexOf('comment')

  if (labelIndex === -1 || commentIndex === -1) {
    console.error(`CSV missing required headers. Found: [${headers.join(', ')}]`)
    return []
  }

  const properties: SchemaOrgProperty[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    if (values.length <= commentIndex) {
      continue
    }

    const rawLabel = values[labelIndex] ?? ''
    if (!rawLabel) {
      continue
    }

    properties.push({
      label: rawLabel,
      comment: values[commentIndex] ?? 'No description provided',
    })
  }

  return properties
}

export class MultiEditDialog extends ReactDialog<string> {
  protected readonly fieldsByKey = new Map<string, FieldDefinition>()
  protected readonly operations: OperationRow[] = []

  protected schemaOptions: SchemaOption[] = []
  protected selectedSchemaIds = new Set<string>()
  protected schemaUrlsById = new Map<string, string>()

  protected schemaOrgEnabled = false
  protected schemaOrgProperties: SchemaOrgProperty[] = []
  protected schemaOrgLoading = false
  protected schemaOrgError?: string

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

  constructor(
    private readonly entityIds: string[],
    private readonly appStateService: AppStateService,
    private readonly schemaManagerService?: MetadataSchemaManager,
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

    this.schemaOptions = schemas
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
    const result: EntitySummary[] = []
    for (const entityId of this.entityIds) {
      const entity = graph.find(
        (entry) =>
          entry && typeof entry === 'object' && String(entry['@id']) === entityId,
      )
      if (!entity) {
        result.push({ id: entityId, name: entityId, typeLabel: 'Unknown' })
        continue
      }
      const typeName = this.getEntityTypeName(entity) ?? 'Unknown'
      const localizedType =
        profile?.localisation?.[typeName] ?? profile?.classes?.[typeName]?.label
      const displayName = this.getEntityDisplayName(entity)
      result.push({
        id: entityId,
        name: displayName,
        typeLabel: String(localizedType ?? typeName),
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
      const typeName = this.getEntityTypeName(entity)
      if (typeName) {
        types.add(typeName)
      }
    }

    return Array.from(types.values()).sort((a, b) => a.localeCompare(b))
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
      const classLabel = String(
        localisation[className] ?? classDef.label ?? className,
      )
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

        const entityTypes = this.extractEntityTypes(input, classes)
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
          valueKind: this.resolveValueKind(input, classes, entityTypes),
          selectValues: Array.isArray(input.values)
            ? input.values
                .map((value) => String(value))
                .filter((value) => value.trim().length > 0)
            : [],
          entityTypes,
        }

        const dedupeKey = `${schemaMeta.id}::${propertyName}::${field.label}`
        const existingField = fieldsByKey.get(dedupeKey)
        if (!existingField) {
          fieldsByKey.set(dedupeKey, field)
        } else {
          const supported = new Set(existingField.supportedClasses ?? [])
          supported.add(className)
          existingField.supportedClasses = Array.from(supported.values())
          const mergedEntityTypes = new Set(existingField.entityTypes)
          for (const typeName of field.entityTypes) {
            mergedEntityTypes.add(typeName)
          }
          existingField.entityTypes = Array.from(mergedEntityTypes.values())
          if (field.multiple) {
            existingField.multiple = true
          }
          if (field.selectValues.length > 0) {
            const mergedValues = new Set(existingField.selectValues)
            for (const value of field.selectValues) {
              mergedValues.add(value)
            }
            existingField.selectValues = Array.from(mergedValues.values())
          }
        }
      }
    }

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
   * Resolves editor value kind from an input definition.
   * @param input Profile input definition.
   * @param classes Profile classes map.
   * @param entityTypes Linked entity target types.
   * @returns Value editor kind.
   * @protected
   */
  protected resolveValueKind(
    input: Record<string, any>,
    classes: Record<string, any>,
    entityTypes: string[],
  ): FieldValueKind {
    if (Array.isArray(input.values) && input.values.length > 0) {
      return 'select'
    }

    const types = Array.isArray(input.type)
      ? input.type.map((type: unknown) => String(type))
      : input.type
        ? [String(input.type)]
        : []

    if (entityTypes.length > 0) {
      return 'entity'
    }

    const firstType = types[0] ?? ''
    const normalized = firstType.toLowerCase()

    if (
      normalized.includes('number') ||
      normalized.includes('int') ||
      normalized.includes('float') ||
      normalized.includes('double')
    ) {
      return 'number'
    }

    if (normalized.includes('date')) {
      return 'date'
    }

    return 'text'
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
      if (tail && classes[tail]?.inputs) {
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
   * Resolves a primary entity type from @type.
   * @param entity Entity object.
   * @returns Preferred type name or undefined.
   * @protected
   */
  protected getEntityTypeName(entity: Record<string, any>): string | undefined {
    const raw = entity?.['@type']
    const candidates = Array.isArray(raw) ? raw : raw ? [raw] : []

    for (const candidate of candidates) {
      const value = String(candidate).trim()
      if (!value) {
        continue
      }
      const tail = this.toTypeTail(value)
      if (tail !== 'CreativeWork') {
        return tail
      }
    }

    if (candidates.length > 0) {
      return this.toTypeTail(String(candidates[0]))
    }

    return undefined
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
   * Returns fields visible under current schema/schema.org selection.
   * @returns Visible field definitions.
   * @protected
   */
  protected getVisibleFields(): FieldDefinition[] {
    const baseFields = Array.from(this.fieldsByKey.values()).filter((field) =>
      this.selectedSchemaIds.has(field.schemaId),
    )
    if (!this.schemaOrgEnabled) {
      return baseFields
    }
    const schemaOrgFields = this.schemaOrgProperties.map((property) =>
      this.toSchemaOrgField(property),
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
   * Toggles schema.org mode and lazily loads schema.org properties.
   * @param enabled True when schema.org fields should be included.
   * @returns void
   * @protected
   */
  protected toggleSchemaOrg = (enabled: boolean) => {
    this.schemaOrgEnabled = enabled
    if (enabled && this.schemaOrgProperties.length === 0 && !this.schemaOrgLoading) {
      void this.fetchSchemaOrgProperties()
    }
    this.update()
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

    const field = fieldKey ? this.fieldsByKey.get(fieldKey) : undefined
    const allowed = this.getAllowedOperators(field)
    if (!allowed.includes(row.operator)) {
      row.operator = allowed[0]
    }
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
      errors.push('Select a schema or enable schema.org properties.')
      return errors
    }

    for (let index = 0; index < this.operations.length; index += 1) {
      const row = this.operations[index]
      const field = row.fieldKey ? this.fieldsByKey.get(row.fieldKey) : undefined
      if (!field) {
        errors.push(`Row ${index + 1}: select a property.`)
        continue
      }

      if (
        !this.selectedSchemaIds.has(field.schemaId) &&
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
        const parseError = this.validateValue(field, row.value)
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
  protected validateValue(field: FieldDefinition, rawValue: string): string | undefined {
    const tokens = this.splitMultiValue(rawValue, field.multiple)
    if (tokens.length === 0) {
      return `value must be selected for ${field.label}.`
    }

    if (field.valueKind === 'entity') {
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

    if (field.valueKind === 'number') {
      for (const token of tokens) {
        const numberValue = Number(token)
        if (!Number.isFinite(numberValue)) {
          return `value must be a number for ${field.label}.`
        }
      }
    }

    if (field.valueKind === 'json') {
      try {
        const parsed = JSON.parse(rawValue)
        if (field.multiple && !Array.isArray(parsed)) {
          return `value must be a JSON array for ${field.label}.`
        }
      } catch {
        return `value must be valid JSON for ${field.label}.`
      }
    }

    if (field.valueKind === 'select' && field.selectValues.length > 0) {
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
  protected parseValue(field: FieldDefinition, rawValue: string): unknown {
    const tokens = this.splitMultiValue(rawValue, field.multiple)
    if (field.valueKind === 'number') {
      const values = tokens.map((token) => Number(token))
      return field.multiple ? values : values[0]
    }
    if (field.valueKind === 'json') {
      return JSON.parse(rawValue)
    }
    if (field.valueKind === 'entity') {
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

  /**
   * Converts a schema.org property into a generic field definition.
   * @param property schema.org property entry.
   * @returns Field definition usable in the operations UI.
   * @protected
   */
  protected toSchemaOrgField(property: SchemaOrgProperty): FieldDefinition {
    return {
      key: `schemaorg::${property.label}`,
      className: '__any__',
      classLabel: 'Any',
      schemaId: SCHEMA_ORG_SCHEMA_ID,
      schemaLabel: 'schema.org',
      schemaGroupName: 'schema.org',
      propertyName: property.label,
      label: property.label,
      help: property.comment,
      multiple: true,
      valueKind: 'text',
      selectValues: [],
      entityTypes: [],
      appliesToAll: true,
    }
  }

  /**
   * Loads schema.org property definitions from remote CSV.
   * @returns Promise resolved when loading finishes.
   * @protected
   */
  protected async fetchSchemaOrgProperties(): Promise<void> {
    this.schemaOrgLoading = true
    this.schemaOrgError = undefined
    this.update()

    try {
      const response = await fetch(SCHEMA_ORG_PROPERTIES_URL)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const csvText = await response.text()
      this.schemaOrgProperties = parseSchemaOrgCsv(csvText).sort((a, b) =>
        a.label.localeCompare(b.label),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown fetch error.'
      this.schemaOrgError = `Failed to fetch schema.org properties: ${message}`
      console.error('Error fetching schema.org properties:', error)
    } finally {
      this.schemaOrgLoading = false
      this.update()
    }
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
      if (!Object.hasOwn(entity, propertyName)) {
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

  protected splitMultiValue(rawValue: string, allowMultiple: boolean): string[] {
    const trimmed = rawValue.trim()
    if (!allowMultiple) {
      return trimmed ? [trimmed] : []
    }
    const parts = trimmed
      .split(/[\n;,]+/)
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
    const graph = JSON.parse(JSON.stringify(currentCrate['@graph'])) as Record<
      string,
      any
    >[]
    const conformsLookup = await this.buildSchemaConformsLookup()

    const resolvedValues = new Map<string, unknown>()
    for (const operation of this.operations) {
      if (operation.operator === 'unset') {
        continue
      }
      const field = operation.fieldKey
        ? this.fieldsByKey.get(operation.fieldKey)
        : undefined
      if (!field) {
        continue
      }
      const rawValue = operation.value.trim()
      if (rawValue.length === 0) {
        continue
      }
      if (field.valueKind === 'entity') {
        const resolved = this.resolveEntityValues(field, rawValue, graph)
        if (resolved) {
          resolvedValues.set(operation.id, resolved)
        }
        continue
      }
      resolvedValues.set(operation.id, this.parseValue(field, rawValue))
    }

    let processedEntities = 0
    let updatedEntities = 0
    let appliedOperations = 0
    let skippedOperations = 0
    const errors: string[] = []

    for (const entityId of selectedEntitySet) {
      const index = graph.findIndex((entry) => String(entry?.['@id']) === entityId)
      if (index < 0) {
        errors.push(`Entity not found: ${entityId}`)
        continue
      }

      const entity = graph[index]
      let changed = false
      processedEntities += 1

      for (let opIndex = 0; opIndex < this.operations.length; opIndex += 1) {
        const operation = this.operations[opIndex]
        const field = operation.fieldKey
          ? this.fieldsByKey.get(operation.fieldKey)
          : undefined
        if (!field) {
          continue
        }
        if (!this.entitySupportsField(entity, field)) {
          continue
        }
        if (operation.operator !== 'set' && operation.operator !== 'add') {
          continue
        }
        const schemaUrl = this.resolveConformsToUrl(field, conformsLookup)
        const schemaAdded = this.ensureSchemaAssociation(entity, schemaUrl)
        if (schemaAdded) {
          changed = true
        }
      }

      for (let opIndex = 0; opIndex < this.operations.length; opIndex += 1) {
        const operation = this.operations[opIndex]
        const field = operation.fieldKey
          ? this.fieldsByKey.get(operation.fieldKey)
          : undefined

        if (!field) {
          skippedOperations += 1
          continue
        }

        if (!this.entitySupportsField(entity, field)) {
          skippedOperations += 1
          continue
        }

        try {
          const parsedValue =
            operation.operator === 'unset' ? undefined : resolvedValues.get(operation.id)
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
          errors.push(`Entity ${entityId}, row ${opIndex + 1}: ${message}`)
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
      this.appStateService.roCrate = updatedCrate
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

    if (field.valueKind === 'select' && field.selectValues.length > 0) {
      const isMulti = field.multiple
      const multiValue = isMulti ? this.splitMultiValue(row.value, true) : undefined
      return (
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
    }

    if (field.valueKind === 'entity') {
      return this.renderEntityValueEditor(row, field)
    }

    if (field.valueKind === 'json') {
      return (
        <Input.TextArea
          value={row.value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            this.setOperationValue(row.id, event.target.value)
          }
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder='Enter JSON value, e.g. {"@id":"./file.txt"}'
        />
      )
    }

    if (field.multiple) {
      return (
        <Input.TextArea
          value={row.value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            this.setOperationValue(row.id, event.target.value)
          }
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder="Enter values separated by comma or newline"
        />
      )
    }

    return (
      <Input
        value={row.value}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
          this.setOperationValue(row.id, event.target.value)
        }
        placeholder="Enter value"
        type={
          field.valueKind === 'number'
            ? 'number'
            : field.valueKind === 'date'
              ? 'date'
              : 'text'
        }
      />
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
      const reference = schema.reference?.trim()
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
        value={this.getEntityValueInputValue(row, isMulti)}
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
    const entityType = this.getEntityTypeName(entity)
    if (!entityType) {
      return false
    }
    return types.some((typeName) => typeName === entityType)
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
    const tokens = this.splitMultiValue(rawValue, field.multiple)
    const resolved = tokens.map((token) => this.resolveEntityValue(field, token, graph))
    return field.multiple ? resolved : resolved[0]
  }

  protected getEntityValueInputValue(row: OperationRow, isMulti: boolean): string[] | string | undefined {
    if (isMulti) {
      return this.splitMultiValue(row.value, true)
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
    const entityId = token.label
    const entity: Record<string, any> = {
      '@id': entityId,
      '@type': entityType,
    }

    entity.name = token.label

    graph.push(entity)
    return entityId
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
          const field = row.fieldKey ? this.fieldsByKey.get(row.fieldKey) : undefined
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
                        <td>{entity.typeLabel}</td>
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
              Include schema.org properties
            </span>
            <Switch
              checked={this.schemaOrgEnabled}
              onChange={this.toggleSchemaOrg}
              disabled={this.schemaOrgLoading}
            />
          </div>
          {this.schemaOrgError && (
            <Alert type="warning" showIcon message={this.schemaOrgError} />
          )}
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
                  ? 'No properties are available for the selected schemas or schema.org.'
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
                <li>Select a schema or enable schema.org properties.</li>
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
