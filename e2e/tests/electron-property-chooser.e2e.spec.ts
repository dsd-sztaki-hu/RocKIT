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

const scalarValue = '2049-3630'
const publisherName = 'E2E Publisher Person'

const readGraph = async (metadataPath: string): Promise<RoCrateEntity[]> => {
  const metadata = await readFile(metadataPath, 'utf8')
  try {
    const crate = JSON.parse(metadata) as { '@graph'?: RoCrateEntity[] }
    return crate['@graph'] ?? []
  } catch (error) {
    if (error instanceof SyntaxError) {
      return []
    }
    throw error
  }
}

const referencedEntityId = (value: unknown): string | undefined => {
  const reference = Array.isArray(value) ? value[0] : value
  if (!reference || typeof reference !== 'object') {
    return undefined
  }
  const id = (reference as Record<string, unknown>)['@id']
  return typeof id === 'string' ? id : undefined
}

const entityTypes = (entity: RoCrateEntity | undefined): string[] => {
  const value = entity?.['@type']
  return (Array.isArray(value) ? value : [value]).filter(
    (type): type is string => typeof type === 'string',
  )
}

test.describe('Electron schema-property chooser', () => {
  test('adds scalar and entity-valued Schema.org properties and persists them', async ({
    electronDiagnostics,
    electronRuntime,
    rockit,
    testWorkspace,
  }) => {
    await rockit.shell.waitForReady()
    await rockit.editor.waitForVisible()

    await rockit.propertyChooser.open()
    await expect(rockit.propertyChooser.schemaFilter).toContainText('Schema.org')
    await expect(rockit.propertyChooser.onlyMatchingProperties).toBeChecked()
    await rockit.propertyChooser.showAllProperties()
    await expect(rockit.propertyChooser.onlyMatchingProperties).not.toBeChecked()
    await rockit.propertyChooser.select('Issn')
    await expect(rockit.editor.property('issn')).toBeVisible()
    await rockit.editor.addTextProperty('issn', scalarValue)
    await expect(rockit.editor.propertyInput('issn')).toHaveValue(scalarValue)

    await rockit.propertyChooser.add('Publisher')
    await expect(rockit.editor.property('publisher')).toBeVisible()
    await rockit.editor.createLinkedEntity('publisher', 'Person', publisherName)
    await expect(
      rockit.editor.property('publisher').getByText(publisherName, { exact: true }),
    ).toBeVisible()

    await rockit.editor.save()
    await expect
      .poll(async () => {
        const graph = await readGraph(testWorkspace.metadataPath)
        const root = graph.find((entity) => entity['@id'] === './')
        const publisherId = referencedEntityId(root?.publisher)
        const publisher = graph.find((entity) => entity['@id'] === publisherId)
        return {
          issn: root?.issn,
          publisherName: publisher?.name,
          publisherTypes: entityTypes(publisher),
        }
      })
      .toEqual({
        issn: scalarValue,
        publisherName,
        publisherTypes: expect.arrayContaining(['Person']),
      })

    const relaunched = await electronRuntime.restartWithFreshState()
    await relaunched.shell.waitForReady()
    await relaunched.editor.waitForVisible()
    await expect(relaunched.editor.propertyInput('issn')).toHaveValue(scalarValue)
    await expect(
      relaunched.editor.property('publisher').getByText(publisherName, { exact: true }),
    ).toBeVisible()

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
