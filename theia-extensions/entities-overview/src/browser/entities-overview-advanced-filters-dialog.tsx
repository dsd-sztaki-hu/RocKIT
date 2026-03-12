import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import * as React from '@theia/core/shared/react'
import { Alert, Button, Input, Select } from 'antd'
import {
  ALL_ENTITY_TYPES_OPTION,
  AdvancedFilterCatalog,
  AdvancedFilterGroupNode,
  AdvancedFilterRuleNode,
  AdvancedFilterState,
  AdvancedRuleOperator,
  decodeAdvancedRuleValues,
  encodeAdvancedRuleValues,
  cloneAdvancedFilterState,
} from './entities-overview-advanced-filtering'

const OPERATOR_OPTIONS: { value: AdvancedRuleOperator; label: string }[] = [
  { value: 'equal', label: '==' },
  { value: 'not_equal', label: '!=' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Not contains' },
  { value: 'is_null', label: 'Is null' },
  { value: 'is_not_null', label: 'Is not null' },
]

const OPERATORS_WITHOUT_VALUE = new Set<AdvancedRuleOperator>(['is_null', 'is_not_null'])

export class AdvancedFiltersDialog extends ReactDialog<AdvancedFilterState> {
  protected readonly fieldsByKey: Map<
    string,
    AdvancedFilterCatalog['fields'][number]
  >
  protected readonly graph: Record<string, unknown>[]
  protected readonly graphById = new Map<string, Record<string, unknown>>()
  protected readonly ruleSearch = new Map<string, string>()

  protected draft: AdvancedFilterState
  protected idCounter = 0

  constructor(
    protected readonly catalog: AdvancedFilterCatalog,
    initialState?: AdvancedFilterState,
    protected readonly entityTypeOptions: string[] = [],
    crate?: Record<string, unknown>,
  ) {
    super({ title: 'Advanced filters' })
    this.fieldsByKey = new Map(
      this.catalog.fields.map((field) => [field.key, field] as const),
    )
    this.graph = Array.isArray(crate?.['@graph'])
      ? (crate['@graph'] as Record<string, unknown>[])
      : []
    for (const entity of this.graph) {
      const id = entity['@id']
      if (typeof id === 'string' && id.trim().length > 0) {
        this.graphById.set(id, entity)
      }
    }
    this.draft = this.initializeState(initialState)
    this.appendCloseButton('Close')
    this.appendAcceptButton('Apply')
  }

  get value(): AdvancedFilterState {
    return cloneAdvancedFilterState(this.draft)
  }

  protected initializeState(initial?: AdvancedFilterState): AdvancedFilterState {
    const availableSchemaIds = new Set(this.catalog.schemas.map((schema) => schema.id))
    const availableEntityTypes = new Set(this.entityTypeOptions)
    const selectedSchemaIds =
      initial?.selectedSchemaIds.filter((schemaId) => availableSchemaIds.has(schemaId)) ??
      []
    const selectedEntityType =
      initial?.selectedEntityType &&
      availableEntityTypes.has(initial.selectedEntityType)
        ? initial.selectedEntityType
        : ALL_ENTITY_TYPES_OPTION

    const root = initial?.root ? this.cloneGroup(initial.root) : this.createGroup(false)
    if (root.children.length === 0) {
      root.children.push(this.createRule())
    }
    return {
      selectedEntityType,
      selectedSchemaIds: [...selectedSchemaIds],
      root,
    }
  }

  protected render(): React.ReactNode {
    const visibleFields = this.getVisibleFields()

    return (
      <div className="entities-overview-advanced-modal-body">
        <div className="entities-overview-edit-modal-section">
          <span className="entities-overview-edit-modal-label">Entity type</span>
          <Select
            value={this.draft.selectedEntityType}
            options={[
              { value: ALL_ENTITY_TYPES_OPTION, label: 'All' },
              ...this.entityTypeOptions.map((typeLabel) => ({
                value: typeLabel,
                label: typeLabel,
              })),
            ]}
            onChange={(value) => this.onEntityTypeSelectionChange(String(value))}
            placeholder="All"
            getPopupContainer={() => document.body}
            classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
            styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
            style={{ width: '100%' }}
          />
        </div>
        <div className="entities-overview-edit-modal-section">
          <span className="entities-overview-edit-modal-label">Select schemas</span>
          <Select
            mode="multiple"
            value={this.draft.selectedSchemaIds}
            options={this.catalog.schemas.map((schema) => ({
              value: schema.id,
              label: schema.label,
            }))}
            onChange={(values) => this.onSchemaSelectionChange(values as string[])}
            placeholder="Select schemas"
            getPopupContainer={() => document.body}
            classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
            styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
            style={{ width: '100%' }}
            maxTagCount="responsive"
          />
        </div>

        {visibleFields.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message="No properties are available for the selected schemas."
          />
        ) : (
          this.renderGroup(this.draft.root, true)
        )}
      </div>
    )
  }

  protected renderGroup(group: AdvancedFilterGroupNode, isRoot: boolean): React.ReactNode {
    const canChooseConjunction = group.children.length > 1
    return (
      <div className={`entities-overview-advanced-group${isRoot ? ' is-root' : ''}`}>
        <div className="entities-overview-advanced-group-header">
          <Button.Group size="small">
            <Button
              type={group.not ? 'primary' : 'default'}
              onClick={() => this.setGroupNot(group.id, !group.not)}
            >
              Not
            </Button>
            <Button
              type={group.combinator === 'and' ? 'primary' : 'default'}
              onClick={() => this.setGroupCombinator(group.id, 'and')}
              disabled={!canChooseConjunction}
            >
              And
            </Button>
            <Button
              type={group.combinator === 'or' ? 'primary' : 'default'}
              onClick={() => this.setGroupCombinator(group.id, 'or')}
              disabled={!canChooseConjunction}
            >
              Or
            </Button>
          </Button.Group>
          <div className="entities-overview-advanced-group-actions">
            <Button size="small" onClick={() => this.addRule(group.id)}>
              + Add rule
            </Button>
            <Button size="small" onClick={() => this.addGroup(group.id)}>
              + Add group
            </Button>
            {!isRoot && (
              <button
                type="button"
                className="entities-overview-edit-modal-remove entities-overview-advanced-group-remove"
                title="Remove group"
                aria-label="Remove group"
                onClick={() => this.removeNode(group.id)}
              >
                <span className="codicon codicon-trash" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="entities-overview-advanced-group-children">
          {group.children.map((child) =>
            child.kind === 'group' ? (
              <div key={child.id}>{this.renderGroup(child, false)}</div>
            ) : (
              <div key={child.id}>{this.renderRule(child)}</div>
            ),
          )}
        </div>
      </div>
    )
  }

  protected renderRule(rule: AdvancedFilterRuleNode): React.ReactNode {
    const visibleFields = this.getVisibleFields()
    const selectedField = rule.fieldKey ? this.fieldsByKey.get(rule.fieldKey) : undefined
    const fieldOptions = visibleFields.map((field) => ({
      value: field.key,
      label: `${field.label} - ${field.schemaLabel}`,
      title: field.help ?? field.label,
    }))
    if (
      selectedField &&
      !fieldOptions.some((option) => option.value === selectedField.key)
    ) {
      fieldOptions.unshift({
        value: selectedField.key,
        label: `${selectedField.label} - ${selectedField.schemaLabel} (hidden by schema selection)`,
        title: selectedField.help ?? selectedField.label,
      })
    }

    return (
      <div className="entities-overview-edit-modal-row entities-overview-advanced-rule-row">
        <Select
          value={rule.fieldKey}
          onChange={(value) => this.setRuleField(rule.id, String(value))}
          placeholder="Select field"
          getPopupContainer={() => document.body}
          classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
          styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
          style={{ width: '42%' }}
          showSearch
          optionFilterProp="label"
          options={fieldOptions}
        />
        <Select
          value={rule.operator}
          onChange={(value) =>
            this.setRuleOperator(rule.id, value as AdvancedRuleOperator)
          }
          getPopupContainer={() => document.body}
          classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
          style={{ width: 130 }}
          options={OPERATOR_OPTIONS}
        />
        <div className="entities-overview-edit-modal-value entities-overview-advanced-rule-value">
          {OPERATORS_WITHOUT_VALUE.has(rule.operator) ? (
            <span className="entities-overview-edit-modal-no-value">
              No value required
            </span>
          ) : (
            this.renderRuleValueEditor(rule, selectedField)
          )}
        </div>
        <div className="entities-overview-edit-modal-row-actions entities-overview-advanced-rule-actions">
          <button
            type="button"
            className="entities-overview-edit-modal-remove entities-overview-advanced-rule-remove"
            title="Remove rule"
            aria-label="Remove rule"
            onClick={() => this.removeNode(rule.id)}
          >
            <span className="codicon codicon-trash" aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  protected getVisibleFields() {
    const selected = new Set(this.draft.selectedSchemaIds)
    return this.catalog.fields.filter((field) => selected.has(field.schemaId))
  }

  protected onSchemaSelectionChange(schemaIds: string[]): void {
    this.draft.selectedSchemaIds = [...schemaIds]
    this.update()
  }

  protected onEntityTypeSelectionChange(entityType: string): void {
    this.draft.selectedEntityType = entityType
    this.update()
  }

  protected addRule(groupId: string): void {
    this.updateGroup(groupId, (group) => {
      group.children.push(this.createRule())
    })
  }

  protected addGroup(groupId: string): void {
    this.updateGroup(groupId, (group) => {
      group.children.push(this.createGroup(true))
    })
  }

  protected setGroupNot(groupId: string, not: boolean): void {
    this.updateGroup(groupId, (group) => {
      group.not = not
    })
  }

  protected setGroupCombinator(
    groupId: string,
    combinator: AdvancedFilterGroupNode['combinator'],
  ): void {
    this.updateGroup(groupId, (group) => {
      group.combinator = combinator
    })
  }

  protected setRuleField(ruleId: string, fieldKey: string): void {
    this.updateRule(ruleId, (rule) => {
      rule.fieldKey = fieldKey
      rule.value = ''
    })
    this.ruleSearch.delete(ruleId)
  }

  protected setRuleOperator(ruleId: string, operator: AdvancedRuleOperator): void {
    this.updateRule(ruleId, (rule) => {
      rule.operator = operator
      if (OPERATORS_WITHOUT_VALUE.has(operator)) {
        rule.value = ''
        return
      }
      const values = decodeAdvancedRuleValues(rule.value)
      if (values.length > 1 && !this.supportsMultiObjectSelection(operator)) {
        rule.value = values[0]
      }
    })
  }

  protected setRuleValue(ruleId: string, value: string): void {
    this.updateRule(ruleId, (rule) => {
      rule.value = value
    })
  }

  protected override handleEnter(event: KeyboardEvent): boolean | void {
    const target = event.target
    if (target instanceof HTMLElement) {
      const isFormControlContext =
        Boolean(target.closest('.ant-select')) ||
        Boolean(target.closest('.ant-select-dropdown')) ||
        Boolean(target.closest('.ant-input')) ||
        target.tagName.toLowerCase() === 'input'
      if (isFormControlContext) {
        return false
      }
    }
    return super.handleEnter(event)
  }

  protected removeNode(nodeId: string): void {
    if (nodeId === this.draft.root.id) {
      return
    }
    const removed = this.removeNodeFromGroup(this.draft.root, nodeId)
    if (!removed) {
      return
    }
    if (this.draft.root.children.length === 0) {
      this.draft.root.children.push(this.createRule())
    }
    this.ruleSearch.clear()
    this.update()
  }

  protected renderRuleValueEditor(
    rule: AdvancedFilterRuleNode,
    field: AdvancedFilterCatalog['fields'][number] | undefined,
  ): React.ReactNode {
    if (!field) {
      return <Input disabled placeholder="Select field first" />
    }

    if (field.expectsObjectValue) {
      return this.renderObjectValueEditor(rule, field)
    }

    return (
      <Input
        value={rule.value}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
          this.setRuleValue(rule.id, event.target.value)
        }
        placeholder="Enter string"
      />
    )
  }

  protected renderObjectValueEditor(
    rule: AdvancedFilterRuleNode,
    field: AdvancedFilterCatalog['fields'][number],
  ): React.ReactNode {
    const searchText = this.ruleSearch.get(rule.id) ?? ''
    const options = this.getExistingObjectOptions(field, searchText)
    const isMultiSelect = this.supportsMultiObjectSelection(rule.operator)
    const selectedValues = decodeAdvancedRuleValues(rule.value)
    const selectedValue = isMultiSelect
      ? selectedValues
      : selectedValues[0] ?? undefined
    return (
      <Select
        className="entities-overview-advanced-object-select"
        value={selectedValue}
        onChange={(value) => {
          if (Array.isArray(value)) {
            const stringValues = value.map((item) => String(item))
            this.setRuleValue(rule.id, encodeAdvancedRuleValues(stringValues))
            return
          }
          this.setRuleValue(
            rule.id,
            encodeAdvancedRuleValues([String(value ?? '')]),
          )
        }}
        showSearch
        onSearch={(value: string) => this.setRuleSearch(rule.id, value)}
        filterOption={false}
        allowClear
        mode={isMultiSelect ? 'multiple' : undefined}
        maxTagCount={isMultiSelect ? 'responsive' : undefined}
        placeholder={
          options.length > 0
            ? isMultiSelect
              ? 'Select one or more existing objects'
              : 'Search existing objects'
            : 'No existing object values found'
        }
        getPopupContainer={() => document.body}
        classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
        styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
        options={options}
        notFoundContent={
          <span className="entities-overview-entity-no-data">No matches</span>
        }
      />
    )
  }

  protected supportsMultiObjectSelection(operator: AdvancedRuleOperator): boolean {
    return (
      operator === 'equal' ||
      operator === 'not_equal' ||
      operator === 'contains' ||
      operator === 'not_contains'
    )
  }

  protected setRuleSearch(ruleId: string, value: string): void {
    this.ruleSearch.set(ruleId, value)
    this.update()
  }

  protected getExistingObjectOptions(
    field: AdvancedFilterCatalog['fields'][number],
    searchText: string,
  ): { value: string; label: React.ReactNode; title?: string }[] {
    const normalizedSearch = searchText.trim().toLowerCase()
    const uniqueValues = new Map<
      string,
      { label: React.ReactNode; title: string; searchIndex: string }
    >()

    for (const entity of this.graph) {
      if (!this.entitySupportsField(entity, field)) {
        continue
      }
      const rawFieldValue = entity[field.propertyName]
      for (const objectValue of this.extractObjectValues(rawFieldValue)) {
        const comparable = this.toComparableObjectValue(objectValue)
        if (!comparable || uniqueValues.has(comparable)) {
          continue
        }
        const descriptor = this.describeObjectOption(objectValue, comparable)
        uniqueValues.set(comparable, descriptor)
      }
    }

    return Array.from(uniqueValues.entries())
      .filter(([, descriptor]) => {
        if (!normalizedSearch) {
          return true
        }
        return descriptor.searchIndex.includes(normalizedSearch)
      })
      .sort(([, a], [, b]) => a.title.localeCompare(b.title))
      .map(([value, descriptor]) => ({
        value,
        label: descriptor.label,
        title: descriptor.title,
      }))
  }

  protected entitySupportsField(
    entity: Record<string, unknown>,
    field: AdvancedFilterCatalog['fields'][number],
  ): boolean {
    if (field.supportedClasses.length === 0) {
      return true
    }
    return this.getEntityTypeNames(entity).some((typeName) =>
      field.supportedClasses.includes(typeName),
    )
  }

  protected getEntityTypeNames(entity: Record<string, unknown>): string[] {
    const rawType = entity['@type']
    const candidates = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
    const names: string[] = []
    const seen = new Set<string>()
    for (const candidate of candidates) {
      const typeName = this.toTypeTail(String(candidate))
      if (!typeName || typeName === 'CreativeWork' || seen.has(typeName)) {
        continue
      }
      seen.add(typeName)
      names.push(typeName)
    }
    return names
  }

  protected toTypeTail(typeName: string): string {
    const trimmed = typeName.trim()
    if (!trimmed) {
      return ''
    }
    const slashIndex = trimmed.lastIndexOf('/')
    const hashIndex = trimmed.lastIndexOf('#')
    const cut = Math.max(slashIndex, hashIndex)
    if (cut < 0) {
      return trimmed
    }
    return trimmed.slice(cut + 1)
  }

  protected extractObjectValues(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractObjectValues(item))
    }
    if (value && typeof value === 'object') {
      return [value as Record<string, unknown>]
    }
    return []
  }

  protected toComparableObjectValue(value: Record<string, unknown>): string {
    if (typeof value['@id'] === 'string' && value['@id'].trim().length > 0) {
      return value['@id'].trim()
    }
    if (value['@value'] !== undefined && value['@value'] !== null) {
      return String(value['@value']).trim()
    }
    if (typeof value.name === 'string' && value.name.trim().length > 0) {
      return value.name.trim()
    }
    return this.stableStringify(value)
  }

  protected stableStringify(value: unknown): string {
    if (value === null || value === undefined) {
      return ''
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`
    }
    if (typeof value !== 'object') {
      return JSON.stringify(value)
    }
    const objectValue = value as Record<string, unknown>
    const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b))
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${this.stableStringify(objectValue[key])}`)
      .join(',')}}`
  }

  protected describeObjectOption(
    value: Record<string, unknown>,
    comparableValue: string,
  ): { label: React.ReactNode; title: string; searchIndex: string } {
    const idValue =
      typeof value['@id'] === 'string' && value['@id'].trim().length > 0
        ? value['@id'].trim()
        : undefined
    if (idValue) {
      const referencedEntity = this.graphById.get(idValue)
      if (referencedEntity) {
        const rawType = this.getEntityTypeNames(referencedEntity)[0] ?? 'Entity'
        const typeLabel = this.formatTypeLabel(rawType)
        const displayName = this.getEntityDisplayName(referencedEntity)
        const searchIndex = `${displayName} ${idValue} ${typeLabel}`.toLowerCase()
        return {
          label: (
            <span className="entities-overview-entity-option">
              <span className="entities-overview-entity-option-type">{typeLabel}</span>
              <span className="entities-overview-entity-option-name">{displayName}</span>
            </span>
          ),
          title: idValue,
          searchIndex,
        }
      }
    }

    const textValue = comparableValue || this.stableStringify(value)
    const display = textValue || '(empty object)'
    return {
      label: (
        <span className="entities-overview-entity-option">
          <span className="entities-overview-entity-option-type">Object</span>
          <span className="entities-overview-entity-option-name">{display}</span>
        </span>
      ),
      title: display,
      searchIndex: display.toLowerCase(),
    }
  }

  protected getEntityDisplayName(entity: Record<string, unknown>): string {
    const value = entity.name ?? entity.title ?? entity.label ?? entity['@id']
    const text = String(value ?? '').trim()
    return text.length > 0 ? text : '(unnamed)'
  }

  protected formatTypeLabel(typeName: string): string {
    const tail = this.toTypeTail(typeName)
    if (!tail) {
      return 'Entity'
    }
    return tail.charAt(0).toUpperCase() + tail.slice(1)
  }

  protected updateGroup(
    groupId: string,
    callback: (group: AdvancedFilterGroupNode) => void,
  ): void {
    const group = this.findGroup(this.draft.root, groupId)
    if (!group) {
      return
    }
    callback(group)
    this.update()
  }

  protected updateRule(
    ruleId: string,
    callback: (rule: AdvancedFilterRuleNode) => void,
  ): void {
    const rule = this.findRule(this.draft.root, ruleId)
    if (!rule) {
      return
    }
    callback(rule)
    this.update()
  }

  protected findGroup(
    group: AdvancedFilterGroupNode,
    groupId: string,
  ): AdvancedFilterGroupNode | undefined {
    if (group.id === groupId) {
      return group
    }
    for (const child of group.children) {
      if (child.kind !== 'group') {
        continue
      }
      const match = this.findGroup(child, groupId)
      if (match) {
        return match
      }
    }
    return undefined
  }

  protected findRule(
    group: AdvancedFilterGroupNode,
    ruleId: string,
  ): AdvancedFilterRuleNode | undefined {
    for (const child of group.children) {
      if (child.kind === 'rule' && child.id === ruleId) {
        return child
      }
      if (child.kind === 'group') {
        const match = this.findRule(child, ruleId)
        if (match) {
          return match
        }
      }
    }
    return undefined
  }

  protected removeNodeFromGroup(group: AdvancedFilterGroupNode, nodeId: string): boolean {
    const index = group.children.findIndex((child) => child.id === nodeId)
    if (index >= 0) {
      group.children.splice(index, 1)
      return true
    }
    for (const child of group.children) {
      if (child.kind !== 'group') {
        continue
      }
      if (this.removeNodeFromGroup(child, nodeId)) {
        return true
      }
    }
    return false
  }

  protected createRule(): AdvancedFilterRuleNode {
    return {
      id: this.nextNodeId('rule'),
      kind: 'rule',
      fieldKey: undefined,
      operator: 'equal',
      value: '',
    }
  }

  protected createGroup(withInitialRule: boolean): AdvancedFilterGroupNode {
    return {
      id: this.nextNodeId('group'),
      kind: 'group',
      combinator: 'and',
      not: false,
      children: withInitialRule ? [this.createRule()] : [],
    }
  }

  protected nextNodeId(prefix: string): string {
    this.idCounter += 1
    return `${prefix}-${this.idCounter}-${Math.random().toString(36).slice(2, 8)}`
  }

  protected cloneGroup(group: AdvancedFilterGroupNode): AdvancedFilterGroupNode {
    return {
      id: group.id || this.nextNodeId('group'),
      kind: 'group',
      combinator: group.combinator === 'or' ? 'or' : 'and',
      not: Boolean(group.not),
      children: (Array.isArray(group.children) ? group.children : []).map((child) =>
        child.kind === 'group'
          ? this.cloneGroup(child)
          : {
              id: child.id || this.nextNodeId('rule'),
              kind: 'rule',
              fieldKey: child.fieldKey,
              operator: OPERATOR_OPTIONS.some((item) => item.value === child.operator)
                ? child.operator
                : 'equal',
              value: String(child.value ?? ''),
            },
      ),
    }
  }
}
