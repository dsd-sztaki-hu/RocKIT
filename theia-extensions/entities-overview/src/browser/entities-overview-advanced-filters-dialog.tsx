// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { nls } from '@theia/core/lib/common/nls'
import * as React from '@theia/core/shared/react'
import { Alert, Button, DatePicker, Input, Select, Switch } from 'antd'
import dayjs = require('dayjs')
import {
  ALL_ENTITY_TYPES_OPTION,
  AdvancedFilterCatalog,
  AdvancedFieldValueKind,
  AdvancedFilterGroupNode,
  AdvancedFilterRuleNode,
  AdvancedFilterState,
  AdvancedRuleOperator,
  SCHEMA_ORG_SCHEMA_ID,
  decodeAdvancedRuleValues,
  encodeAdvancedRuleValues,
  cloneAdvancedFilterState,
} from './entities-overview-advanced-filtering'

const BASE_OPERATOR_OPTIONS: { value: AdvancedRuleOperator; label: string }[] = [
  { value: 'equal', label: '==' },
  { value: 'not_equal', label: '!=' },
  { value: 'contains', label: nls.localize('rockit/entitiesOverview/contains', 'Contains') },
  { value: 'not_contains', label: nls.localize('rockit/entitiesOverview/notContains', 'Not contains') },
  { value: 'is_null', label: nls.localize('rockit/entitiesOverview/isNull', 'Is null') },
  { value: 'is_not_null', label: nls.localize('rockit/entitiesOverview/isNotNull', 'Is not null') },
]

