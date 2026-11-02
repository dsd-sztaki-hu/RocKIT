// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator, Page } from '@playwright/test'
import type { RocKitRoCrateEditor } from './ro-crate-editor'

interface SchemaRegistration {
  displayName: string
  id: string
  matchesPrefix: string
  schemaUrl: string
}

export class RocKitSchemaManager {
  readonly root: Locator

  constructor(
    readonly page: Page,
    readonly editor: RocKitRoCrateEditor,
  ) {
    this.root = page.locator('.recrate-schema-settings-modal .ant-modal')
  }

  async open(): Promise<void> {
    await this.editor.button('Schemas').click()
    await this.root.waitFor({ state: 'visible' })
  }

  card(displayName: string): Locator {
    return this.root.locator('.ant-card').filter({
      has: this.page.getByText(displayName, { exact: true }),
    })
  }

  async register(schema: SchemaRegistration): Promise<void> {
    await this.root.getByRole('button', { name: 'Register new schema' }).click()
    const registration = this.page.locator('.recrate-schema-register-modal .ant-modal')
    await registration.waitFor({ state: 'visible' })
    const inputs = registration.locator('input')
    await inputs.nth(0).fill(schema.id)
    await inputs.nth(1).fill(schema.displayName)
    await inputs.nth(2).fill(schema.matchesPrefix)
    await inputs.nth(3).fill(schema.schemaUrl)
    await registration.getByRole('button', { name: 'Register', exact: true }).click()
    await registration.waitFor({ state: 'hidden' })
    await this.card(schema.displayName).waitFor({ state: 'visible' })
  }

  async load(displayName: string): Promise<void> {
    await this.card(displayName).getByRole('button', { name: /Load/ }).click()
    await this.page
      .getByText(`${displayName} loaded successfully`, { exact: true })
      .waitFor({ state: 'visible' })
  }

  async remove(displayName: string): Promise<void> {
    await this.card(displayName).getByRole('button', { name: 'Delete schema' }).click()
    const confirmation = this.page.locator('.recrate-schema-popconfirm')
    await confirmation.waitFor({ state: 'visible' })
    await confirmation.getByRole('button', { name: 'OK', exact: true }).click()
    await this.card(displayName).waitFor({ state: 'hidden' })
  }

  async close(): Promise<void> {
    await this.root.getByRole('button', { name: 'Done', exact: true }).click()
    await this.root.waitFor({ state: 'hidden' })
  }
}
