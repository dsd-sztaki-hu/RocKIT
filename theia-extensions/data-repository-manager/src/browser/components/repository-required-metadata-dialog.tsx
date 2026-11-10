// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { AbstractDialog, Message } from '@theia/core/lib/browser'
import { nls } from '@theia/core/lib/common/nls'
import { Input, Select } from 'antd'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
import {
  RepositoryMetadataPromptField,
  RepositoryRequiredMetadataPrompt,
} from '../repository-provider-registry'
import '../styles/native-dataverse-dataset-metadata-dialog.css'

export class RepositoryRequiredMetadataDialog extends AbstractDialog<
  Record<string, string> | undefined
> {
  protected reactRoot: Root | undefined
  protected readonly values: Record<string, string>

  constructor(protected readonly prompt: RepositoryRequiredMetadataPrompt) {
    super({ title: prompt.title })
    this.validatePrompt(prompt)
    this.values = Object.fromEntries(
      prompt.fields.map(field => [field.id, field.defaultValue ?? '']),
    )
    this.contentNode.style.width = '620px'
    this.contentNode.style.maxWidth = '90vw'
    this.contentNode.style.padding = '0'
    this.appendCloseButton()
    this.appendAcceptButton(
      prompt.acceptLabel ?? nls.localize('rockit/dataRepository/continue', 'Continue'),
    )
  }

  get value(): Record<string, string> | undefined {
    if (!this.isValid(undefined)) return undefined
    return Object.fromEntries(
      this.prompt.fields
        .filter(field => this.isFieldVisible(field) && this.values[field.id]?.trim())
        .map(field => [field.id, this.values[field.id].trim()]),
    )
  }

  protected isValid(_value: Record<string, string> | undefined): boolean {
    return this.prompt.fields.every(field =>
      !this.isFieldVisible(field) || !field.required || !!this.values[field.id]?.trim(),
    )
  }

  protected isFieldVisible(field: RepositoryMetadataPromptField): boolean {
    return !field.visibleWhen || field.visibleWhen.values.includes(
      this.values[field.visibleWhen.field],
    )
  }

  protected render(): void {
    if (!this.reactRoot) this.reactRoot = createRoot(this.contentNode)
    this.reactRoot.render(
      <div className='native-dv-metadata'>
        {this.prompt.description ? <p className='native-dv-metadata__description'>
          {this.prompt.description}
        </p> : undefined}
        <div className='native-dv-metadata__form'>
          {this.prompt.fields.filter(field => this.isFieldVisible(field)).map(field =>
            this.renderField(field),
          )}
        </div>
      </div>,
    )
  }

  protected renderField(field: RepositoryMetadataPromptField): React.ReactNode {
    return <React.Fragment key={field.id}>
      <label className='native-dv-metadata__field'>
        <span className='native-dv-metadata__label'>
          {field.label}{field.helpText ? <span
            className='native-dv-metadata__help'
            title={field.helpText}
            aria-label={field.helpText}
            tabIndex={0}
          >?</span> : undefined}{field.required
            ? <span className='native-dv-metadata__required'> *</span>
            : undefined}
        </span>
        {field.type === 'select'
          ? <Select
              className='native-dv-metadata__select'
              value={this.values[field.id] || undefined}
              options={field.options}
              showSearch={field.searchable}
              optionFilterProp='label'
              popupClassName='native-dv-metadata__select-dropdown'
              onInputKeyDown={event => {
                if (field.searchable && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.stopPropagation()
                }
              }}
              onChange={value => this.setValue(field.id, value)}
            />
          : field.type === 'textarea'
            ? <Input.TextArea
                className='native-dv-metadata__textarea'
                value={this.values[field.id]}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  this.setValue(field.id, event.target.value)}
              />
            : <Input
                className='native-dv-metadata__input'
                type={field.type}
                value={this.values[field.id]}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  this.setValue(field.id, event.target.value)}
              />}
      </label>
      {field.description ? <p className='native-dv-metadata__description'>
        {field.description}
      </p> : undefined}
    </React.Fragment>
  }

  protected setValue(field: string, value: string): void {
    this.values[field] = value
    this.render()
    this.update()
  }

  protected validatePrompt(prompt: RepositoryRequiredMetadataPrompt): void {
    if (!prompt.title?.trim() || !Array.isArray(prompt.fields) || !prompt.fields.length) {
      throw new Error('The repository metadata form descriptor is invalid.')
    }
    const ids = new Set<string>()
    for (const field of prompt.fields) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(field.id) || ids.has(field.id) ||
          !field.label?.trim() || !['text', 'date', 'textarea', 'select'].includes(field.type) ||
          (field.defaultValue !== undefined && typeof field.defaultValue !== 'string') ||
          (field.helpText !== undefined && typeof field.helpText !== 'string') ||
          (field.type === 'select' && (!Array.isArray(field.options) ||
            !field.options.every(option => typeof option?.value === 'string' &&
              typeof option?.label === 'string'))) ||
          (field.visibleWhen !== undefined &&
            (!Array.isArray(field.visibleWhen.values) ||
              !field.visibleWhen.values.every(value => typeof value === 'string')))) {
        throw new Error(`Invalid repository metadata field '${String(field.id)}'.`)
      }
      ids.add(field.id)
    }
    if (prompt.fields.some(field => field.visibleWhen && !ids.has(field.visibleWhen.field))) {
      throw new Error('A repository metadata field references an unknown visibility field.')
    }
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.render()
  }

  protected onBeforeDetach(msg: Message): void {
    this.reactRoot?.unmount()
    this.reactRoot = undefined
    super.onBeforeDetach(msg)
  }
}