const DATE_OPERATOR_OPTIONS: { value: AdvancedRuleOperator; label: string }[] = [
  { value: 'equal', label: '==' },
  { value: 'not_equal', label: '!=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'between', label: nls.localize('rockit/entitiesOverview/between', 'Between') },
  { value: 'not_between', label: nls.localize('rockit/entitiesOverview/notBetween', 'Not between') },
  { value: 'is_null', label: nls.localize('rockit/entitiesOverview/isNull', 'Is null') },
  { value: 'is_not_null', label: nls.localize('rockit/entitiesOverview/isNotNull', 'Is not null') },
]

const OBJECT_OPERATOR_OPTIONS: { value: AdvancedRuleOperator; label: string }[] = [
  ...BASE_OPERATOR_OPTIONS,
  { value: 'fields', label: nls.localize('rockit/entitiesOverview/fields', 'Fields') },
]
const VALUE_KIND_LABELS: Record<AdvancedFieldValueKind, string> = {
  entity: nls.localize('rockit/entitiesOverview/propertyValue', 'PropertyValue'),
  text: nls.localize('rockit/entitiesOverview/text', 'Text'),
  url: 'URL',
  date: nls.localize('rockit/entitiesOverview/date', 'Date'),
}

const OPERATORS_WITHOUT_VALUE = new Set<AdvancedRuleOperator>(['is_null', 'is_not_null'])
const RANGE_OPERATORS = new Set<AdvancedRuleOperator>(['between', 'not_between'])
const KNOWN_OPERATORS = new Set<AdvancedRuleOperator>([
  ...BASE_OPERATOR_OPTIONS.map((item) => item.value),
  ...DATE_OPERATOR_OPTIONS.map((item) => item.value),
  'fields',
])

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
    super({ title: nls.localize('rockit/entitiesOverview/advancedFilters', 'Advanced filters') })
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
    this.appendCloseButton(nls.localize('rockit/entitiesOverview/close', 'Close'))
    this.appendAcceptButton(nls.localize('rockit/entitiesOverview/apply', 'Apply'))
  }

  get value(): AdvancedFilterState {
    return cloneAdvancedFilterState(this.draft)
  }

  /**
   * Initializes dialog state from persisted filters and available options.
   */
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
      schemaOrgEnabled: Boolean(initial?.schemaOrgEnabled),
      root,
    }
  }

  /**
   * Renders the dialog shell with top-level selectors and the rule tree.
   */
  protected render(): React.ReactNode {
    const visibleFields = this.getVisibleFields()

    return (
      <div className="entities-overview-advanced-modal-body">
        <div className="entities-overview-edit-modal-section">
          <span className="entities-overview-edit-modal-label">{nls.localize('rockit/entitiesOverview/entityType', 'Entity type')}</span>
          <Select
            value={this.draft.selectedEntityType}
            options={[
              { value: ALL_ENTITY_TYPES_OPTION, label: nls.localize('rockit/entitiesOverview/all', 'All') },
              ...this.entityTypeOptions.map((typeLabel) => ({
                value: typeLabel,
                label: typeLabel,
              })),
            ]}
            onChange={(value) => this.onEntityTypeSelectionChange(String(value))}
            placeholder={nls.localize('rockit/entitiesOverview/all', 'All')}
            getPopupContainer={() => document.body}
            classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
            styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
            style={{ width: '100%' }}
          />
        </div>
        <div className="entities-overview-edit-modal-section">
          <span className="entities-overview-edit-modal-label">{nls.localize('rockit/entitiesOverview/selectSchemas', 'Select schemas')}</span>
          <Select
            mode="multiple"
            value={this.draft.selectedSchemaIds}
            options={this.catalog.schemas.map((schema) => ({
              value: schema.id,
              label: schema.label,
            }))}
            onChange={(values) => this.onSchemaSelectionChange(values as string[])}
            placeholder={nls.localize('rockit/entitiesOverview/selectSchemas', 'Select schemas')}
            getPopupContainer={() => document.body}
            classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
            styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
            style={{ width: '100%' }}
            maxTagCount="responsive"
          />
          <div className="entities-overview-edit-modal-schema-org-toggle">
            <span className="entities-overview-edit-modal-label">
              {nls.localize('rockit/entitiesOverview/enableOtherOntologies', 'Enable properties from other ontologies')}
            </span>
            <Switch
              checked={this.draft.schemaOrgEnabled}
              onChange={(enabled) => this.onSchemaOrgToggle(enabled)}
            />
          </div>
        </div>

        {visibleFields.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message={
              this.draft.schemaOrgEnabled
                ? nls.localize('rockit/entitiesOverview/noPropertiesWithOntologies', 'No properties are available for the selected schemas or other ontologies.')
                : nls.localize('rockit/entitiesOverview/noProperties', 'No properties are available for the selected schemas.')
            }
          />
        ) : (
          this.renderGroup(this.draft.root, true)
        )}
      </div>
    )
  }

  /**
   * Renders one logical group (Not/And/Or + children).
   * Auto-transforms single `fields` groups into the compact object-fields layout.
   */
  protected renderGroup(group: AdvancedFilterGroupNode, isRoot: boolean): React.ReactNode {
    const transformedFieldsRule = this.getTransformedFieldsRule(group)
    if (transformedFieldsRule) {
      return this.renderTransformedFieldsGroup(group, isRoot, transformedFieldsRule)
    }

    const canChooseConjunction = group.children.length > 1
    return (
      <div className={`entities-overview-advanced-group${isRoot ? ' is-root' : ''}`}>
        <div className="entities-overview-advanced-group-header">
          <Button.Group size="small">
            <Button
              type={group.not ? 'primary' : 'default'}
              onClick={() => this.setGroupNot(group.id, !group.not)}
            >
              {nls.localize('rockit/entitiesOverview/not', 'Not')}
            </Button>
            <Button
              type={group.combinator === 'and' ? 'primary' : 'default'}
              onClick={() => this.setGroupCombinator(group.id, 'and')}
              disabled={!canChooseConjunction}
            >
              {nls.localize('rockit/entitiesOverview/and', 'And')}
            </Button>
            <Button
              type={group.combinator === 'or' ? 'primary' : 'default'}
              onClick={() => this.setGroupCombinator(group.id, 'or')}
              disabled={!canChooseConjunction}
            >
              {nls.localize('rockit/entitiesOverview/or', 'Or')}
            </Button>
          </Button.Group>
          <div className="entities-overview-advanced-group-actions">
            <Button size="small" onClick={() => this.addRule(group.id)}>
              {nls.localize('rockit/entitiesOverview/addRule', '+ Add rule')}
            </Button>
            <Button size="small" onClick={() => this.addGroup(group.id)}>
              {nls.localize('rockit/entitiesOverview/addGroup', '+ Add group')}
            </Button>
            {!isRoot && (
              <button
                type="button"
                className="entities-overview-edit-modal-remove entities-overview-advanced-group-remove"
                title={nls.localize('rockit/entitiesOverview/removeGroup', 'Remove group')}
                aria-label={nls.localize('rockit/entitiesOverview/removeGroup', 'Remove group')}
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

  /**
   * Renders one rule row in the main query tree.
   */
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
        label: nls.localize('rockit/entitiesOverview/hiddenBySchemaSelection', '{0} - {1} (hidden by schema selection)', selectedField.label, selectedField.schemaLabel),
        title: selectedField.help ?? selectedField.label,
      })
    }

    if (rule.operator === 'fields' && selectedField?.expectsObjectValue) {
      return this.renderFieldsRule(rule, selectedField, visibleFields)
    }

    return (
      <div className="entities-overview-edit-modal-row entities-overview-advanced-rule-row">
        <Select
          value={rule.fieldKey}
          onChange={(value) => this.setRuleField(rule.id, String(value))}
          placeholder={nls.localize('rockit/entitiesOverview/selectField', 'Select field')}
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
          options={this.getOperatorOptions(selectedField, false, rule)}
        />
        <div className="entities-overview-edit-modal-value entities-overview-advanced-rule-value">
          {rule.operator === 'fields' && selectedField?.expectsObjectValue ? (
            this.renderFieldsOperatorEditor(rule, selectedField)
          ) : OPERATORS_WITHOUT_VALUE.has(rule.operator) ? (
            <span className="entities-overview-edit-modal-no-value">
              {nls.localize('rockit/entitiesOverview/noValueRequired', 'No value required')}
            </span>
          ) : (
            this.renderRuleValueEditor(rule, selectedField)
          )}
        </div>
        <div className="entities-overview-edit-modal-row-actions entities-overview-advanced-rule-actions">
          <button
            type="button"
            className="entities-overview-edit-modal-remove entities-overview-advanced-rule-remove"
            title={nls.localize('rockit/entitiesOverview/removeRule', 'Remove rule')}
            aria-label={nls.localize('rockit/entitiesOverview/removeRule', 'Remove rule')}
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
    return this.catalog.fields.filter(
      (field) =>
        selected.has(field.schemaId) ||
        (this.draft.schemaOrgEnabled && field.schemaId === SCHEMA_ORG_SCHEMA_ID),
    )
  }

  protected onSchemaSelectionChange(schemaIds: string[]): void {
    this.draft.selectedSchemaIds = [...schemaIds]
    this.update()
  }

  protected onEntityTypeSelectionChange(entityType: string): void {
    this.draft.selectedEntityType = entityType
    this.update()
  }

  protected onSchemaOrgToggle(enabled: boolean): void {
    this.draft.schemaOrgEnabled = enabled
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

  /**
   * Handles property selection in one rule and resets rule-specific state accordingly.
   */
  protected setRuleField(ruleId: string, fieldKey: string): void {
    const rule = this.findRule(this.draft.root, ruleId)
    if (!rule) {
      return
    }
    const selectedField = this.fieldsByKey.get(fieldKey)
    const keepFieldsMode = rule.operator === 'fields' && Boolean(selectedField?.expectsObjectValue)
    rule.fieldKey = fieldKey
    rule.valueKind = selectedField ? this.getDefaultRuleValueKind(selectedField) : undefined
    rule.value = ''
    if (keepFieldsMode) {
      rule.operator = 'fields'
      rule.fieldsMode = 'any'
      rule.fieldsRoot = this.createGroup(true)
    } else {
      rule.operator = 'equal'
      rule.fieldsMode = undefined
      rule.fieldsRoot = undefined
    }

    if (selectedField?.expectsObjectValue && !keepFieldsMode) {
      this.wrapRuleIntoOwnGroup(ruleId)
    }
    this.ruleSearch.delete(ruleId)
    this.update()
  }

  /**
   * Handles operator changes and normalizes value payload for the selected operator type.
   */
  protected setRuleOperator(ruleId: string, operator: AdvancedRuleOperator): void {
    this.updateRule(ruleId, (rule) => {
      const selectedField = rule.fieldKey ? this.fieldsByKey.get(rule.fieldKey) : undefined
      const selectedValueKind = selectedField
        ? this.getEffectiveRuleValueKind(rule, selectedField)
        : undefined
      const allowedOperators = this.getOperatorOptions(selectedField, false, rule).map(
        (item) => item.value,
      )
      if (!allowedOperators.includes(operator)) {
        return
      }
      if (operator === 'fields') {
        if (!selectedField?.expectsObjectValue || selectedValueKind !== 'entity') {
          return
        }
        rule.operator = 'fields'
        rule.value = ''
        rule.fieldsMode = 'any'
        if (!rule.fieldsRoot) {
          rule.fieldsRoot = this.createGroup(true)
        }
        return
      }
      rule.operator = operator
      if (OPERATORS_WITHOUT_VALUE.has(operator)) {
        rule.value = ''
        rule.fieldsMode = undefined
        rule.fieldsRoot = undefined
        return
      }
      rule.fieldsMode = undefined
      rule.fieldsRoot = undefined
      const values = decodeAdvancedRuleValues(rule.value)
      if (this.isRangeOperator(operator)) {
        if (selectedValueKind !== 'date') {
          rule.operator = 'equal'
          rule.value = ''
          return
        }
        if (values.length >= 2) {
          rule.value = encodeAdvancedRuleValues([values[0], values[1]])
        } else {
          rule.value = ''
        }
        return
      }
      if (values.length > 1 && !this.supportsRuleMultiValue(rule, selectedField, operator)) {
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
        Boolean(target.closest('.ant-picker')) ||
        Boolean(target.closest('.ant-picker-dropdown')) ||
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

  protected wrapRuleIntoOwnGroup(ruleId: string): void {
    const parent = this.findParentGroup(this.draft.root, ruleId)
    if (!parent) {
      return
    }
    const index = parent.children.findIndex(
      (child) => child.kind === 'rule' && child.id === ruleId,
    )
    if (index < 0) {
      return
    }
    if (parent !== this.draft.root && parent.children.length === 1) {
      return
    }
    const ruleNode = parent.children[index]
    if (ruleNode.kind !== 'rule') {
      return
    }
    const wrappedGroup = this.createGroup(false)
    wrappedGroup.children.push(ruleNode)
    parent.children.splice(index, 1, wrappedGroup)
  }

  /**
   * Chooses the value editor by field type (object/date/text).
   */
  protected renderRuleValueEditor(
    rule: AdvancedFilterRuleNode,
    field: AdvancedFilterCatalog['fields'][number] | undefined,
  ): React.ReactNode {
    if (!field) {
      return <Input disabled placeholder={nls.localize('rockit/entitiesOverview/selectFieldFirst', 'Select field first')} />
    }

    const valueKind = this.getEffectiveRuleValueKind(rule, field)
    const valueKindSelector = this.renderRuleValueKindSelector(rule, field)

    let editor: React.ReactNode
    if (valueKind === 'entity') {
      editor = this.renderObjectValueEditor(rule, field)
    } else if (valueKind === 'date') {
      editor = this.renderDateValueEditor(rule.value, rule.operator, (value) =>
        this.setRuleValue(rule.id, value),
      )
    } else {
      editor = (
        <Input
          value={rule.value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            this.setRuleValue(rule.id, event.target.value)
          }
          placeholder={valueKind === 'url'
            ? nls.localize('rockit/entitiesOverview/enterUrl', 'Enter URL')
            : nls.localize('rockit/entitiesOverview/enterString', 'Enter string')}
          type={valueKind === 'url' ? 'url' : 'text'}
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
   * Renders existing object-reference selector for object-valued fields.
   */
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
              ? nls.localize('rockit/entitiesOverview/selectExistingObjects', 'Select one or more existing objects')
              : nls.localize('rockit/entitiesOverview/searchExistingObjects', 'Search existing objects')
            : nls.localize('rockit/entitiesOverview/noExistingObjects', 'No existing object values found')
        }
        getPopupContainer={() => document.body}
        classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
        styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
        options={options}
        notFoundContent={
          <span className="entities-overview-entity-no-data">{nls.localize('rockit/entitiesOverview/noMatches', 'No matches')}</span>
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

  protected getFieldValueKinds(
    field: AdvancedFilterCatalog['fields'][number],
  ): AdvancedFieldValueKind[] {
    const configured =
      field.valueKinds && field.valueKinds.length > 0 ? field.valueKinds : [field.valueKind]
    return Array.from(new Set(configured))
  }

  protected getDefaultRuleValueKind(
    field: AdvancedFilterCatalog['fields'][number],
  ): AdvancedFieldValueKind {
    const kinds = this.getFieldValueKinds(field)
    return kinds[0] ?? 'text'
  }

  protected getEffectiveRuleValueKind(
    rule: AdvancedFilterRuleNode,
    field: AdvancedFilterCatalog['fields'][number],
  ): AdvancedFieldValueKind {
    const kinds = this.getFieldValueKinds(field)
    if (rule.operator === 'fields' && kinds.includes('entity')) {
      return 'entity'
    }
    if (rule.valueKind && kinds.includes(rule.valueKind)) {
      return rule.valueKind
    }
    return this.getDefaultRuleValueKind(field)
  }

  protected renderRuleValueKindSelector(
    rule: AdvancedFilterRuleNode,
    field: AdvancedFilterCatalog['fields'][number],
  ): React.ReactNode {
    const kinds = this.getFieldValueKinds(field)
    if (kinds.length <= 1) {
      return undefined
    }
    const currentKind = this.getEffectiveRuleValueKind(rule, field)
    return (
      <div className="entities-overview-edit-modal-value-kind">
        {kinds.map((kind) => {
          const active = kind === currentKind
          return (
            <button
              key={`${rule.id}-${kind}`}
              type="button"
              className={`entities-overview-edit-modal-value-kind-button${active ? ' is-active' : ''}`}
              onClick={() => this.setRuleValueKind(rule.id, kind)}
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

  protected setRuleValueKind(ruleId: string, valueKind: AdvancedFieldValueKind): void {
    this.updateRule(ruleId, (rule) => {
      const selectedField = rule.fieldKey ? this.fieldsByKey.get(rule.fieldKey) : undefined
      if (!selectedField) {
        return
      }
      const availableKinds = this.getFieldValueKinds(selectedField)
      if (!availableKinds.includes(valueKind)) {
        return
      }
      rule.valueKind = valueKind
      rule.value = ''
      const allowedOperators = this.getOperatorOptions(selectedField, false, rule).map(
        (item) => item.value,
      )
      if (!allowedOperators.includes(rule.operator)) {
        rule.operator = 'equal'
        rule.fieldsMode = undefined
        rule.fieldsRoot = undefined
      }
    })
  }

  protected supportsRuleMultiValue(
    rule: AdvancedFilterRuleNode,
    field: AdvancedFilterCatalog['fields'][number] | undefined,
    operator: AdvancedRuleOperator,
  ): boolean {
    if (this.isRangeOperator(operator)) {
      return true
    }
    if (!field) {
      return false
    }
    return (
      this.getEffectiveRuleValueKind(rule, field) === 'entity' &&
      this.supportsMultiObjectSelection(operator)
    )
  }

  protected isRangeOperator(operator: AdvancedRuleOperator): boolean {
    return RANGE_OPERATORS.has(operator)
  }

  /**
   * Renders date editors for scalar date rules (single date and range variants).
   */
  protected renderDateValueEditor(
    rawValue: string,
    operator: AdvancedRuleOperator,
    onValueChange: (value: string) => void,
  ): React.ReactNode {
    if (this.isRangeOperator(operator)) {
      const values = decodeAdvancedRuleValues(rawValue)
      const startParsed = values[0]?.trim() ? dayjs(values[0].trim()) : null
      const endParsed = values[1]?.trim() ? dayjs(values[1].trim()) : null
      const startValue = startParsed?.isValid() ? startParsed : null
      const endValue = endParsed?.isValid() ? endParsed : null
      const rangeValue = startValue || endValue ? [startValue, endValue] : null
      return (
        <DatePicker.RangePicker
          value={rangeValue as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null}
          onChange={(_, dateStrings) => {
            const normalized = (Array.isArray(dateStrings) ? dateStrings : [])
              .map((item) => String(item ?? '').trim())
              .filter((item) => item.length > 0)
            onValueChange(
              normalized.length > 0 ? encodeAdvancedRuleValues(normalized) : '',
            )
          }}
          format="YYYY-MM-DD"
          placeholder={[
            nls.localize('rockit/entitiesOverview/enterDateFrom', 'Enter date from...'),
            nls.localize('rockit/entitiesOverview/enterDateTo', 'Enter date to'),
          ]}
          style={{ width: '100%' }}
          allowClear
          getPopupContainer={() => document.body}
          popupClassName="entities-overview-edit-modal-date-popup"
        />
      )
    }

    const parsed = rawValue.trim().length > 0 ? dayjs(rawValue.trim()) : null
    const pickerValue = parsed && parsed.isValid() ? parsed : null
    return (
      <DatePicker
        value={pickerValue}
        onChange={(_, dateString) =>
          onValueChange(
            Array.isArray(dateString)
              ? String(dateString[0] ?? '')
              : String(dateString ?? ''),
          )
        }
        format="YYYY-MM-DD"
        placeholder={nls.localize('rockit/entitiesOverview/enterDate', 'Enter date')}
        style={{ width: '100%' }}
        allowClear
        getPopupContainer={() => document.body}
        popupClassName="entities-overview-edit-modal-date-popup"
      />
    )
  }

  protected getOperatorOptions(
    field: AdvancedFilterCatalog['fields'][number] | undefined,
    isSubRule: boolean,
    rule?: AdvancedFilterRuleNode,
  ): { value: AdvancedRuleOperator; label: string }[] {
    if (!field) {
      return BASE_OPERATOR_OPTIONS
    }
    const valueKind =
      !isSubRule && rule
        ? this.getEffectiveRuleValueKind(rule, field)
        : this.getFieldValueKinds(field)[0] ?? field.valueKind
    if (valueKind === 'date') {
      return DATE_OPERATOR_OPTIONS
    }
    if (isSubRule) {
      return BASE_OPERATOR_OPTIONS
    }
    return valueKind === 'entity' ? OBJECT_OPERATOR_OPTIONS : BASE_OPERATOR_OPTIONS
  }

  /**
   * Renders object `fields` mode entry point for one main rule.
   */
  protected renderFieldsRule(
    rule: AdvancedFilterRuleNode,
    field: AdvancedFilterCatalog['fields'][number],
    visibleFields: AdvancedFilterCatalog['fields'],
  ): React.ReactNode {
    const fieldsRoot = rule.fieldsRoot ?? this.createGroup(true)
    const propertyOptions = visibleFields
      .map((item) => ({
        value: item.key,
        label: `${item.label} - ${item.schemaLabel}`,
        title: item.help ?? item.label,
      }))

    return (
      <div className="entities-overview-advanced-fields-rule">
        {this.renderFieldsGroup(
          rule.id,
          fieldsRoot,
          true,
          field.objectSubfields,
          propertyOptions,
          rule.fieldKey,
        )}
      </div>
    )
  }

  protected getTransformedFieldsRule(
    group: AdvancedFilterGroupNode,
  ): {
    rule: AdvancedFilterRuleNode
    field: AdvancedFilterCatalog['fields'][number]
    fieldsRoot: AdvancedFilterGroupNode
  } | undefined {
    if (group.children.length !== 1) {
      return undefined
    }
    const onlyChild = group.children[0]
    if (onlyChild.kind !== 'rule' || onlyChild.operator !== 'fields') {
      return undefined
    }
    const field = onlyChild.fieldKey ? this.fieldsByKey.get(onlyChild.fieldKey) : undefined
    if (!field?.expectsObjectValue || !onlyChild.fieldsRoot) {
      return undefined
    }
    return {
      rule: onlyChild,
      field,
      fieldsRoot: onlyChild.fieldsRoot,
    }
  }

  protected renderTransformedFieldsGroup(
    group: AdvancedFilterGroupNode,
    isRoot: boolean,
    transformed: {
      rule: AdvancedFilterRuleNode
      field: AdvancedFilterCatalog['fields'][number]
      fieldsRoot: AdvancedFilterGroupNode
    },
  ): React.ReactNode {
    const { rule, field, fieldsRoot } = transformed
    const visibleFields = this.getVisibleFields()
    const propertyOptions = visibleFields.map((item) => ({
      value: item.key,
      label: `${item.label} - ${item.schemaLabel}`,
      title: item.help ?? item.label,
    }))
    const canChooseConjunction = fieldsRoot.children.length > 1

    return (
      <div className={`entities-overview-advanced-group${isRoot ? ' is-root' : ''}`}>
        <div className="entities-overview-advanced-group-header">
          <div className="entities-overview-advanced-fields-header-left">
            <Button.Group size="small">
              <Button
                type={fieldsRoot.not ? 'primary' : 'default'}
                onClick={() => this.setFieldsGroupNot(rule.id, fieldsRoot.id, !fieldsRoot.not)}
              >
                {nls.localize('rockit/entitiesOverview/not', 'Not')}
              </Button>
              <Button
                type={fieldsRoot.combinator === 'and' ? 'primary' : 'default'}
                onClick={() =>
                  this.setFieldsGroupCombinator(rule.id, fieldsRoot.id, 'and')
                }
                disabled={!canChooseConjunction}
              >
                {nls.localize('rockit/entitiesOverview/and', 'And')}
              </Button>
              <Button
                type={fieldsRoot.combinator === 'or' ? 'primary' : 'default'}
                onClick={() =>
                  this.setFieldsGroupCombinator(rule.id, fieldsRoot.id, 'or')
                }
                disabled={!canChooseConjunction}
              >
                {nls.localize('rockit/entitiesOverview/or', 'Or')}
              </Button>
            </Button.Group>
            <Select
              value={rule.fieldKey}
              onChange={(value) => this.setRuleField(rule.id, String(value))}
              placeholder={nls.localize('rockit/entitiesOverview/selectProperty', 'Select property')}
              getPopupContainer={() => document.body}
              classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
              styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
              className="entities-overview-advanced-fields-property-select"
              showSearch
              optionFilterProp="label"
              options={propertyOptions}
            />
          </div>
          <div className="entities-overview-advanced-group-actions">
            <Button size="small" onClick={() => this.addSubRule(rule.id, fieldsRoot.id)}>
              {nls.localize('rockit/entitiesOverview/addRule', '+ Add rule')}
            </Button>
            <Button size="small" onClick={() => this.addSubGroup(rule.id, fieldsRoot.id)}>
              {nls.localize('rockit/entitiesOverview/addGroup', '+ Add group')}
            </Button>
            {!isRoot && (
              <button
                type="button"
                className="entities-overview-edit-modal-remove entities-overview-advanced-group-remove"
                title={nls.localize('rockit/entitiesOverview/removeGroup', 'Remove group')}
                aria-label={nls.localize('rockit/entitiesOverview/removeGroup', 'Remove group')}
                onClick={() => this.removeNode(group.id)}
              >
                <span className="codicon codicon-trash" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="entities-overview-advanced-group-children">
          {fieldsRoot.children.map((child) =>
            child.kind === 'group' ? (
              <div key={child.id}>
                {this.renderFieldsGroup(
                  rule.id,
                  child,
                  false,
                  field.objectSubfields,
                  undefined,
                  undefined,
                )}
              </div>
            ) : (
              <div key={child.id}>{this.renderSubRule(rule.id, child, field.objectSubfields)}</div>
            ),
          )}
        </div>
      </div>
    )
  }

  protected renderFieldsOperatorEditor(
    rule: AdvancedFilterRuleNode,
    field: AdvancedFilterCatalog['fields'][number],
  ): React.ReactNode {
    const fieldsRoot = rule.fieldsRoot
    if (!fieldsRoot || field.objectSubfields.length === 0) {
      return (
        <span className="entities-overview-edit-modal-no-value">
          {nls.localize('rockit/entitiesOverview/noSubfields', 'No subfields available')}
        </span>
      )
    }
    return (
      <div className="entities-overview-advanced-fields-editor">
        {this.renderFieldsGroup(rule.id, fieldsRoot, true, field.objectSubfields)}
      </div>
    )
  }

  /**
   * Renders nested groups inside object `fields` mode.
   */
  protected renderFieldsGroup(
    parentRuleId: string,
    group: AdvancedFilterGroupNode,
    isRoot: boolean,
    subfields: AdvancedFilterCatalog['fields'],
    rootPropertyOptions?: { value: string; label: string; title?: string }[],
    rootPropertyValue?: string,
  ): React.ReactNode {
    const canChooseConjunction = group.children.length > 1
    return (
      <div className={`entities-overview-advanced-group${isRoot ? ' is-root' : ''}`}>
        <div className="entities-overview-advanced-group-header">
          <div className="entities-overview-advanced-fields-header-left">
            <Button.Group size="small">
              <Button
                type={group.not ? 'primary' : 'default'}
                onClick={() => this.setFieldsGroupNot(parentRuleId, group.id, !group.not)}
              >
                {nls.localize('rockit/entitiesOverview/not', 'Not')}
              </Button>
              <Button
                type={group.combinator === 'and' ? 'primary' : 'default'}
                onClick={() => this.setFieldsGroupCombinator(parentRuleId, group.id, 'and')}
                disabled={!canChooseConjunction}
              >
                {nls.localize('rockit/entitiesOverview/and', 'And')}
              </Button>
              <Button
                type={group.combinator === 'or' ? 'primary' : 'default'}
                onClick={() => this.setFieldsGroupCombinator(parentRuleId, group.id, 'or')}
                disabled={!canChooseConjunction}
              >
                {nls.localize('rockit/entitiesOverview/or', 'Or')}
              </Button>
            </Button.Group>
            {isRoot && rootPropertyOptions && (
              <Select
                value={rootPropertyValue}
                onChange={(value) => this.setRuleField(parentRuleId, String(value))}
                placeholder={nls.localize('rockit/entitiesOverview/selectProperty', 'Select property')}
                getPopupContainer={() => document.body}
                classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
                styles={{ popup: { root: { maxHeight: 260, overflowY: 'auto' } } }}
                className="entities-overview-advanced-fields-property-select"
                showSearch
                optionFilterProp="label"
                options={rootPropertyOptions}
              />
            )}
          </div>
          <div className="entities-overview-advanced-group-actions">
            <Button size="small" onClick={() => this.addSubRule(parentRuleId, group.id)}>
              {nls.localize('rockit/entitiesOverview/addRule', '+ Add rule')}
            </Button>
            <Button size="small" onClick={() => this.addSubGroup(parentRuleId, group.id)}>
              {nls.localize('rockit/entitiesOverview/addGroup', '+ Add group')}
            </Button>
            {!isRoot && (
              <button
                type="button"
                className="entities-overview-edit-modal-remove entities-overview-advanced-group-remove"
                title={nls.localize('rockit/entitiesOverview/removeGroup', 'Remove group')}
                aria-label={nls.localize('rockit/entitiesOverview/removeGroup', 'Remove group')}
                onClick={() => this.removeSubNode(parentRuleId, group.id)}
              >
                <span className="codicon codicon-trash" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="entities-overview-advanced-group-children">
          {group.children.map((child) =>
            child.kind === 'group' ? (
              <div key={child.id}>
                {this.renderFieldsGroup(
                  parentRuleId,
                  child,
                  false,
                  subfields,
                  undefined,
                  undefined,
                )}
              </div>
            ) : (
              <div key={child.id}>{this.renderSubRule(parentRuleId, child, subfields)}</div>
            ),
          )}
        </div>
      </div>
    )
  }

  /**
   * Renders one sub-rule inside object `fields` mode.
   */
  protected renderSubRule(
    parentRuleId: string,
    rule: AdvancedFilterRuleNode,
    subfields: AdvancedFilterCatalog['fields'],
  ): React.ReactNode {
    const selectedField = rule.fieldKey
      ? subfields.find((item) => item.key === rule.fieldKey)
      : undefined
    const fieldOptions = subfields.map((field) => ({
      value: field.key,
      label: field.label,
      title: field.help ?? field.label,
    }))

    return (
      <div className="entities-overview-edit-modal-row entities-overview-advanced-rule-row">
        <Select
          value={rule.fieldKey}
          onChange={(value) =>
            this.setSubRuleField(parentRuleId, rule.id, String(value))
          }
          placeholder={nls.localize('rockit/entitiesOverview/selectField', 'Select field')}
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
            this.setSubRuleOperator(parentRuleId, rule.id, value as AdvancedRuleOperator)
          }
          getPopupContainer={() => document.body}
          classNames={{ popup: { root: 'entities-overview-edit-modal-dropdown' } }}
          style={{ width: 130 }}
          options={this.getOperatorOptions(selectedField, true)}
        />
        <div className="entities-overview-edit-modal-value entities-overview-advanced-rule-value">
          {OPERATORS_WITHOUT_VALUE.has(rule.operator) ? (
            <span className="entities-overview-edit-modal-no-value">
              {nls.localize('rockit/entitiesOverview/noValueRequired', 'No value required')}
            </span>
          ) : selectedField && this.getFieldValueKinds(selectedField).includes('date') ? (
            this.renderDateValueEditor(rule.value, rule.operator, (value) =>
              this.setSubRuleValue(parentRuleId, rule.id, value),
            )
          ) : (
            <Input
              value={rule.value}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                this.setSubRuleValue(parentRuleId, rule.id, event.target.value)
              }
              placeholder={nls.localize('rockit/entitiesOverview/enterString', 'Enter string')}
            />
          )}
        </div>
        <div className="entities-overview-edit-modal-row-actions entities-overview-advanced-rule-actions">
          <button
            type="button"
            className="entities-overview-edit-modal-remove entities-overview-advanced-rule-remove"
            title={nls.localize('rockit/entitiesOverview/removeRule', 'Remove rule')}
            aria-label={nls.localize('rockit/entitiesOverview/removeRule', 'Remove rule')}
            onClick={() => this.removeSubNode(parentRuleId, rule.id)}
          >
            <span className="codicon codicon-trash" aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  protected addSubRule(parentRuleId: string, groupId: string): void {
    this.updateFieldsGroup(parentRuleId, groupId, (group) => {
      group.children.push(this.createRule())
    })
  }

  protected addSubGroup(parentRuleId: string, groupId: string): void {
    this.updateFieldsGroup(parentRuleId, groupId, (group) => {
      group.children.push(this.createGroup(true))
    })
  }

  protected setSubRuleField(
    parentRuleId: string,
    subRuleId: string,
    fieldKey: string,
  ): void {
    this.updateFieldsRule(parentRuleId, subRuleId, (rule) => {
      rule.fieldKey = fieldKey
      rule.value = ''
      rule.operator = 'equal'
    })
  }

  protected setSubRuleOperator(
    parentRuleId: string,
    subRuleId: string,
    operator: AdvancedRuleOperator,
  ): void {
    if (operator === 'fields') {
      return
    }
    this.updateFieldsRule(parentRuleId, subRuleId, (rule) => {
      rule.operator = operator
      if (OPERATORS_WITHOUT_VALUE.has(operator)) {
        rule.value = ''
        return
      }
      const values = decodeAdvancedRuleValues(rule.value)
      if (this.isRangeOperator(operator)) {
        if (values.length >= 2) {
          rule.value = encodeAdvancedRuleValues([values[0], values[1]])
        } else {
          rule.value = ''
        }
        return
      }
      if (values.length > 1) {
        rule.value = values[0] ?? ''
      }
    })
  }

  protected setSubRuleValue(
    parentRuleId: string,
    subRuleId: string,
    value: string,
  ): void {
    this.updateFieldsRule(parentRuleId, subRuleId, (rule) => {
      rule.value = value
    })
  }

  protected setFieldsGroupNot(
    parentRuleId: string,
    groupId: string,
    not: boolean,
  ): void {
    this.updateFieldsGroup(parentRuleId, groupId, (group) => {
      group.not = not
    })
  }

  protected setFieldsGroupCombinator(
    parentRuleId: string,
    groupId: string,
    combinator: AdvancedFilterGroupNode['combinator'],
  ): void {
    this.updateFieldsGroup(parentRuleId, groupId, (group) => {
      group.combinator = combinator
    })
  }

  protected removeSubNode(parentRuleId: string, nodeId: string): void {
    const parentRule = this.findRule(this.draft.root, parentRuleId)
    if (!parentRule?.fieldsRoot) {
      return
    }
    if (parentRule.fieldsRoot.id === nodeId) {
      return
    }
    const removed = this.removeNodeFromGroup(parentRule.fieldsRoot, nodeId)
    if (!removed) {
      return
    }
    if (parentRule.fieldsRoot.children.length === 0) {
      parentRule.fieldsRoot.children.push(this.createRule())
    }
    this.update()
  }

  protected updateFieldsGroup(
    parentRuleId: string,
    groupId: string,
    callback: (group: AdvancedFilterGroupNode) => void,
  ): void {
    const parentRule = this.findRule(this.draft.root, parentRuleId)
    if (!parentRule) {
      return
    }
    if (!parentRule.fieldsRoot) {
      parentRule.fieldsRoot = this.createGroup(true)
    }
    const group = this.findGroup(parentRule.fieldsRoot, groupId)
    if (!group) {
      return
    }
    callback(group)
    this.update()
  }

  protected updateFieldsRule(
    parentRuleId: string,
    subRuleId: string,
    callback: (rule: AdvancedFilterRuleNode) => void,
  ): void {
    const parentRule = this.findRule(this.draft.root, parentRuleId)
    if (!parentRule?.fieldsRoot) {
      return
    }
    const subRule = this.findRule(parentRule.fieldsRoot, subRuleId)
    if (!subRule) {
      return
    }
    callback(subRule)
    this.update()
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
        const rawType = this.getEntityTypeNames(referencedEntity)[0] ?? nls.localize('rockit/entitiesOverview/entity', 'Entity')
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
          <span className="entities-overview-entity-option-type">{nls.localize('rockit/entitiesOverview/object', 'Object')}</span>
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
      return nls.localize('rockit/entitiesOverview/entity', 'Entity')
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

  protected findParentGroup(
    group: AdvancedFilterGroupNode,
    nodeId: string,
  ): AdvancedFilterGroupNode | undefined {
    if (group.children.some((child) => child.id === nodeId)) {
      return group
    }
    for (const child of group.children) {
      if (child.kind !== 'group') {
        continue
      }
      const match = this.findParentGroup(child, nodeId)
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

  /**
   * Clones persisted tree data into a fully normalized in-memory structure.
   */
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
              operator:
                KNOWN_OPERATORS.has(child.operator) ? child.operator : 'equal',
              value: String(child.value ?? ''),
              valueKind:
                child.valueKind === 'entity' ||
                child.valueKind === 'text' ||
                child.valueKind === 'url' ||
                child.valueKind === 'date'
                  ? child.valueKind
                  : undefined,
              fieldsMode: child.fieldsMode === 'any' ? 'any' : 'all',
              fieldsRoot:
                child.operator === 'fields'
                  ? child.fieldsRoot
                    ? this.cloneGroup(child.fieldsRoot)
                    : this.createGroup(true)
                  : undefined,
            },
      ),
    }
  }
}
