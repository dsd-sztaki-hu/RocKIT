// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  unexpectedMainProcessErrors,
  unexpectedRendererErrors,
} from '../support/diagnostics'
import { expect, test } from '../support/electron-app'

const schemaId = 'e2e_local_schema'
const schemaName = 'E2E Local Schema'
const schemaPrefix = 'https://example.test/e2e-schema/'
const propertyName = 'e2eDatasetNote'
const propertyId = `${schemaPrefix}${propertyName}`
const propertyLabel = 'E2E dataset note'
const propertyValue = 'Value supplied by the local E2E schema'

const schemaDocument = {
  '@context': {
    e2e: schemaPrefix,
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    schema: 'https://schema.org/',
  },
  '@graph': [
    {
      '@id': `e2e:${propertyName}`,
      '@type': 'rdf:Property',
      'rdfs:comment': 'A deterministic scalar property for Electron E2E testing.',
      'rdfs:label': propertyLabel,
      'schema:domainIncludes': { '@id': 'schema:Dataset' },
      'schema:rangeIncludes': { '@id': 'schema:Text' },
    },
  ],
}

interface CrateRoot extends Record<string, unknown> {
  '@context'?: unknown
  '@id'?: string
}

const readCrateRoot = async (metadataPath: string): Promise<CrateRoot> => {
  const metadata = await readFile(metadataPath, 'utf8')
  try {
    const crate = JSON.parse(metadata) as {
      '@context'?: unknown
      '@graph'?: CrateRoot[]
    }
    return {
      ...(crate['@graph']?.find((entity) => entity['@id'] === './') ?? {}),
      '@context': crate['@context'],
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {}
    }
    throw error
  }
}

const contextMapping = (context: unknown, property: string): unknown => {
  const entries = Array.isArray(context) ? context : [context]
  for (const entry of entries) {
    if (entry && typeof entry === 'object' && property in entry) {
      return (entry as Record<string, unknown>)[property]
    }
  }
  return undefined
}

let schemaServer: Server
let schemaUrl: string

test.beforeAll(async () => {
  schemaServer = createServer((request, response) => {
    if (request.url !== '/schema.jsonld') {
      response.writeHead(404)
      response.end()
      return
    }

    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      Connection: 'close',
      'Content-Type': 'application/ld+json',
    })
    response.end(JSON.stringify(schemaDocument))
  })
  await new Promise<void>((resolve, reject) => {
    schemaServer.once('error', reject)
    schemaServer.listen(0, '127.0.0.1', resolve)
  })
  const address = schemaServer.address() as AddressInfo
  schemaUrl = `http://127.0.0.1:${address.port}/schema.jsonld`
})

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    schemaServer.close((error) => (error ? reject(error) : resolve()))
  })
})

test.describe('Electron local schema management', () => {
  test('imports, uses, persists, and removes a locally served schema', async ({
    electronDiagnostics,
    electronRuntime,
    rockit,
    testWorkspace,
  }) => {
    test.slow()

    await rockit.shell.waitForReady()
    await rockit.editor.waitForVisible()

    await rockit.schemas.open()
    await rockit.schemas.register({
      displayName: schemaName,
      id: schemaId,
      matchesPrefix: schemaPrefix,
      schemaUrl,
    })
    await rockit.schemas.load(schemaName)
    await rockit.schemas.close()

    await rockit.propertyChooser.open()
    await rockit.propertyChooser.selectSchema(schemaName)
    await expect(rockit.propertyChooser.onlyMatchingProperties).toBeChecked()
    await rockit.propertyChooser.select(propertyLabel)
    await expect(rockit.editor.property(propertyName)).toBeVisible()
    await rockit.editor.addTextProperty(propertyName, propertyValue)
    await expect(rockit.editor.propertyInput(propertyName)).toHaveValue(propertyValue)

    await rockit.editor.save()
    await expect
      .poll(async () => {
        const root = await readCrateRoot(testWorkspace.metadataPath)
        return {
          context: contextMapping(root['@context'], propertyName),
          value: root[propertyName],
        }
      })
      .toEqual({ context: propertyId, value: propertyValue })

    const persisted = await electronRuntime.restartWithPersistedState()
    await persisted.shell.waitForReady()
    await persisted.editor.waitForVisible()
    await expect(persisted.editor.propertyInput(propertyName)).toHaveValue(propertyValue)
    await persisted.schemas.open()
    await expect(persisted.schemas.card(schemaName)).toBeVisible()
    await persisted.schemas.load(schemaName)
    await persisted.schemas.remove(schemaName)
    await expect(persisted.schemas.card(schemaName)).toBeHidden()
    await persisted.schemas.close()

    const afterRemoval = await electronRuntime.restartWithPersistedState()
    await afterRemoval.shell.waitForReady()
    await afterRemoval.editor.waitForVisible()
    await expect(afterRemoval.editor.propertyInput(propertyName)).toHaveValue(
      propertyValue,
    )
    await afterRemoval.schemas.open()
    await expect(afterRemoval.schemas.card(schemaName)).toBeHidden()
    await afterRemoval.schemas.close()

    const savedRoot = await readCrateRoot(testWorkspace.metadataPath)
    expect(savedRoot[propertyName]).toBe(propertyValue)
    expect(contextMapping(savedRoot['@context'], propertyName)).toBe(propertyId)
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
