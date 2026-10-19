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

type RoCrateEntity = Record<string, unknown> & { '@id'?: string }

const createdName = 'E2E Child Dataset'
const editedName = 'Edited E2E Child Dataset'

const readGraph = async (metadataPath: string): Promise<RoCrateEntity[]> => {
  const crate = JSON.parse(await readFile(metadataPath, 'utf8')) as {
    '@graph'?: RoCrateEntity[]
  }
  return crate['@graph'] ?? []
}

const entityNamed = (graph: RoCrateEntity[], name: string): RoCrateEntity | undefined =>
  graph.find((entity) => entity.name === name)

const rootReferences = (graph: RoCrateEntity[], entityId: string): boolean => {
  const root = graph.find((entity) => entity['@id'] === './')
  const hasPart = Array.isArray(root?.hasPart) ? root.hasPart : [root?.hasPart]
  return hasPart.some(
    (reference) =>
      reference !== null &&
      typeof reference === 'object' &&
      (reference as Record<string, unknown>)['@id'] === entityId,
  )
}

test.describe('Electron entity lifecycle', () => {
  test('adds, edits, deletes, and restores an entity through undo and redo', async ({
    electronDiagnostics,
    rockit,
    testWorkspace,
  }) => {
    await rockit.shell.waitForReady()
    await rockit.editor.waitForVisible()

    await rockit.editor.createLinkedEntity('hasPart', 'Dataset', createdName)
    await expect(rockit.structure.entity(createdName)).toBeVisible()

    await rockit.editor.undo()
    await expect(rockit.structure.entity(createdName)).toBeHidden()
    await rockit.editor.redo()
    await expect(rockit.structure.entity(createdName)).toBeVisible()

    await rockit.structure.openEntity(createdName)
    await expect(rockit.editor.propertyInput('name')).toHaveValue(createdName)

    await rockit.editor.setEntityName(editedName)
    await expect(rockit.structure.entity(editedName)).toBeVisible()

    await rockit.editor.undo()
    await expect(rockit.editor.propertyInput('name')).toHaveValue(createdName)
    await expect(rockit.structure.entity(createdName)).toBeVisible()

    await rockit.editor.redo()
    await expect(rockit.editor.propertyInput('name')).toHaveValue(editedName)
    await expect(rockit.structure.entity(editedName)).toBeVisible()

    await rockit.editor.save()
    await expect
      .poll(async () =>
        Boolean(entityNamed(await readGraph(testWorkspace.metadataPath), editedName)),
      )
      .toBe(true)

    const savedGraph = await readGraph(testWorkspace.metadataPath)
    const savedEntity = entityNamed(savedGraph, editedName)
    expect(savedEntity?.['@id']).toEqual(expect.any(String))
    const entityId = savedEntity?.['@id'] as string
    expect(rootReferences(savedGraph, entityId)).toBe(true)

    await rockit.editor.deleteCurrentEntity()
    await expect(rockit.structure.entity(editedName)).toBeHidden()

    await rockit.editor.undo()
    await expect(rockit.structure.entity(editedName)).toBeVisible()

    await rockit.editor.redo()
    await expect(rockit.structure.entity(editedName)).toBeHidden()

    await rockit.editor.save()
    await expect
      .poll(async () => {
        const graph = await readGraph(testWorkspace.metadataPath)
        return (
          entityNamed(graph, editedName) === undefined && !rootReferences(graph, entityId)
        )
      })
      .toBe(true)

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
