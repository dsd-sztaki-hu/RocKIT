import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import * as React from '@theia/core/shared/react'
import { Alert, Button, Input, Select, Tag } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'

type BulkOperator = 'add' | 'remove' | 'set' | 'unset'
type FieldValueKind = 'text' | 'number' | 'date' | 'select' | 'json'

interface FieldDefinition {
  key: string
  className: string
  classLabel: string
  schemaId: string
  schemaLabel: string
  schemaUrl?: string
  propertyName: string
  label: string
  help?: string
  multiple: boolean
  valueKind: FieldValueKind
  selectValues: string[]
}

interface SchemaOption {
  id: string
  label: string
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

const OPERATOR_LABELS: Record<BulkOperator, string> = {
  add: 'Add',
  remove: 'Remove',
  set: 'Set',
  unset: 'Unset',
}

export class MultiEditDialog extends ReactDialog<void> {
  protected readonly fieldsByKey = new Map<string, FieldDefinition>()
  protected readonly operations: OperationRow[] = []

  protected schemaOptions: SchemaOption[] = []
  protected selectedSchemaIds = new Set<string>()

  protected entitySummaries: EntitySummary[] = []
  protected showEntityList = false

  protected executionSummary?: ExecutionSummary
  protected configurationError?: string
  protected isExecuting = false

  constructor(
    private readonly entityIds: string[],
    private readonly appStateService: AppStateService,
  ) {
    super({ title: 'Multi Edit' })
    this.appendCloseButton('Close')
    this.initialize()
  }

  protected initialize(): void {
    const crate = this.appStateService.roCrate
    const profile = this.appStateService.completeProfile ?? this.appStateService.profile

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
      this.configurationError = 'No editable entities were found in the current selection.'
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

  protected createOperation(): OperationRow {
    return {
      id: `op-${Math.random().toString(36).slice(2, 10)}`,
      operator: 'set',
      value: '',
    }
  }

  protected buildEntitySummaries(
    crate: Record<string, any>,
    profile: Record<string, any>,
  ): EntitySummary[] {
    const graph = Array.isArray(crate['@graph']) ? (crate['@graph'] as Record<string, any>[]) : []
    const result: EntitySummary[] = []
    for (const entityId of this.entityIds) {
      const entity = graph.find(
        (entry) => entry && typeof entry === 'object' && String(entry['@id']) === entityId,
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

  protected collectEntityTypes(crate: Record<string, any>): string[] {
    const graph = Array.isArray(crate['@graph']) ? (crate['@graph'] as Record<string, any>[]) : []
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

  protected buildFieldCatalog(
    profile: Record<string, any>,
    entityTypes: string[],
  ): { fields: FieldDefinition[]; schemas: SchemaOption[] } {
    const classes = profile.classes as Record<string, any>
    const layouts = Array.isArray(profile.layouts) ? (profile.layouts as Record<string, any>[]) : []
    const localisation = (profile.localisation ?? {}) as Record<string, string>

    const fields: FieldDefinition[] = []
    const schemasById = new Map<string, SchemaOption>()

    for (const className of entityTypes) {
      const classDef = classes[className]
      if (!classDef) {
        continue
      }
      const classLabel = String(localisation[className] ?? classDef.label ?? className)
      const inputs = Array.isArray(classDef.inputs) ? (classDef.inputs as Record<string, any>[]) : []
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
          })
        }

        const field: FieldDefinition = {
          key: `${className}::${propertyName}`,
          className,
          classLabel,
          schemaId: schemaMeta.id,
          schemaLabel: schemaMeta.label,
          schemaUrl: schemaMeta.url,
          propertyName,
          label: String(input.label ?? propertyName),
          help: typeof input.help === 'string' ? input.help : undefined,
          multiple: this.parseBoolean(input.multiple),
          valueKind: this.resolveValueKind(input, classes),
          selectValues: Array.isArray(input.values)
            ? input.values
                .map((value) => String(value))
                .filter((value) => value.trim().length > 0)
            : [],
        }

        fields.push(field)
      }
    }

    fields.sort((a, b) => {
      const classCompare = a.classLabel.localeCompare(b.classLabel)
      if (classCompare !== 0) {
        return classCompare
      }
      const schemaCompare = a.schemaLabel.localeCompare(b.schemaLabel)
      if (schemaCompare !== 0) {
        return schemaCompare
      }
      return a.label.localeCompare(b.label)
    })

    const schemas = Array.from(schemasById.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    )

    return { fields, schemas }
  }

  protected findLayoutForClass(
    layouts: Record<string, any>[],
    className: string,
  ): Record<string, any> | undefined {
    return layouts.find((layout) => {
      const appliesTo = Array.isArray(layout?.appliesTo) ? layout.appliesTo : []
      return appliesTo.includes(className)
    })
  }

  protected getFieldGroup(input: Record<string, any>): string {
    if (typeof input.group === 'string' && input.group.trim().length > 0) {
      return input.group.trim()
    }
    return 'about'
  }

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

  protected normalizeSchemaId(label: string): string {
    return label.trim().toLowerCase().replace(/\s+/g, ' ')
  }

  protected parseBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      return value.trim().toLowerCase() === 'true'
    }
    return false
  }

