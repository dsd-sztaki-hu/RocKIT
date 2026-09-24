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
  ZenodoMetadataOption,
  zenodoMetadataOptions,
} from '../services/zenodo-metadata-crosswalk'
import '../styles/native-dataverse-dataset-metadata-dialog.css'

export interface ZenodoRequiredMetadata {
  access_right: string
  license?: string
  embargo_date?: string
  access_conditions?: string
}

const ACCESS_RIGHTS: ZenodoMetadataOption[] = [
  { value: 'open', label: '' },
  { value: 'embargoed', label: '' },
  { value: 'restricted', label: '' },
  { value: 'closed', label: '' },
]

export class ZenodoRequiredMetadataDialog extends AbstractDialog<
  ZenodoRequiredMetadata | undefined
> {
  private reactRoot: Root | undefined
  private accessRight: string
  private license: string
  private embargoDate: string
  private accessConditions: string

  constructor(
    defaults: Record<string, unknown>,
    licenseOptions: ZenodoMetadataOption[] = zenodoMetadataOptions('license'),
  ) {
    super({
      title: nls.localize(
        'rockit/dataRepository/zenodoRequiredMetadata',
        'Required Zenodo Metadata',
      ),
    })
    this.accessRight =
      typeof defaults.access_right === 'string' ? defaults.access_right : 'open'
    const repositoryDefaultLicense =
      defaults.upload_type === 'dataset' ? 'cc-zero' : 'cc-by'
    this.license =
      typeof defaults.license === 'string'
        ? defaults.license
        : repositoryDefaultLicense
    this.embargoDate =
      typeof defaults.embargo_date === 'string' ? defaults.embargo_date : ''
    this.accessConditions =
      typeof defaults.access_conditions === 'string'
        ? defaults.access_conditions
        : ''
    this.licenseOptions = this.withSelectedLicenseOption(
      licenseOptions,
      this.license,
    )

    this.contentNode.style.width = '620px'
    this.contentNode.style.maxWidth = '90vw'
    this.contentNode.style.padding = '0'
    this.appendCloseButton()
    this.appendAcceptButton(nls.localize('rockit/dataRepository/export', 'Export'))
  }

  private readonly licenseOptions: ZenodoMetadataOption[]

  private withSelectedLicenseOption(
    options: ZenodoMetadataOption[],
    selectedLicense: string,
  ): ZenodoMetadataOption[] {
    return options.some((option) => option.value === selectedLicense)
      ? options
      : [
          {
            value: selectedLicense,
            label: nls.localize(
              'rockit/dataRepository/zenodoRepositoryDefaultLicense',
              '{0} (Zenodo default)',
              selectedLicense,
            ),
          },
          ...options,
        ]
  }

  get value(): ZenodoRequiredMetadata | undefined {
    if (!this.isValid(undefined)) {
      return undefined
    }
    return {
      access_right: this.accessRight,
      ...(['open', 'embargoed'].includes(this.accessRight)
        ? { license: this.license }
        : {}),
      ...(this.accessRight === 'embargoed'
        ? { embargo_date: this.embargoDate }
        : {}),
      ...(this.accessRight === 'restricted'
        ? { access_conditions: this.accessConditions.trim() }
        : {}),
    }
  }

  protected isValid(_value: ZenodoRequiredMetadata | undefined): boolean {
    return (
      !!this.accessRight &&
      (!['open', 'embargoed'].includes(this.accessRight) || !!this.license) &&
      (this.accessRight !== 'embargoed' || !!this.embargoDate) &&
      (this.accessRight !== 'restricted' || !!this.accessConditions.trim())
    )
  }

  protected render(): void {
    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.contentNode)
    }
    const accessOptions = ACCESS_RIGHTS.map(({ value }) => ({
      value,
      label: value,
    }))
    this.reactRoot.render(
      <div className="native-dv-metadata">
        <p className="native-dv-metadata__description">
          {nls.localize(
            'rockit/dataRepository/zenodoRequiredMetadataDescription',
            'Complete the repository-required values that could not be mapped from the RO-Crate.',
          )}
        </p>
        <div className="native-dv-metadata__form">
          {this.renderSelect(
            nls.localize('rockit/dataRepository/zenodoAccessRight', 'Access right'),
            this.accessRight,
            accessOptions,
            (value) => {
              this.accessRight = value
            },
          )}
          {['open', 'embargoed'].includes(this.accessRight) ? (
            <>
              {this.renderSelect(
                nls.localize('rockit/dataRepository/zenodoLicense', 'License'),
                this.license,
                this.licenseOptions,
                (value) => {
                  this.license = value
                },
                true,
              )}
              <p className="native-dv-metadata__description">
                {nls.localize(
                  'rockit/dataRepository/zenodoLicenseDescription',
                  'The selected license applies to all files in this deposition. Zenodo licenses the metadata separately under Creative Commons Zero.',
                )}
              </p>
            </>
          ) : undefined}
          {this.accessRight === 'embargoed'
            ? this.renderInput(
                nls.localize('rockit/dataRepository/zenodoEmbargoDate', 'Embargo end date'),
                this.embargoDate,
                'date',
                (value) => {
                  this.embargoDate = value
                },
              )
            : undefined}
          {this.accessRight === 'restricted' ? (
            <label className="native-dv-metadata__field">
              <span className="native-dv-metadata__label">
                {nls.localize(
                  'rockit/dataRepository/zenodoAccessConditions',
                  'Access conditions',
                )}{' '}
                <span className="native-dv-metadata__required">*</span>
              </span>
              <Input.TextArea
                className="native-dv-metadata__textarea"
                value={this.accessConditions}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                  this.accessConditions = event.target.value
                  this.refresh()
                }}
              />
            </label>
          ) : undefined}
        </div>
      </div>,
    )
  }

  private renderSelect(
    label: string,
    value: string,
    options: ZenodoMetadataOption[],
    setValue: (value: string) => void,
    searchable = false,
  ): React.ReactNode {
    return (
      <label className="native-dv-metadata__field">
        <span className="native-dv-metadata__label">
          {label} <span className="native-dv-metadata__required">*</span>
        </span>
        <Select
          className="native-dv-metadata__select"
          value={value || undefined}
          options={options}
          showSearch={searchable}
          optionFilterProp="label"
          popupClassName="native-dv-metadata__select-dropdown"
          onInputKeyDown={(event) => {
            if (
              searchable &&
              ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
            ) {
              event.stopPropagation()
            }
          }}
          onChange={(next) => {
            setValue(next)
            this.refresh()
          }}
        />
      </label>
    )
  }

  private renderInput(
    label: string,
    value: string,
    type: string,
    setValue: (value: string) => void,
  ): React.ReactNode {
    return (
      <label className="native-dv-metadata__field">
        <span className="native-dv-metadata__label">
          {label} <span className="native-dv-metadata__required">*</span>
        </span>
        <Input
          className="native-dv-metadata__input"
          type={type}
          value={value}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setValue(event.target.value)
            this.refresh()
          }}
        />
      </label>
    )
  }

  private refresh(): void {
    this.render()
    this.update()
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
