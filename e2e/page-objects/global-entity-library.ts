// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator, Page } from '@playwright/test'
import type { RocKitApplicationShell } from './application-shell'

export class RocKitGlobalEntityLibrary {
  readonly root: Locator
  readonly table: Locator

  constructor(
    readonly page: Page,
    readonly shell: RocKitApplicationShell,
  ) {
    this.root = page.locator('[id="global-entity-library:widget"]:visible')
    this.table = this.root.locator('#global-entity-library-table')
  }

  async open(): Promise<void> {
    await this.shell.runCommand('Open Global Entity Library')
    await this.root.waitFor({ state: 'visible' })
    await this.table.waitFor({ state: 'visible' })
  }

  row(name: string): Locator {
    return this.table.getByRole('row').filter({
      has: this.page.getByText(name, { exact: true }),
    })
  }

  async addAuthor(name: string, affiliation: string): Promise<void> {
    await this.table.getByRole('button', { name: /Add entity$/ }).click()
    const dialog = this.page.getByRole('dialog').filter({
      has: this.page.getByText('Add global entity', { exact: true }),
    })
    await dialog.waitFor({ state: 'visible' })
    await this.fillFormField(dialog, 'Author Name', name)
    await this.fillFormField(dialog, 'Affiliation', affiliation)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await this.row(name).waitFor({ state: 'visible' })
  }

  private async fillFormField(
    dialog: Locator,
    label: string,
    value: string,
  ): Promise<void> {
    const item = dialog.locator('.ant-form-item').filter({
      has: this.page.getByText(label, { exact: true }),
    })
    await item.locator('input, textarea').first().fill(value)
  }
}
