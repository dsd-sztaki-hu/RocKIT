// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { cp, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { test as base, expect } from '@playwright/test'

const fixtureDirectory = path.resolve(__dirname, '..', 'fixtures')

export interface TestWorkspace {
  fixtureName: string
  metadataPath: string
  path: string
}

interface WorkspaceOptions {
  workspaceFixtureName: string
}

interface WorkspaceFixtures {
  testWorkspace: TestWorkspace
}

const fixturePathFor = (fixtureName: string): string => {
  const fixturePath = path.resolve(fixtureDirectory, fixtureName)
  const relativePath = path.relative(fixtureDirectory, fixturePath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(
      `Workspace fixture must be inside ${fixtureDirectory}: ${fixtureName}`,
    )
  }

  return fixturePath
}

export const test = base.extend<WorkspaceOptions & WorkspaceFixtures>({
  workspaceFixtureName: ['basic-ro-crate', { option: true }],

  testWorkspace: async ({ workspaceFixtureName }, use) => {
    const sourcePath = fixturePathFor(workspaceFixtureName)
    const sourceStats = await stat(sourcePath).catch(() => undefined)

    if (!sourceStats?.isDirectory()) {
      throw new Error(
        `Workspace fixture does not exist or is not a directory: ${sourcePath}`,
      )
    }

    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'rockit-e2e-workspace-'))
    const workspacePath = path.join(temporaryRoot, 'workspace')

    try {
      await cp(sourcePath, workspacePath, { recursive: true })
      await use({
        fixtureName: workspaceFixtureName,
        metadataPath: path.join(workspacePath, 'ro-crate-metadata.json'),
        path: workspacePath,
      })
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true })
    }
  },
})

export { expect }
