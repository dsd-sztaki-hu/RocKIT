// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator, Page } from '@playwright/test'

export class RocKitStructurePanel {
  readonly root: Locator
  readonly validationIssues: Locator

  constructor(readonly page: Page) {
    this.root = page.locator('.ro-crate-structure-panel-body')
    this.validationIssues = this.root.locator('.ro-crate-structure-validation-strip')
  }

  entity(name: string): Locator {
    return this.root.locator('[data-entity-id]').filter({
      has: this.page.getByText(name, { exact: true }),
    })
  }

  async openEntity(name: string): Promise<void> {
    await this.entity(name).dblclick()
  }

  async selectEntities(names: string[]): Promise<void> {
    for (const [index, name] of names.entries()) {
      await this.entity(name).click({
        modifiers:
          index === 0 ? [] : [process.platform === 'darwin' ? 'Meta' : 'Control'],
      })
    }
  }

  async openMultiEditFromSelection(name: string): Promise<void> {
    await this.entity(name).click({ button: 'right' })
    await this.page.getByRole('button', { name: 'Edit', exact: true }).click()
  }
}
