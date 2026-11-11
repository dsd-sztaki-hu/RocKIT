// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { NativeDataverseDatasetMetadataDialog } from './native-dataverse-dataset-metadata-dialog'

jest.mock('@theia/core/lib/browser', () => ({
  AbstractDialog: class {
    contentNode = document.createElement('div')
    appendCloseButton(): void {}
    appendAcceptButton(): void {}
  },
}))

class TestDialog extends NativeDataverseDatasetMetadataDialog {
  selectCrosswalk(id: string): Promise<void> {
    return this.changeCrosswalk(id)
  }

  protected override refresh(): void {}
}

it('refreshes Dataverse defaults when the selected crosswalk changes', async () => {
  const empty = { title: '', authorNames: [], contactEmails: [], descriptions: [], subjects: [] }
  const defaults = {
    title: 'Schema.org dataset',
    authorNames: ['Ada Lovelace'],
    contactEmails: ['contact@example.org'],
    descriptions: ['Schema.org description'],
    subjects: ['Other'],
  }
  const loadDefaults = jest.fn(async (id: string | null) =>
    id === 'schema-org-dataverse' ? defaults : empty)
  const dialog = new TestDialog(empty, { defaultCrosswalkId: 'arp-dataverse', loadDefaults })

  const pending = dialog.selectCrosswalk('schema-org-dataverse')
  expect(dialog.value).toBeUndefined()
  await pending
  expect(dialog.value).toEqual({ crosswalkId: 'schema-org-dataverse', metadata: defaults })

  await dialog.selectCrosswalk('')
  expect(loadDefaults).toHaveBeenLastCalledWith(null)
  expect(dialog.value).toBeUndefined()
})
