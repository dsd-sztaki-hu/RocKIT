// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator, Page } from '@playwright/test'
import type { RocKitRoCrateEditor } from './ro-crate-editor'

export class RocKitPropertyChooser {
  readonly filter: Locator
  readonly onlyMatchingProperties: Locator
  readonly root: Locator
  readonly schemaFilter: Locator

  constructor(
    readonly page: Page,
    readonly editor: RocKitRoCrateEditor,
  ) {
    this.root = page.locator('.recrate-add-property-drawer.ant-drawer-open')
    this.filter = this.root.getByPlaceholder('Filter the attribute set')
    this.onlyMatchingProperties = this.root.getByRole('checkbox')
    this.schemaFilter = this.root.locator('.ant-select-selector').first()
  }

  async open(): Promise<void> {
    await this.editor.button('Add').click()
    await this.root.waitFor({ state: 'visible' })
    await this.filter.waitFor({ state: 'visible' })
  }

  property(propertyLabel: string): Locator {
    return this.root.locator('.recrate-add-property-row').filter({
      has: this.page.getByText(propertyLabel, { exact: true }),
    })
  }

  schemaOption(displayName: string): Locator {
    return this.page
      .locator('.recrate-schema-filter-dropdown:visible')
      .getByText(displayName, { exact: true })
  }

  async selectSchema(displayName: string): Promise<void> {
    await this.schemaFilter.click()
    const option = this.schemaOption(displayName)
    await option.waitFor({ state: 'visible' })
    await option.click()
  }

  async select(propertyLabel: string): Promise<void> {
    await this.filter.fill(propertyLabel)
    const property = this.property(propertyLabel)
    await property.waitFor({ state: 'visible' })
    await property.click()
    await this.root.waitFor({ state: 'hidden' })
  }

  async showAllProperties(): Promise<void> {
    await this.onlyMatchingProperties.uncheck()
  }

  async add(propertyLabel: string): Promise<void> {
    await this.open()
    await this.showAllProperties()
    await this.select(propertyLabel)
  }
}
