// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { MetadataRecoveryKind, RocKitPageObjects } from '../page-objects'
import {
  unexpectedMainProcessErrors,
  unexpectedRendererErrors,
} from '../support/diagnostics'
import type { ElectronDiagnostics } from '../support/electron-app'
import { expect, test } from '../support/electron-app'
import type { TestWorkspace } from '../support/test-workspace'

const payloadName = 'payload.txt'

interface RecoveredCrate {
  graph: Array<Record<string, unknown>>
  root: Record<string, unknown>
}

interface RecoveryContext {
  electronDiagnostics: ElectronDiagnostics
  rockit: RocKitPageObjects
  testWorkspace: TestWorkspace
}

const readRecoveredCrate = async (metadataPath: string): Promise<RecoveredCrate> => {
  const crate = JSON.parse(await readFile(metadataPath, 'utf8')) as {
    '@graph'?: Array<Record<string, unknown>>
  }
  const graph = crate['@graph'] ?? []
  return {
    graph,
    root: graph.find((entity) => entity['@id'] === './') ?? {},
  }
}

const referenceIds = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry]
    }
    if (entry && typeof entry === 'object') {
      const id = (entry as Record<string, unknown>)['@id']
      return typeof id === 'string' ? [id] : []
    }
    return []
  })
}

const assertExpectedDiagnostics = (
  diagnostics: ElectronDiagnostics,
  kind: MetadataRecoveryKind,
): void => {
  const unexpectedRenderer = unexpectedRendererErrors(diagnostics)
  if (kind === 'missing') {
    expect(unexpectedRenderer, 'unexpected Electron renderer errors').toEqual([])
    return
  }

  const parseErrors = unexpectedRenderer.filter((message) =>
    message.includes('Parsing error:'),
  )
  expect(parseErrors, 'the malformed input should report one parsing error').toHaveLength(
    1,
  )
  expect(
    unexpectedRenderer.filter((message) => !message.includes('Parsing error:')),
    'unexpected Electron renderer errors other than the recovery trigger',
  ).toEqual([])
}

const runRecovery = async (
  kind: MetadataRecoveryKind,
  context: RecoveryContext,
): Promise<void> => {
  const { electronDiagnostics, rockit, testWorkspace } = context
  const payloadPath = path.join(testWorkspace.path, payloadName)
  const previewPath = path.join(testWorkspace.path, 'ro-crate-preview.html')
  const ignoredPath = path.join(testWorkspace.path, '.rockit', 'ignored.txt')
  const originalPayload = await readFile(payloadPath, 'utf8')

  await rockit.shell.waitForReady()
  await rockit.metadataRecovery.waitFor(kind)
  await rockit.metadataRecovery.generate(kind)

  await rockit.fileExplorer.waitForVisible()
  await rockit.editor.waitForVisible()
  await expect(rockit.fileExplorer.fileNode(payloadName)).toBeVisible()
  await expect(rockit.fileExplorer.fileNode('ro-crate-metadata.json')).toBeVisible()
  await expect(rockit.editor.property('@id')).toContainText('./')
  await expect(rockit.editor.propertyInput('name')).toHaveValue('workspace')

  await expect
    .poll(() => readRecoveredCrate(testWorkspace.metadataPath), {
      message: 'the generated metadata to describe the root and local payload',
    })
    .toMatchObject({
      graph: expect.arrayContaining([
        expect.objectContaining({
          '@id': 'ro-crate-metadata.json',
          '@type': 'CreativeWork',
          about: { '@id': './' },
        }),
        expect.objectContaining({
          '@id': payloadName,
          '@type': 'File',
          name: payloadName,
        }),
      ]),
      root: expect.objectContaining({
        '@id': './',
        '@type': 'Dataset',
      }),
    })

  const recovered = await readRecoveredCrate(testWorkspace.metadataPath)
  expect(referenceIds(recovered.root.hasPart)).toContain(payloadName)
  expect(await readFile(payloadPath, 'utf8')).toBe(originalPayload)
  await expect.poll(() => readFile(previewPath, 'utf8')).toContain('RO-Crate')
  await expect.poll(() => readFile(ignoredPath, 'utf8')).not.toBe('')

  expect(
    unexpectedMainProcessErrors(electronDiagnostics),
    'unexpected Electron main-process errors',
  ).toEqual([])
  assertExpectedDiagnostics(electronDiagnostics, kind)
}

test.describe('Electron missing-metadata recovery', () => {
  test.use({ workspaceFixtureName: 'recovery-missing-ro-crate' })

  test('generates metadata for a workspace that has no metadata file', async ({
    electronDiagnostics,
    rockit,
    testWorkspace,
  }) => {
    await runRecovery('missing', { electronDiagnostics, rockit, testWorkspace })
  })
})

test.describe('Electron malformed-metadata recovery', () => {
  test.use({ workspaceFixtureName: 'recovery-malformed-ro-crate' })

  test('replaces malformed metadata with a generated valid crate', async ({
    electronDiagnostics,
    rockit,
    testWorkspace,
  }) => {
    await runRecovery('invalid', { electronDiagnostics, rockit, testWorkspace })
  })
})
