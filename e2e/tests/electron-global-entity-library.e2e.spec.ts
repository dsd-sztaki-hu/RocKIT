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

type JsonObject = Record<string, unknown>

const profileName = 'E2E Global Author'
const authorName = 'E2E Global Library Author'
const authorAffiliation = 'RocKIT Test Laboratory'

const readJson = async (filePath: string): Promise<JsonObject> =>
  JSON.parse(await readFile(filePath, 'utf8')) as JsonObject

const readGraph = async (metadataPath: string): Promise<JsonObject[]> => {
  try {
    const crate = await readJson(metadataPath)
    return Array.isArray(crate['@graph']) ? (crate['@graph'] as JsonObject[]) : []
  } catch (error) {
    if (error instanceof SyntaxError) {
      return []
    }
    throw error
  }
}

const referenceId = (value: unknown): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value
  if (!first || typeof first !== 'object') {
    return undefined
  }
  const id = (first as JsonObject)['@id']
  return typeof id === 'string' ? id : undefined
}

const entityTypes = (entity: JsonObject | undefined): string[] => {
  const types = entity?.['@type']
  return (Array.isArray(types) ? types : [types]).filter(
    (type): type is string => typeof type === 'string',
  )
}

test.use({ rockitRuntimeFixtureName: 'global-author-profile' })

test.describe('Electron Global Entity Library', () => {
  test('creates a global author, selects it in the crate, and persists its mapping', async ({
    electronDiagnostics,
    electronRuntime,
    rockit,
    testWorkspace,
  }) => {
    test.slow()

    await rockit.shell.waitForReady()
    await rockit.editor.waitForVisible()
    await rockit.profiles.associate(profileName)
    await rockit.profiles.selectProfileTab(profileName)
    await expect(rockit.editor.property('author')).toBeVisible()

    await rockit.globalEntities.open()
    await rockit.globalEntities.addAuthor(authorName, authorAffiliation)
    await expect(rockit.globalEntities.row(authorName)).toContainText(authorAffiliation)

    const libraryPath = path.join(
      electronRuntime.paths.rockitRoot,
      'global-entities.json',
    )
    const library = await readJson(libraryPath)
    const authorRecords = library.author as JsonObject[]
    expect(authorRecords).toHaveLength(1)
    const recordId = String(authorRecords[0].recordId)
    expect(authorRecords[0].entity).toMatchObject({
      '@type': ['author'],
      authorAffiliation,
      authorName,
      name: authorName,
    })

    await rockit.shell.activateTab('Metadata: ./')
    await rockit.profiles.selectProfileTab(profileName)
    await rockit.editor.selectGlobalEntity('author', 'Author', authorName)
    await expect(
      rockit.editor.property('author').getByText(authorName, { exact: true }),
    ).toBeVisible()

    await rockit.editor.save()
    let selectedAuthorId = ''
    await expect
      .poll(async () => {
        const graph = await readGraph(testWorkspace.metadataPath)
        const root = graph.find((entity) => entity['@id'] === './')
        selectedAuthorId = referenceId(root?.author) ?? ''
        const author = graph.find((entity) => entity['@id'] === selectedAuthorId)
        return {
          authorAffiliation: author?.authorAffiliation,
          authorName: author?.authorName,
          name: author?.name,
          rootAuthorId: selectedAuthorId,
          types: entityTypes(author),
        }
      })
      .toEqual({
        authorAffiliation,
        authorName,
        name: authorName,
        rootAuthorId: expect.stringMatching(/^#global-/),
        types: expect.arrayContaining(['author']),
      })

    const mappingPath = path.join(
      testWorkspace.path,
      '.rockit',
      'global-entity-mapping.json',
    )
    await expect
      .poll(async () => {
        const mapping = await readJson(mappingPath)
        return (mapping.author as JsonObject)?.[recordId]
      })
      .toEqual({
        entityIds: [selectedAuthorId],
        lastSyncedHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      })

    const relaunched = await electronRuntime.restartWithPersistedState()
    await relaunched.shell.waitForReady()
    await relaunched.editor.waitForVisible()
    await relaunched.profiles.selectProfileTab(profileName)
    await expect(
      relaunched.editor.property('author').getByText(authorName, { exact: true }),
    ).toBeVisible()
    await relaunched.globalEntities.open()
    await expect(relaunched.globalEntities.row(authorName)).toContainText(
      authorAffiliation,
    )

    const persistedLibrary = await readJson(libraryPath)
    expect((persistedLibrary.author as JsonObject[])[0]).toMatchObject({
      recordId,
      entity: { authorName, name: authorName },
    })
    const persistedMapping = await readJson(mappingPath)
    expect((persistedMapping.author as JsonObject)[recordId]).toMatchObject({
      entityIds: [selectedAuthorId],
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
