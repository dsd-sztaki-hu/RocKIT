// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import {
  unexpectedMainProcessErrors,
  unexpectedRendererErrors,
} from '../support/diagnostics'
import { expect, test } from '../support/electron-app'

const payloadName = 'data.txt'

interface CrateState {
  fileIds: string[]
  rootPartIds: string[]
}

const readCrateState = async (metadataPath: string): Promise<CrateState> => {
  const crate = JSON.parse(await readFile(metadataPath, 'utf8')) as {
    '@graph'?: Array<Record<string, unknown>>
  }
  const graph = crate['@graph'] ?? []
  const root = graph.find((entity) => entity['@id'] === './')
  const rawParts = Array.isArray(root?.hasPart) ? root.hasPart : [root?.hasPart]

  return {
    fileIds: graph.flatMap((entity) =>
      entity['@type'] === 'File' && typeof entity['@id'] === 'string'
        ? [entity['@id']]
        : [],
    ),
    rootPartIds: rawParts.flatMap((part) => {
      if (typeof part === 'string') {
        return [part]
      }
      if (part && typeof part === 'object') {
        const id = (part as Record<string, unknown>)['@id']
        return typeof id === 'string' ? [id] : []
      }
      return []
    }),
  }
}

const readIgnoredEntries = async (workspacePath: string): Promise<string[]> => {
  const contents = await readFile(
    path.join(workspacePath, '.rockit', 'ignored.txt'),
    'utf8',
  )
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

test.describe('Electron file omit/include workflow', () => {
  test('omits a local file and includes it back without deleting it', async ({
    electronDiagnostics,
    rockit,
    testWorkspace,
  }) => {
    await rockit.shell.waitForReady()
    await rockit.fileExplorer.waitForVisible()
    await rockit.editor.waitForVisible()

    const payloadPath = path.join(testWorkspace.path, payloadName)
    const originalPayload = await readFile(payloadPath, 'utf8')
    const payloadNode = rockit.fileExplorer.fileNode(payloadName)

    await expect(payloadNode).toBeVisible()
    await expect(payloadNode).not.toHaveClass(/omitted-from-ro-crate/)
    await expect(payloadNode).not.toHaveClass(/not-in-ro-crate/)
    expect(await readCrateState(testWorkspace.metadataPath)).toEqual({
      fileIds: expect.arrayContaining([payloadName]),
      rootPartIds: expect.arrayContaining([payloadName]),
    })

    await rockit.fileExplorer.omitFromRoCrateDescription(payloadName)

    await expect(payloadNode).toHaveClass(/omitted-from-ro-crate/)
    await expect
      .poll(() => readIgnoredEntries(testWorkspace.path), {
        message: `${payloadName} to be persisted in .rockit/ignored.txt`,
      })
      .toContain(payloadName)
    await expect
      .poll(() => readCrateState(testWorkspace.metadataPath), {
        message: `${payloadName} and its root reference to be removed from metadata`,
      })
      .toEqual({
        fileIds: expect.not.arrayContaining([payloadName]),
        rootPartIds: expect.not.arrayContaining([payloadName]),
      })
    expect(await readFile(payloadPath, 'utf8')).toBe(originalPayload)

    await rockit.fileExplorer.includeInRoCrateDescription(payloadName)

    await expect(payloadNode).not.toHaveClass(/omitted-from-ro-crate/)
    await expect
      .poll(() => readIgnoredEntries(testWorkspace.path), {
        message: `${payloadName} to be removed from .rockit/ignored.txt`,
      })
      .not.toContain(payloadName)

    expect(await readCrateState(testWorkspace.metadataPath)).toEqual({
      fileIds: expect.not.arrayContaining([payloadName]),
      rootPartIds: expect.not.arrayContaining([payloadName]),
    })
    expect(await readFile(payloadPath, 'utf8')).toBe(originalPayload)

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
