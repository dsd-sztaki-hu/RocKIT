// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { AbstractDialog, Message } from '@theia/core/lib/browser'
import { Input, Select } from 'antd'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { nls } from '@theia/core/lib/common/nls'

import { NativeDataverseDatasetMetadata } from '../services/native-dataverse-export-service'
import '../styles/native-dataverse-dataset-metadata-dialog.css'

const DATAVERSE_SUBJECTS = [
  'Other',
  'Social Sciences',
  'Physics',
  'Medicine, Health and Life Sciences',
  'Mathematical Sciences',
  'Law',
  'Engineering',
  'Earth and Environmental Sciences',
  'Computer and Information Science',
  'Chemistry',
  'Business and Management',
  'Astronomy and Astrophysics',
  'Arts and Humanities',
  'Agricultural Sciences',
]

const DATAVERSE_SUBJECT_LABELS: Record<string, () => string> = {
  'Other': () => nls.localize('rockit/dataRepository/subjectOther', 'Other'),
  'Social Sciences': () => nls.localize('rockit/dataRepository/subjectSocialSciences', 'Social Sciences'),
  'Physics': () => nls.localize('rockit/dataRepository/subjectPhysics', 'Physics'),
  'Medicine, Health and Life Sciences': () => nls.localize('rockit/dataRepository/subjectMedicine', 'Medicine, Health and Life Sciences'),
  'Mathematical Sciences': () => nls.localize('rockit/dataRepository/subjectMathematics', 'Mathematical Sciences'),
  'Law': () => nls.localize('rockit/dataRepository/subjectLaw', 'Law'),
  'Engineering': () => nls.localize('rockit/dataRepository/subjectEngineering', 'Engineering'),
  'Earth and Environmental Sciences': () => nls.localize('rockit/dataRepository/subjectEarth', 'Earth and Environmental Sciences'),
  'Computer and Information Science': () => nls.localize('rockit/dataRepository/subjectComputerScience', 'Computer and Information Science'),
  'Chemistry': () => nls.localize('rockit/dataRepository/subjectChemistry', 'Chemistry'),
  'Business and Management': () => nls.localize('rockit/dataRepository/subjectBusiness', 'Business and Management'),
  'Astronomy and Astrophysics': () => nls.localize('rockit/dataRepository/subjectAstronomy', 'Astronomy and Astrophysics'),
  'Arts and Humanities': () => nls.localize('rockit/dataRepository/subjectArts', 'Arts and Humanities'),
  'Agricultural Sciences': () => nls.localize('rockit/dataRepository/subjectAgriculture', 'Agricultural Sciences'),
}

export class NativeDataverseDatasetMetadataDialog extends AbstractDialog<
  NativeDataverseDatasetMetadata | undefined
