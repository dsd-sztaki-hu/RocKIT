// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { readFile, realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'

import JSZip = require('jszip')

import {
  unexpectedMainProcessErrors,
  unexpectedRendererErrors,
} from '../support/diagnostics'
import { expect, test } from '../support/electron-app'

const packageFileName = 'e2e-normal-package.zip'

test.use({ electronSaveDialogFileName: packageFileName })

test.describe('Electron package and native command boundaries', () => {
  test('creates a normal ZIP through the native save-dialog boundary', async ({
    electronDiagnostics,
    electronRuntime,
    rockit,
    testWorkspace,
  }) => {
    await rockit.shell.waitForReady()
    await rockit.editor.waitForVisible()

    const outputPath = path.join(electronRuntime.paths.home, packageFileName)
    await rockit.packageRoCrate.createNormalPackage()

    await expect
      .poll(
        async () =>
          stat(outputPath)
            .then((entry) => entry.isFile())
            .catch(() => false),
        {
          message: 'the normal RO-Crate package to be written to the mocked save path',
        },
      )
      .toBe(true)

    const archive = await JSZip.loadAsync(await readFile(outputPath))
    const archiveFiles = Object.values(archive.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
    expect(archiveFiles).toEqual(
      expect.arrayContaining(['data.txt', 'ro-crate-metadata.json']),
    )
    expect(archiveFiles.some((entry) => entry.startsWith('.rockit/'))).toBe(false)
    expect(await archive.file('data.txt')?.async('string')).toBe(
      await readFile(path.join(testWorkspace.path, 'data.txt'), 'utf8'),
    )
    expect(await archive.file('ro-crate-metadata.json')?.async('string')).toBe(
      await readFile(testWorkspace.metadataPath, 'utf8'),
    )

    const interactions = await electronRuntime.readMainProcessInteractions()
    expect(interactions.saveDialogs).toEqual([
      expect.objectContaining({
        defaultPath: expect.stringMatching(/workspace\.zip$/),
        title: 'Save Normal Package',
      }),
    ])
    expect(interactions.openExternal).toEqual([])
    expect(interactions.showItemInFolder).toEqual([])

    expect(
      unexpectedMainProcessErrors(electronDiagnostics),
      'unexpected Electron main-process errors',
    ).toEqual([])
    expect(
      unexpectedRendererErrors(electronDiagnostics),
      'unexpected Electron renderer errors',
    ).toEqual([])
  })

  test('routes Electron-only file commands through mocked OS shell calls', async ({
    electronDiagnostics,
    electronRuntime,
    rockit,
    testWorkspace,
  }) => {
    await rockit.shell.waitForReady()
    await rockit.fileExplorer.waitForVisible()
    await rockit.fileExplorer.selectFile('data.txt')

    await rockit.shell.page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Alt+P' : 'Control+Alt+P',
    )
    await expect
      .poll(
        async () =>
          (await electronRuntime.readMainProcessInteractions()).showItemInFolder,
      )
      .toHaveLength(1)

    await rockit.fileExplorer.selectFile('data.txt')
    await rockit.shell.runCommand('Open With System Editor')
    await expect
      .poll(
        async () => (await electronRuntime.readMainProcessInteractions()).openExternal,
      )
      .toHaveLength(1)

    const expectedPayloadPath = await realpath(path.join(testWorkspace.path, 'data.txt'))
    const interactions = await electronRuntime.readMainProcessInteractions()
    expect(interactions.showItemInFolder).toEqual([expectedPayloadPath])
    expect(interactions.openExternal).toEqual([expectedPayloadPath])
    expect(interactions.saveDialogs).toEqual([])

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
