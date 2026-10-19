// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator, Page } from '@playwright/test'

export type MetadataRecoveryKind = 'invalid' | 'missing'

const recoveryCopy: Record<
  MetadataRecoveryKind,
  { action: string; description: string; title: string }
> = {
  invalid: {
    action: 'Generate valid JSON file',
    description: 'The ro-crate-metadata.json file is invalid or cannot be parsed.',
    title: 'Invalid ro-crate-metadata.json',
  },
  missing: {
    action: 'Generate JSON file',
    description: 'No ro-crate-metadata.json was found in this workspace.',
    title: 'ro-crate-metadata.json Not Found',
  },
}

export class RocKitMetadataRecovery {
  readonly root: Locator

  constructor(readonly page: Page) {
    this.root = page.locator('#theia-dialog-shell')
  }

  async waitFor(kind: MetadataRecoveryKind): Promise<void> {
    const copy = recoveryCopy[kind]
    await this.root.waitFor({ state: 'visible' })
    await this.root
      .locator('.dialogTitle')
      .getByText(copy.title, { exact: true })
      .waitFor()
    await this.root.getByText(copy.description, { exact: true }).waitFor()
    await this.root.getByRole('button', { name: copy.action, exact: true }).waitFor()
  }

  async generate(kind: MetadataRecoveryKind): Promise<void> {
    await this.root
      .getByRole('button', { name: recoveryCopy[kind].action, exact: true })
      .click()
    await this.root.waitFor({ state: 'detached' })
  }
}
