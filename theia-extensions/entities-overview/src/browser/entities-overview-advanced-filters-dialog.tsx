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

  protected draft: AdvancedFilterState
  protected idCounter = 0

  constructor(
    protected readonly catalog: AdvancedFilterCatalog,
    initialState?: AdvancedFilterState,
    protected readonly entityTypeOptions: string[] = [],
  ) {
    super({ title: 'Advanced filters' })
    this.fieldsByKey = new Map(
      this.catalog.fields.map((field) => [field.key, field] as const),
    )
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
            <Input
              value={rule.value}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                this.setRuleValue(rule.id, event.target.value)
              }
              placeholder="Enter string"
            />
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
  }

  protected setRuleOperator(ruleId: string, operator: AdvancedRuleOperator): void {
    this.updateRule(ruleId, (rule) => {
      rule.operator = operator
      if (OPERATORS_WITHOUT_VALUE.has(operator)) {
        rule.value = ''
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
    this.update()
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
