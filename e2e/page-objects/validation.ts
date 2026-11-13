// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator, Page } from '@playwright/test'

export class RocKitValidation {
  readonly noErrors: Locator
  readonly root: Locator

  constructor(readonly page: Page) {
    this.root = page.locator('.schema-validator-widget:visible')
    this.noErrors = this.root.getByText('No validation errors', { exact: true })
  }

  error(fieldLabel: string): Locator {
    return this.root.getByRole('button').filter({
      has: this.page.getByText(fieldLabel, { exact: true }),
    })
  }
}
