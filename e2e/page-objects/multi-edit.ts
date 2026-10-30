// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator, Page } from '@playwright/test'

export class RocKitMultiEdit {
  readonly root: Locator
  readonly summary: Locator

  constructor(readonly page: Page) {
    this.root = page.locator('#theia-dialog-shell').filter({
      has: page.getByText('Multi Edit', { exact: true }),
    })
    this.summary = this.root.locator('.entities-overview-edit-modal-summary')
  }

  async waitForSelectedEntities(count: number): Promise<void> {
    await this.root.getByText(`${count} entities selected`, { exact: true }).waitFor()
  }

  async enableOtherOntologies(): Promise<void> {
    const toggle = this.root
      .locator('.entities-overview-edit-modal-schema-org-toggle')
      .getByRole('switch')
    if ((await toggle.getAttribute('aria-checked')) !== 'true') {
      await toggle.click()
    }
  }

  async setTextProperty(propertyOption: string, value: string): Promise<void> {
    const row = this.root.locator('.entities-overview-edit-modal-row').first()
    const propertySelector = row.getByRole('combobox').first()
    await propertySelector.click()
    await propertySelector.fill(propertyOption)
    await propertySelector.press('Enter')
    await row.getByPlaceholder('Enter value', { exact: true }).fill(value)
  }

  async start(): Promise<void> {
    await this.root.getByRole('button', { name: 'Start multi-edit', exact: true }).click()
    await this.summary.waitFor({ state: 'visible' })
  }

  async close(): Promise<void> {
    await this.root.getByRole('button', { name: 'Close', exact: true }).click()
    await this.root.waitFor({ state: 'hidden' })
  }
}
