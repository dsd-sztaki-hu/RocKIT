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

const persistedName = 'Persisted Electron E2E Dataset'

const readRootName = async (metadataPath: string): Promise<unknown> => {
  const crate = JSON.parse(await readFile(metadataPath, 'utf8')) as {
    '@graph'?: Array<Record<string, unknown>>
  }
  return crate['@graph']?.find((entity) => entity['@id'] === './')?.name
}

test.describe('Electron metadata persistence', () => {
  test('saves root metadata and reloads it with fresh application state', async ({
    electronDiagnostics,
    electronRuntime,
    rockit,
    testWorkspace,
  }) => {
    await rockit.shell.waitForReady()
    await rockit.fileExplorer.waitForVisible()
    await rockit.editor.waitForVisible()

    const firstApplication = electronRuntime.application
    const firstProcess = firstApplication.process()
    const firstRuntimePaths = { ...electronRuntime.paths }

    await rockit.editor.setEntityName(persistedName)
    await expect(rockit.editor.propertyInput('name')).toHaveValue(persistedName)
    await rockit.editor.save()
    await expect
      .poll(() => readRootName(testWorkspace.metadataPath), {
        message: 'edited root name to be saved to ro-crate-metadata.json',
      })
      .toBe(persistedName)

    const relaunched = await electronRuntime.restartWithFreshState()

    expect(electronRuntime.application).not.toBe(firstApplication)
    expect(firstProcess.exitCode !== null || firstProcess.signalCode !== null).toBe(true)
    expect(electronRuntime.paths.electronUserData).not.toBe(
      firstRuntimePaths.electronUserData,
    )
    expect(electronRuntime.paths.home).not.toBe(firstRuntimePaths.home)
    expect(electronRuntime.paths.rockitRoot).not.toBe(firstRuntimePaths.rockitRoot)

    await relaunched.shell.waitForReady()
    await relaunched.fileExplorer.waitForVisible()
    await relaunched.editor.waitForVisible()

    await expect(relaunched.editor.propertyInput('name')).toHaveValue(persistedName)
    expect(await readRootName(testWorkspace.metadataPath)).toBe(persistedName)
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
