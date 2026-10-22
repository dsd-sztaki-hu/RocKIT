// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { FileUri } from '@theia/core/lib/common/file-uri'
import type { Page } from '@playwright/test'
import {
  unexpectedMainProcessErrors,
  unexpectedRendererErrors,
} from '../support/diagnostics'
import { expect, test } from '../support/electron-app'

const dataSourceDirectoryName = 'e2e-external-data-source'
const payloadName = 'external-data.csv'
const payloadContents = 'record,value\nalpha,42\n'

const storedDataSources = async (
  page: Page,
): Promise<{ key?: string; sources: string[] }> =>
  page.evaluate(() => {
    const key = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).find((candidate) => candidate?.endsWith('rockit:data-sources'))
    const stored = key ? window.localStorage.getItem(key) : null
    return {
      key: key ?? undefined,
      sources: stored ? (JSON.parse(stored) as string[]) : [],
    }
  })

test.use({ electronOpenDialogDirectoryName: dataSourceDirectoryName })

test.describe('Electron data-source registration', () => {
  test('adds an external folder through the native boundary and restores it after relaunch', async ({
    electronDiagnostics,
    electronRuntime,
    rockit,
    testWorkspace,
  }) => {
    test.slow()

    const sourcePath = path.join(electronRuntime.paths.home, dataSourceDirectoryName)
    const payloadPath = path.join(sourcePath, payloadName)
    const sourceUri = FileUri.create(sourcePath).toString()
    await mkdir(sourcePath, { recursive: true })
    await writeFile(payloadPath, payloadContents)
    const originalMetadata = await readFile(testWorkspace.metadataPath, 'utf8')

    await rockit.shell.waitForReady()
    await rockit.fileExplorer.waitForVisible()
    await rockit.fileExplorer.addDataSource(dataSourceDirectoryName)

    await expect(rockit.fileExplorer.dataSourcesHeader()).toBeVisible()
    await expect(
      rockit.fileExplorer.dataSourceNode(dataSourceDirectoryName),
    ).toBeVisible()
    await rockit.fileExplorer.expandDataSource(dataSourceDirectoryName)
    await expect(rockit.fileExplorer.fileNode(payloadName)).toBeVisible()
    await expect
      .poll(() => storedDataSources(electronRuntime.page))
      .toEqual({
        key: expect.stringMatching(/rockit:data-sources$/),
        sources: [sourceUri],
      })

    const interactions = await electronRuntime.readMainProcessInteractions()
    expect(interactions.openDialogs).toEqual([
      {
        properties: expect.arrayContaining(['openDirectory']),
        returnedPaths: [sourcePath],
        title: 'Select a folder to add as a data source',
      },
    ])
    expect(await readFile(payloadPath, 'utf8')).toBe(payloadContents)
    expect(await readFile(testWorkspace.metadataPath, 'utf8')).toBe(originalMetadata)

    const relaunched = await electronRuntime.restartWithPersistedState()
    await relaunched.shell.waitForReady()
    await relaunched.fileExplorer.waitForVisible()
    await expect(relaunched.fileExplorer.dataSourcesHeader()).toBeVisible()
    await expect(
      relaunched.fileExplorer.dataSourceNode(dataSourceDirectoryName),
    ).toBeVisible()
    await relaunched.fileExplorer.expandDataSource(dataSourceDirectoryName)
    await expect(relaunched.fileExplorer.fileNode(payloadName)).toBeVisible()
    await expect
      .poll(() => storedDataSources(relaunched.shell.page))
      .toEqual({
        key: expect.stringMatching(/rockit:data-sources$/),
        sources: [sourceUri],
      })

    expect(await readFile(payloadPath, 'utf8')).toBe(payloadContents)
    expect(await readFile(testWorkspace.metadataPath, 'utf8')).toBe(originalMetadata)
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
