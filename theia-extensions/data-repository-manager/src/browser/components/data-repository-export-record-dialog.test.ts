// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import 'reflect-metadata'
import { act } from 'react'
import { fireEvent, getByText } from '@testing-library/react'
import { DataRepositoryExportRecordDialog } from './data-repository-export-record-dialog'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('Export record details dialog', () => {
  it('shows record details as plain text and allows clearing a missing crosswalk', async () => {
    const dialog = new DataRepositoryExportRecordDialog({
      target: 'https://repo.example/dataset/1', repository: 'https://repo.example',
      mappingFile: 'mapping.json', syncType: 'create', crosswalkFile: 'deleted-crosswalk',
      collectionId: 'collection', custom: 'Preserved data',
    }, []) as any
    act(() => dialog.render())
    document.body.appendChild(dialog.contentNode)
    expect(dialog.contentNode.textContent).toContain('Missing crosswalk: deleted-crosswalk')
    expect(dialog.contentNode.querySelectorAll('textarea')).toHaveLength(0)
    const details = dialog.contentNode.querySelector('.export-record__details')
    expect(details.querySelectorAll('dt')).toHaveLength(6)
    expect(details.textContent).toContain('Preserved data')

    await act(async () => {
      fireEvent.mouseDown(dialog.contentNode.querySelector('.ant-select-selector'))
    })
    await act(async () => {
      fireEvent.click(getByText(document.body, 'No crosswalk'))
    })
    expect(dialog.value).toEqual({ crosswalkId: undefined })
    act(() => dialog.reactRoot.unmount())
    dialog.contentNode.remove()
  })
})
