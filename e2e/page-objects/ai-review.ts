// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator } from '@playwright/test'
import type { RocKitRoCrateEditor } from './ro-crate-editor'

export class RocKitAiReview {
  constructor(readonly editor: RocKitRoCrateEditor) {}

  pendingProperty(propertyName: string): Locator {
    return this.editor.property(propertyName).locator('.recrate-ai-review')
  }

  approvedIndicator(propertyName: string): Locator {
    return this.editor.property(propertyName).locator('.recrate-ai-edited-icon')
  }

  async accept(propertyName: string): Promise<void> {
    await this.pendingProperty(propertyName).locator('.recrate-ai-action-approve').click()
  }

  async reject(propertyName: string): Promise<void> {
    await this.pendingProperty(propertyName).locator('.recrate-ai-action-reject').click()
  }
}
