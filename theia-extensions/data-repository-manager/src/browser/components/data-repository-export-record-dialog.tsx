// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { AbstractDialog, Message } from '@theia/core/lib/browser'
import { nls } from '@theia/core/lib/common/nls'
import { Select } from 'antd'
import type { CrosswalkRegistryEntry } from 'crosswalk-manager/lib/browser/crosswalk-manager-types'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { ExportLogEntry } from '../services/export-log'
import '../styles/native-dataverse-dataset-metadata-dialog.css'
import '../styles/data-repository-export-record-dialog.css'

export class DataRepositoryExportRecordDialog extends AbstractDialog<{ crosswalkId?: string }> {
  private reactRoot: Root | undefined
  private crosswalkId: string

  constructor(
    private readonly entry: ExportLogEntry,
    private readonly crosswalks: CrosswalkRegistryEntry[],
  ) {
    super({ title: nls.localize('rockit/dataRepository/exportDetails', 'Export details') })
    this.crosswalkId = entry.crosswalkFile ?? ''
    this.contentNode.style.width = '540px'
    this.contentNode.style.maxWidth = '90vw'
    this.contentNode.style.maxHeight = '75vh'
    this.contentNode.style.overflowY = 'auto'
    this.contentNode.style.padding = '0'
    this.appendCloseButton(nls.localize('rockit/common/cancel', 'Cancel'))
    this.appendAcceptButton(nls.localize('rockit/dataRepository/save', 'Save'))
  }

  get value(): { crosswalkId?: string } {
    return { crosswalkId: this.crosswalkId || undefined }
  }

  protected render(): void {
    if (!this.reactRoot) this.reactRoot = createRoot(this.contentNode)
    const options = [
      { value: '', label: nls.localize('rockit/dataRepository/noCrosswalk', 'No crosswalk') },
      ...this.crosswalks.map(crosswalk => ({ value: crosswalk.id, label: crosswalk.name })),
    ]
    if (this.entry.crosswalkFile && !this.crosswalks.some(item => item.id === this.entry.crosswalkFile)) {
      options.push({
        value: this.entry.crosswalkFile,
        label: nls.localize('rockit/dataRepository/missingCrosswalk', 'Missing crosswalk: {0}', this.entry.crosswalkFile),
      })
    }
    this.reactRoot.render(
      <div className="native-dv-metadata export-record">
        <div className="native-dv-metadata__form">
          <label className="native-dv-metadata__field">
            <span className="native-dv-metadata__label">
              {nls.localize('rockit/dataRepository/crosswalk', 'Metadata Crosswalk')}
            </span>
            <Select
              className="native-dv-metadata__select"
              value={this.crosswalkId}
              options={options}
              showSearch
              optionFilterProp="label"
              classNames={{ popup: { root: 'native-dv-metadata__select-dropdown' } }}
              onChange={value => {
                this.crosswalkId = value
                this.render()
              }}
            />
          </label>
          <dl className="export-record__details">
            {Object.entries(this.entry).filter(([key]) => key !== 'crosswalkFile').map(([key, value]) =>
              <React.Fragment key={key}>
                <dt>{this.fieldLabel(key)}</dt>
                <dd>{(typeof value === 'string' ? value : JSON.stringify(value, null, 2)) || '—'}</dd>
              </React.Fragment>,
            )}
          </dl>
        </div>
      </div>,
    )
  }

  protected fieldLabel(key: string): string {
    const labels: Record<string, string> = {
      target: nls.localize('rockit/dataRepository/exportTarget', 'Target'),
      repository: nls.localize('rockit/dataRepository/exportRepository', 'Repository'),
      mappingFile: nls.localize('rockit/dataRepository/exportMappingFile', 'Mapping file'),
      datasetName: nls.localize('rockit/dataRepository/exportDatasetName', 'Dataset name'),
      collectionId: nls.localize('rockit/dataRepository/exportCollectionId', 'Collection ID'),
      status: nls.localize('rockit/dataRepository/exportStatus', 'Status'),
      errorMessage: nls.localize('rockit/dataRepository/exportErrorMessage', 'Error message'),
      syncType: nls.localize('rockit/dataRepository/exportLastAction', 'Last action'),
      lastSuccessfulActionAt: nls.localize('rockit/dataRepository/exportLastSuccess', 'Last successful action'),
      log: nls.localize('rockit/dataRepository/exportHistory', 'History'),
    }
    return labels[key] ?? key
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
