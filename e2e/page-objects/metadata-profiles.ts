// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator, Page } from '@playwright/test'

export class RocKitMetadataProfiles {
  readonly editor: Locator

  constructor(readonly page: Page) {
    this.editor = page.locator('[id^="rocrate-editor-widget"]:visible').last()
  }

  profileTab(name: string): Locator {
    return this.editor.getByRole('tab').filter({
      has: this.page.getByText(name, { exact: true }),
    })
  }

  async associate(name: string): Promise<void> {
    await this.editor.getByRole('button', { name: 'Add profile', exact: true }).click()

    const dialog = this.page.locator('.dialogOverlay:visible').filter({
      has: this.page.getByText('Select Metadata Profile', { exact: true }),
    })
    await dialog.waitFor({ state: 'visible' })

    const profileRow = dialog.getByRole('row').filter({ hasText: name })
    await profileRow.click()
    await dialog.getByRole('button', { name: 'Associate', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  }

  async selectProfileTab(name: string): Promise<void> {
    const tab = this.profileTab(name)
    await tab.waitFor({ state: 'visible' })
    await tab.click()
  }
}
