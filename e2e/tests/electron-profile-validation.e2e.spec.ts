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

const profileName = 'E2E Required Note'
const profileId = 'https://example.test/profiles/e2e-required-note'
const requiredField = 'e2eRequiredNote'
const requiredFieldLabel = 'E2E required note'
const correctedValue = 'Validated through the Electron UI'

const readRootEntity = async (metadataPath: string): Promise<Record<string, unknown>> => {
  const metadata = await readFile(metadataPath, 'utf8')
  let crate: { '@graph'?: Array<Record<string, unknown>> }
  try {
    crate = JSON.parse(metadata) as typeof crate
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {}
    }
    throw error
  }
  return crate['@graph']?.find((entity) => entity['@id'] === './') ?? {}
}

const conformsToIds = (entity: Record<string, unknown>): string[] => {
  const values = Array.isArray(entity.conformsTo)
    ? entity.conformsTo
    : [entity.conformsTo]
  return values.flatMap((value) => {
    if (typeof value === 'string') {
      return [value]
    }
    if (value && typeof value === 'object') {
      const id = (value as Record<string, unknown>)['@id']
      return typeof id === 'string' ? [id] : []
    }
    return []
  })
}

test.use({
  rockitRuntimeFixtureName: 'required-note-profile',
  workspaceFixtureName: 'profile-validation-ro-crate',
})

test.describe('Electron metadata-profile validation', () => {
  test('associates a local profile and corrects its validation error', async ({
    electronDiagnostics,
    rockit,
    testWorkspace,
  }) => {
    await rockit.shell.waitForReady()
    await rockit.editor.waitForVisible()
    await expect(rockit.structure.validationIssues).toBeDisabled()

    await rockit.profiles.associate(profileName)

    await expect(rockit.structure.validationIssues).toBeEnabled()
    await expect(rockit.structure.validationIssues).toContainText('1 validation error')
    await expect(rockit.validation.error(requiredFieldLabel)).toContainText(
      'Required value not set',
    )

    await rockit.profiles.selectProfileTab(profileName)
    await expect(rockit.editor.property(requiredField)).toBeVisible()
    await rockit.editor.addTextProperty(requiredField, correctedValue)

    await expect(rockit.editor.propertyInput(requiredField)).toHaveValue(correctedValue)
    await expect(rockit.structure.validationIssues).toBeDisabled()
    await expect(rockit.validation.noErrors).toBeVisible()

    await rockit.editor.save()
    await expect
      .poll(async () => {
        const root = await readRootEntity(testWorkspace.metadataPath)
        return {
          conformsTo: conformsToIds(root),
          requiredNote: root[requiredField],
        }
      })
      .toEqual({
        conformsTo: expect.arrayContaining([profileId]),
        requiredNote: correctedValue,
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