> {
  private reactRoot: Root | undefined
  private titleValue: string
  private authorNamesValue: string
  private contactEmailsValue: string
  private descriptionsValue: string
  private subjectValue: string
  private metadataLanguageValue: string
  private metadataLanguageOptions: Array<{ value: string; label: string }>
  private requiredCitationFields: Set<string>
  private subjectOptions: string[]

  constructor(
    defaults: NativeDataverseDatasetMetadata,
    options: {
      title?: string
      metadataLanguageOptions?: Array<{ value: string; label: string }>
      defaultMetadataLanguage?: string
      requiredCitationFields?: Set<string>
      subjectOptions?: string[]
    } = {},
  ) {
    super({
      title:
        options.title ??
        nls.localize(
          'rockit/dataRepository/requiredMetadata',
          'Required Dataverse Dataset Metadata',
        ),
    })

    this.titleValue = defaults.title
    this.authorNamesValue = defaults.authorNames.join('\n')
    this.contactEmailsValue = defaults.contactEmails.join('\n')
    this.descriptionsValue = defaults.descriptions.join('\n')
    this.requiredCitationFields = options.requiredCitationFields ?? new Set([
      'title',
      'author',
      'datasetContact',
      'dsDescription',
      'subject',
    ])
    this.subjectOptions = options.subjectOptions?.length
      ? options.subjectOptions
      : DATAVERSE_SUBJECTS
    this.subjectValue =
      defaults.subjects.find((subject) => this.subjectOptions.includes(subject)) ?? ''
    this.metadataLanguageOptions = options.metadataLanguageOptions ?? []
    this.metadataLanguageValue =
      options.defaultMetadataLanguage ??
      defaults.metadataLanguage ??
      this.metadataLanguageOptions[0]?.value ??
      ''

    this.contentNode.style.width = '620px'
    this.contentNode.style.maxWidth = '90vw'
    this.contentNode.style.maxHeight = '75vh'
    this.contentNode.style.padding = '0'

    this.appendCloseButton()
    this.appendAcceptButton(nls.localize('rockit/dataRepository/export', 'Export'))
  }

  get value(): NativeDataverseDatasetMetadata | undefined {
    return this.isValid(undefined)
      ? {
          title: this.titleValue.trim(),
          authorNames: this.lines(this.authorNamesValue),
          contactEmails: this.lines(this.contactEmailsValue),
          descriptions: this.lines(this.descriptionsValue),
          subjects: this.subjectValue ? [this.subjectValue] : [],
          ...(this.metadataLanguageOptions.length
            ? { metadataLanguage: this.metadataLanguageValue }
            : {}),
        }
      : undefined
  }

  protected isValid(_value: NativeDataverseDatasetMetadata | undefined): boolean {
    return (
      (!this.requiredCitationFields.has('title') || !!this.titleValue.trim()) &&
      (!this.requiredCitationFields.has('author') || this.lines(this.authorNamesValue).length > 0) &&
      (!this.requiredCitationFields.has('datasetContact') || this.lines(this.contactEmailsValue).length > 0) &&
      (!this.requiredCitationFields.has('dsDescription') || this.lines(this.descriptionsValue).length > 0) &&
      (!this.requiredCitationFields.has('subject') || !!this.subjectValue) &&
      (!this.metadataLanguageOptions.length || !!this.metadataLanguageValue)
    )
  }

  protected render(): void {
    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.contentNode)
    }

    this.reactRoot.render(
      <div className="native-dv-metadata">
        <p className="native-dv-metadata__description">
          {nls.localize('rockit/dataRepository/requiredMetadataDescription', 'Dataverse requires these citation metadata fields when creating a new dataset. Matching values found in the RO-Crate metadata are used as defaults.')}
        </p>
        <div className="native-dv-metadata__form">
          {this.requiredCitationFields.has('title') ? this.renderInput(
            nls.localize('rockit/dataRepository/metadataTitle', 'Title'),
            this.titleValue,
            (value) => {
              this.titleValue = value
            },
            true,
          ) : undefined}
          {this.requiredCitationFields.has('author') ? this.renderTextarea(nls.localize('rockit/dataRepository/authorName', 'Author Name'), this.authorNamesValue, (value) => {
            this.authorNamesValue = value
          }) : undefined}
          {this.requiredCitationFields.has('datasetContact') ? this.renderTextarea(
            nls.localize('rockit/dataRepository/contactEmail', 'Point of Contact Email'),
            this.contactEmailsValue,
            (value) => {
              this.contactEmailsValue = value
            },
          ) : undefined}
          {this.requiredCitationFields.has('dsDescription') ? this.renderTextarea(nls.localize('rockit/dataRepository/descriptionText', 'Description Text'), this.descriptionsValue, (value) => {
            this.descriptionsValue = value
          }) : undefined}
          {this.requiredCitationFields.has('subject') ? <label className="native-dv-metadata__field">
            <span className="native-dv-metadata__label">
              {nls.localize('rockit/dataRepository/subject', 'Subject')} <span className="native-dv-metadata__required">*</span>
            </span>
            <Select
              className="native-dv-metadata__select"
              value={this.subjectValue || undefined}
              placeholder={nls.localize('rockit/dataRepository/selectSubject', 'Select a subject')}
              options={this.subjectOptions.map((subject) => ({
                value: subject,
                label: DATAVERSE_SUBJECT_LABELS[subject]?.() ?? subject,
              }))}
              popupClassName="native-dv-metadata__select-dropdown"
              onChange={(value) => {
                this.subjectValue = value
                this.refresh()
              }}
            />
          </label> : undefined}
          {this.metadataLanguageOptions.length ? (
            <label className="native-dv-metadata__field">
              <span className="native-dv-metadata__label">
                {nls.localize(
                  'rockit/dataRepository/metadataLanguage',
                  'Dataset Metadata Language',
                )}{' '}
                <span className="native-dv-metadata__required">*</span>
              </span>
              <Select
                className="native-dv-metadata__select"
                value={this.metadataLanguageValue || undefined}
                placeholder={nls.localize(
                  'rockit/dataRepository/selectLanguage',
                  'Select a language',
                )}
                options={this.metadataLanguageOptions}
                popupClassName="native-dv-metadata__select-dropdown"
                onChange={(value) => {
                  this.metadataLanguageValue = value
                  this.refresh()
                }}
              />
            </label>
          ) : undefined}
        </div>
      </div>,
    )
  }

  protected renderInput(
    label: string,
    value: string,
    setValue: (value: string) => void,
    autoFocus = false,
  ): React.ReactNode {
    return (
      <label className="native-dv-metadata__field">
        <span className="native-dv-metadata__label">
          {label} <span className="native-dv-metadata__required">*</span>
        </span>
        <Input
          className="native-dv-metadata__input"
          value={value}
          autoFocus={autoFocus}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setValue(event.target.value)
            this.refresh()
          }}
        />
      </label>
    )
  }

  protected renderTextarea(
    label: string,
    value: string,
    setValue: (value: string) => void,
  ): React.ReactNode {
    return (
      <label className="native-dv-metadata__field">
        <span className="native-dv-metadata__label">
          {label} <span className="native-dv-metadata__required">*</span>
        </span>
        <Input.TextArea
          className="native-dv-metadata__textarea"
          value={value}
          placeholder={nls.localize('rockit/dataRepository/onePerLine', 'One value per line')}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setValue(event.target.value)
            this.refresh()
          }}
        />
      </label>
    )
  }

  protected lines(value: string): string[] {
    return Array.from(
      new Set(
        value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => !!line),
      ),
    )
  }

  protected refresh(): void {
    this.render()
    this.update()
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.render()
  }

  protected onBeforeDetach(msg: Message): void {
    if (this.reactRoot) {
      this.reactRoot.unmount()
      this.reactRoot = undefined
    }
    super.onBeforeDetach(msg)
  }
}
