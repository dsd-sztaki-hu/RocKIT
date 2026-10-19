// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator, Page } from '@playwright/test'

export class RocKitRoCrateEditor {
  readonly content: Locator
  readonly root: Locator

  constructor(readonly page: Page) {
    this.root = page.locator('[id^="rocrate-editor-widget"]:visible').last()
    this.content = this.root.locator('.recrate')
  }

  async waitForVisible(): Promise<void> {
    await this.root.waitFor({ state: 'visible' })
    await this.content.waitFor({ state: 'visible' })
    await this.property('name').waitFor({ state: 'visible' })
  }

  property(propertyName: string): Locator {
    return this.content
      .locator(`[data-recrate-property=${JSON.stringify(propertyName)}]`)
      .first()
  }

  propertyInput(propertyName: string): Locator {
    return this.property(propertyName)
      .locator('input:not([type="hidden"]), textarea')
      .first()
  }

  button(name: string): Locator {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return this.content
      .getByRole('button')
      .filter({ hasText: new RegExp(`^\\s*${escapedName}\\s*$`) })
  }

  async entityName(): Promise<string> {
    return this.propertyInput('name').inputValue()
  }

  async setTextProperty(propertyName: string, value: string): Promise<void> {
    const input = this.propertyInput(propertyName)
    await input.fill(value)
    await input.press('Enter')
  }

  async setEntityName(value: string): Promise<void> {
    await this.setTextProperty('name', value)
    await this.page
      .getByRole('treeitem')
      .filter({ hasText: value })
      .first()
      .waitFor({ state: 'visible' })
  }

  async save(): Promise<void> {
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  }

  async createLinkedEntity(
    propertyName: string,
    entityType: string,
    name: string,
  ): Promise<void> {
    const property = this.property(propertyName)
    await property
      .getByRole('button')
      .filter({ hasText: new RegExp(`^\\s*${entityType}\\s*$`) })
      .click()

    const entitySelector = property
      .locator('.recrate-property-type-entity')
      .getByRole('combobox')
    await entitySelector.fill(name)
    await entitySelector.press('Enter')
  }

  async selectGlobalEntity(
    propertyName: string,
    entityType: string,
    entityName: string,
  ): Promise<void> {
    const property = this.property(propertyName)
    const escapedEntityType = entityType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    await property
      .getByRole('button')
      .filter({ hasText: new RegExp(`^\\s*${escapedEntityType}\\s*$`, 'i') })
      .click()

    const entitySelector = property
      .locator('.recrate-property-type-entity')
      .getByRole('combobox')
    await entitySelector.fill(entityName)

    const dropdown = this.page.locator('.ant-select-dropdown:visible').last()
    await dropdown.getByText('Global entities', { exact: true }).waitFor({
      state: 'visible',
    })
    const option = dropdown
      .locator('.ant-select-item-option')
      .filter({ hasText: entityName })
      .first()
    await option.waitFor({ state: 'visible' })
    await option.click()
  }

  async addTextProperty(propertyName: string, value: string): Promise<void> {
    const property = this.property(propertyName)
    await property
      .getByRole('button')
      .filter({ hasText: /^\s*Text\s*$/ })
      .click()
    const input = this.propertyInput(propertyName)
    await input.fill(value)
    await input.press('Enter')
  }

  async deleteCurrentEntity(): Promise<void> {
    await this.button('Delete Entity').click()
    await this.page
      .getByText('Are you sure you want to delete this entity?', { exact: true })
      .waitFor({ state: 'visible' })
    await this.page.getByRole('button', { name: 'Yes', exact: true }).click()
  }

  async undo(): Promise<void> {
    await this.focusHistoryTarget()
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  }

  async redo(): Promise<void> {
    await this.focusHistoryTarget()
    await this.page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z',
    )
  }

  private async focusHistoryTarget(): Promise<void> {
    await this.button('Schemas').focus()
  }

  async openAddProperty(): Promise<Locator> {
    await this.button('Add').click()
    const dialog = this.page.getByRole('dialog').filter({
      has: this.page.getByText('Add properties to this entity', { exact: true }),
    })
    await dialog.waitFor({ state: 'visible' })
    return dialog
  }

  async openSchemas(): Promise<Locator> {
    await this.button('Schemas').click()
    const dialog = this.page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible' })
    return dialog
  }
}