  protected resolveValueKind(
    input: Record<string, any>,
    classes: Record<string, any>,
  ): FieldValueKind {
    if (Array.isArray(input.values) && input.values.length > 0) {
      return 'select'
    }

    const types = Array.isArray(input.type)
      ? input.type.map((type: unknown) => String(type))
      : input.type
        ? [String(input.type)]
        : []

    const firstType = types[0] ?? ''
    if (firstType && classes[firstType]?.inputs) {
      return 'json'
    }

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

  protected getEntityDisplayName(entity: Record<string, any>): string {
    const name = entity?.name ?? entity?.title ?? entity?.['@id']
    return typeof name === 'string' && name.trim().length > 0 ? name.trim() : '(unnamed)'
  }

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

  protected getVisibleFields(): FieldDefinition[] {
    return Array.from(this.fieldsByKey.values()).filter((field) => {
      if (field.schemaId === '__about__') {
        return true
      }
      return this.selectedSchemaIds.has(field.schemaId)
    })
  }

  protected getAllowedOperators(field?: FieldDefinition): BulkOperator[] {
    if (!field) {
      return ['set', 'unset']
    }
    return field.multiple ? ['add', 'remove', 'set', 'unset'] : ['set', 'unset']
  }

  protected onSchemaSelectionChange = (schemaIds: string[]) => {
    this.selectedSchemaIds = new Set(schemaIds)
    this.update()
  }

  protected toggleEntityList = () => {
    this.showEntityList = !this.showEntityList
    this.update()
  }

  protected addOperation = () => {
    this.operations.push(this.createOperation())
    this.update()
  }

  protected removeOperation = (id: string) => {
    const index = this.operations.findIndex((op) => op.id === id)
    if (index === -1) {
      return
    }
    this.operations.splice(index, 1)
    if (this.operations.length === 0) {
      this.operations.push(this.createOperation())
    }
    this.update()
  }

  protected setOperationField = (id: string, fieldKey?: string) => {
    const row = this.operations.find((operation) => operation.id === id)
    if (!row) {
      return
    }
    row.fieldKey = fieldKey
    row.value = ''

    const field = fieldKey ? this.fieldsByKey.get(fieldKey) : undefined
    const allowed = this.getAllowedOperators(field)
    if (!allowed.includes(row.operator)) {
      row.operator = allowed[0]
    }
    this.update()
  }

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

  protected setOperationValue = (id: string, value: string) => {
    const row = this.operations.find((operation) => operation.id === id)
    if (!row) {
      return
    }
    row.value = value
    this.update()
  }

  protected getValidationErrors(): string[] {
    const errors: string[] = []

    if (this.operations.length === 0) {
      errors.push('Add at least one edit operation.')
      return errors
    }

    for (let index = 0; index < this.operations.length; index += 1) {
      const row = this.operations[index]
      const field = row.fieldKey ? this.fieldsByKey.get(row.fieldKey) : undefined
      if (!field) {
        errors.push(`Row ${index + 1}: select a property.`)
        continue
      }

      if (!this.selectedSchemaIds.has(field.schemaId)) {
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

  protected validateValue(field: FieldDefinition, rawValue: string): string | undefined {
    if (field.valueKind === 'number') {
      const numberValue = Number(rawValue)
      if (!Number.isFinite(numberValue)) {
        return `value must be a number for ${field.label}.`
      }
    }

    if (field.valueKind === 'json') {
      try {
        JSON.parse(rawValue)
      } catch {
        return `value must be valid JSON for ${field.label}.`
      }
    }

    return undefined
  }

  protected parseValue(field: FieldDefinition, rawValue: string): unknown {
    if (field.valueKind === 'number') {
      return Number(rawValue)
    }
    if (field.valueKind === 'json') {
      return JSON.parse(rawValue)
    }
    return rawValue
  }

  protected entitySupportsField(entity: Record<string, any>, field: FieldDefinition): boolean {
    const rawType = entity?.['@type']
    const typeList = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
    return typeList.some((typeValue) => this.toTypeTail(String(typeValue)) === field.className)
  }

  protected ensureSchemaAssociation(entity: Record<string, any>, schemaUrl?: string): boolean {
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
        const idValue = (item as Record<string, unknown>)['@id'] ?? (item as Record<string, unknown>).id
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
      const nextValue =
        field.multiple && !Array.isArray(parsedValue) ? [parsedValue] : parsedValue
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
      if (this.arrayContains(existingValues, parsedValue)) {
        return false
      }
      entity[propertyName] = [...existingValues, parsedValue]
      return true
    }

    if (operator === 'remove') {
      const filtered = existingValues.filter((value) => !this.areValuesEqual(value, parsedValue))
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

  protected toArray(value: unknown): unknown[] {
    if (value === undefined || value === null) {
      return []
    }
    if (Array.isArray(value)) {
      return [...value]
    }
    return [value]
  }

  protected arrayContains(values: unknown[], target: unknown): boolean {
    return values.some((value) => this.areValuesEqual(value, target))
  }

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

  protected stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`
    }
    const objectValue = value as Record<string, unknown>
    const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b))
    const content = keys
      .map((key) => `${JSON.stringify(key)}:${this.stableStringify(objectValue[key])}`)
      .join(',')
    return `{${content}}`
  }

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

    const graph = JSON.parse(JSON.stringify(currentCrate['@graph'])) as Record<string, any>[]
    const selectedEntitySet = new Set(this.entityIds)

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
          skippedOperations += 1
          continue
        }

        if (!this.entitySupportsField(entity, field)) {
          skippedOperations += 1
          continue
        }

        try {
          const parsedValue =
            operation.operator === 'unset'
              ? undefined
              : this.parseValue(field, operation.value.trim())
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

          if (
            changedByOperation &&
            (operation.operator === 'set' || operation.operator === 'add')
          ) {
            const schemaChanged = this.ensureSchemaAssociation(entity, field.schemaUrl)
            if (schemaChanged) {
              changed = true
            }
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

  protected renderValueEditor(row: OperationRow, field: FieldDefinition | undefined): React.ReactNode {
    if (row.operator === 'unset') {
      return <span className="entities-overview-edit-modal-no-value">No value</span>
    }

    if (!field) {
      return <Input disabled placeholder="Select property first" />
    }

    if (field.valueKind === 'select' && field.selectValues.length > 0) {
      return (
        <Select
          value={row.value || undefined}
          onChange={(value) => this.setOperationValue(row.id, String(value ?? ''))}
          getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
          options={field.selectValues.map((option) => ({
            label: option,
            value: option,
          }))}
          showSearch
          allowClear
          placeholder="Select value"
          style={{ width: '100%' }}
        />
      )
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

    return (
      <Input
        value={row.value}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
          this.setOperationValue(row.id, event.target.value)
        }
        placeholder="Enter value"
        type={field.valueKind === 'number' ? 'number' : field.valueKind === 'date' ? 'date' : 'text'}
      />
    )
  }

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
                getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
                style={{ width: '48%' }}
                showSearch
                optionFilterProp="label"
                options={visibleFields.map((item) => ({
                  value: item.key,
                  label: `[${item.classLabel}] ${item.label} - ${item.schemaLabel}`,
                  title: item.help ?? item.label,
                }))}
              />
              <Select
                value={row.operator}
                onChange={(value) =>
                  this.setOperationOperator(row.id, value as BulkOperator)
                }
                getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
                style={{ width: 120 }}
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
                Processed entities: <strong>{this.executionSummary.processedEntities}</strong>
              </div>
              <div>
                Updated entities: <strong>{this.executionSummary.updatedEntities}</strong>
              </div>
              <div>
                Applied operations: <strong>{this.executionSummary.appliedOperations}</strong>
              </div>
              <div>
                Skipped operations: <strong>{this.executionSummary.skippedOperations}</strong>
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

        {this.showEntityList && (
          <ul className="entities-overview-edit-modal-list">
            {this.entitySummaries.map((entity) => (
              <li key={entity.id}>
                <span className="entities-overview-edit-modal-entity-name">{entity.name}</span>{' '}
                <Tag>{entity.typeLabel}</Tag>
                <code>{entity.id}</code>
              </li>
            ))}
          </ul>
        )}

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
            getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
            style={{ width: '100%' }}
            maxTagCount="responsive"
          />
        </div>

        <div className="entities-overview-edit-modal-section">
          <div className="entities-overview-edit-modal-row-header">
            <span className="entities-overview-edit-modal-label">Edit operations</span>
            <Button onClick={this.addOperation} type="dashed" disabled={visibleFields.length === 0}>
              Add rule
            </Button>
          </div>
          {visibleFields.length === 0 ? (
            <Alert
              type="info"
              showIcon
              message="No properties are available for the selected schemas."
            />
          ) : (
            this.renderOperations()
          )}
        </div>

        {validationErrors.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="Please fix the following issues before running multi-edit."
            description={
              <ul className="entities-overview-edit-modal-errors">
                {validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            }
          />
        )}

        <div className="entities-overview-edit-modal-actions">
          <Button type="primary" onClick={() => void this.runOperations()} disabled={!canExecute}>
            {this.isExecuting ? 'Running...' : 'Start multi-edit'}
          </Button>
        </div>

        {this.renderSummary()}
      </div>
    )
  }

  get value(): void {
    return undefined
  }
}
