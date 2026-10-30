// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import {
  unexpectedMainProcessErrors,
  unexpectedRendererErrors,
} from '../support/diagnostics'
import { expect, test } from '../support/electron-app'

const originalName = 'RocKIT E2E Fixture'
const suggestedName = 'AI-suggested dataset name'
const suggestedDescription = 'AI-suggested description accepted in review'

interface CrateEntity extends Record<string, unknown> {
  '@id': string
}

interface ApprovalItem extends Record<string, unknown> {
  approved: boolean
  operation: string
  propertyName: string
}

interface ApprovalEntity extends Record<string, unknown> {
  '@id': string
  approval: ApprovalItem[]
}

const readRootEntity = async (metadataPath: string): Promise<CrateEntity> => {
  const crate = JSON.parse(await readFile(metadataPath, 'utf8')) as {
    '@graph': CrateEntity[]
  }
  const root = crate['@graph'].find((entity) => entity['@id'] === './')
  if (!root) {
    throw new Error('The E2E fixture has no root Dataset')
  }
  return root
}

const writeExternalSuggestions = async (metadataPath: string): Promise<void> => {
  const crate = JSON.parse(await readFile(metadataPath, 'utf8')) as {
    '@graph': CrateEntity[]
  }
  const root = crate['@graph'].find((entity) => entity['@id'] === './')
  if (!root) {
    throw new Error('The E2E fixture has no root Dataset')
  }

  root.name = suggestedName
  root.description = suggestedDescription
  await writeFile(metadataPath, `${JSON.stringify(crate, null, 2)}\n`)
}

const readApproval = async (approvalPath: string): Promise<ApprovalEntity[]> =>
  JSON.parse(await readFile(approvalPath, 'utf8')) as ApprovalEntity[]

test.use({ electronExternalChangeAction: 'auto' })

test.describe('Electron AI review', () => {
  test('accepts and rejects external suggestions and persists the approval state', async ({
    electronDiagnostics,
    electronRuntime,
    rockit,
    testWorkspace,
  }) => {
    const approvalPath = path.join(
      testWorkspace.path,
      '.rockit',
      'ro-crate-approval.json',
    )

    await rockit.shell.waitForReady()
    await rockit.editor.waitForVisible()
    await writeExternalSuggestions(testWorkspace.metadataPath)

    await expect(rockit.aiReview.pendingProperty('name')).toBeVisible()
    await expect(rockit.aiReview.pendingProperty('description')).toBeVisible()
    await expect(rockit.editor.propertyInput('name')).toHaveValue(suggestedName)
    await expect(rockit.editor.propertyInput('description')).toHaveValue(
      suggestedDescription,
    )

    await rockit.aiReview.accept('description')
    await expect(rockit.aiReview.pendingProperty('description')).toBeHidden()
    await expect(rockit.aiReview.approvedIndicator('description')).toBeVisible()

    await rockit.aiReview.reject('name')
    await expect(rockit.aiReview.pendingProperty('name')).toBeHidden()
    await expect(rockit.editor.propertyInput('name')).toHaveValue(originalName)
    await expect(rockit.structure.entity(originalName)).toBeVisible()

    await expect
      .poll(() => readApproval(approvalPath))
      .toMatchObject([
        {
          '@id': './',
          approval: [
            {
              approved: true,
              operation: 'create',
              propertyName: 'description',
            },
          ],
        },
      ])

    await rockit.editor.save()
    await expect
      .poll(() => readRootEntity(testWorkspace.metadataPath))
      .toMatchObject({
        '@id': './',
        description: suggestedDescription,
        name: originalName,
      })

    const relaunched = await electronRuntime.restartWithFreshState()
    await relaunched.shell.waitForReady()
    await relaunched.editor.waitForVisible()
    await expect(relaunched.editor.propertyInput('name')).toHaveValue(originalName)
    await expect(relaunched.editor.propertyInput('description')).toHaveValue(
      suggestedDescription,
    )
    await expect(relaunched.aiReview.pendingProperty('name')).toBeHidden()
    await expect(relaunched.aiReview.pendingProperty('description')).toBeHidden()
    await expect(relaunched.aiReview.approvedIndicator('description')).toBeVisible()

    expect(await readApproval(approvalPath)).toMatchObject([
      {
        '@id': './',
        approval: [
          {
            approved: true,
            operation: 'create',
            propertyName: 'description',
          },
        ],
      },
    ])
    expect(await readRootEntity(testWorkspace.metadataPath)).toMatchObject({
      '@id': './',
      description: suggestedDescription,
      name: originalName,
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
