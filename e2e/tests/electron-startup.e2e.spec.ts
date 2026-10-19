// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  unexpectedMainProcessErrors,
  unexpectedRendererErrors,
} from '../support/diagnostics'
import { expect, test } from '../support/electron-app'

test.describe('Electron startup', () => {
  test('opens the fixture RO-Crate in the RocKIT shell', async ({
    appPage,
    electronApp,
    electronDiagnostics,
    rockit,
    testWorkspace,
  }) => {
    await rockit.shell.waitForReady()
    await rockit.fileExplorer.waitForVisible()
    await rockit.editor.waitForVisible()

    await expect(rockit.shell.root).toBeVisible()
    await expect(rockit.shell.mainContent).toBeVisible()
    await expect(rockit.shell.statusBar).toBeVisible()
    await expect(rockit.shell.tab('Metadata: ./')).toBeVisible()

    await expect(rockit.fileExplorer.fileNode('data.txt')).toBeVisible()
    await expect(rockit.fileExplorer.fileNode('ro-crate-metadata.json')).toBeVisible()

    await expect(rockit.editor.property('@id')).toContainText('./')
    await expect(rockit.editor.property('@type')).toContainText('Dataset')
    await expect(rockit.editor.propertyInput('name')).toHaveValue('RocKIT E2E Fixture')

    expect(decodeURI(appPage.url())).toContain(testWorkspace.path)
    expect(electronApp.process().exitCode).toBeNull()

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
