// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { readFile } from 'node:fs/promises'
import {
  unexpectedMainProcessErrors,
  unexpectedRendererErrors,
} from '../support/diagnostics'
import { expect, test } from '../support/electron-app'

const rootName = 'RocKIT E2E Fixture'
const fileName = 'Fixture data'
const bulkDescription = 'Description applied through Electron Multi Edit'

const readDescriptions = async (
  metadataPath: string,
): Promise<Record<string, unknown>> => {
  const crate = JSON.parse(await readFile(metadataPath, 'utf8')) as {
    '@graph'?: Array<Record<string, unknown>>
  }
  return Object.fromEntries(
    (crate['@graph'] ?? []).map((entity) => [String(entity['@id']), entity.description]),
  )
}

test.describe('Electron Multi Edit', () => {
  test('bulk-edits two entities as one undoable and persistent change', async ({
    electronDiagnostics,
    electronRuntime,
    rockit,
    testWorkspace,
  }) => {
    await rockit.shell.waitForReady()
    await rockit.editor.waitForVisible()

    await rockit.structure.selectEntities([rootName, fileName])
    await rockit.structure.openMultiEditFromSelection(fileName)
    await rockit.multiEdit.waitForSelectedEntities(2)
    await rockit.multiEdit.enableOtherOntologies()
    await rockit.multiEdit.setTextProperty('Description - schema.org', bulkDescription)
    await rockit.multiEdit.start()

    await expect(rockit.multiEdit.summary).toContainText(
      'Multi-edit finished successfully.',
    )
    await expect(rockit.multiEdit.summary).toContainText(/Processed entities\s*:\s*2/)
    await expect(rockit.multiEdit.summary).toContainText(/Updated entities\s*:\s*2/)
    await expect(rockit.multiEdit.summary).toContainText(/Applied operations\s*:\s*2/)
    await rockit.multiEdit.close()

    await rockit.structure.openEntity(rootName)
    await expect(rockit.editor.propertyInput('description')).toHaveValue(bulkDescription)
    await rockit.structure.openEntity(fileName)
    await expect(rockit.editor.propertyInput('description')).toHaveValue(bulkDescription)

    await rockit.editor.undo()
    await expect(rockit.editor.propertyInput('description')).toBeHidden()
    await rockit.structure.openEntity(rootName)
    await expect(rockit.editor.propertyInput('description')).toBeHidden()

    await rockit.editor.redo()
    await expect(rockit.editor.propertyInput('description')).toHaveValue(bulkDescription)
    await rockit.structure.openEntity(fileName)
    await expect(rockit.editor.propertyInput('description')).toHaveValue(bulkDescription)

    await rockit.editor.save()
    await expect
      .poll(() => readDescriptions(testWorkspace.metadataPath))
      .toMatchObject({
        './': bulkDescription,
        'data.txt': bulkDescription,
      })

    const relaunched = await electronRuntime.restartWithFreshState()
    await relaunched.shell.waitForReady()
    await relaunched.editor.waitForVisible()
    await expect(relaunched.editor.propertyInput('description')).toHaveValue(
      bulkDescription,
    )
    await relaunched.structure.openEntity(fileName)
    await expect(relaunched.editor.propertyInput('description')).toHaveValue(
      bulkDescription,
    )

    expect(await readDescriptions(testWorkspace.metadataPath)).toMatchObject({
      './': bulkDescription,
      'data.txt': bulkDescription,
    })
    expect(
      unexpectedMainProcessErrors(electronDiagnostics),
      'unexpected Electron main-process errors',
    ).toEqual([])
    expect(
      unexpectedRendererErrors(electronDiagnostics),
      'unexpected Electron renderer errors',
    ).toEqual([])
  })
})
