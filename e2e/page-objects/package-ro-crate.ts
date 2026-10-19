// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator } from '@playwright/test'
import type { RocKitApplicationShell } from './application-shell'

export class RocKitPackageRoCrate {
  readonly root: Locator

  constructor(readonly shell: RocKitApplicationShell) {
    this.root = shell.page.locator('#theia-dialog-shell')
  }

  async createNormalPackage(): Promise<void> {
    await this.shell.runCommand('Package RO-Crate')
    await this.root.waitFor({ state: 'visible' })
    await this.root
      .locator('.dialogTitle')
      .getByText('Package RO-Crate', { exact: true })
      .waitFor()
    await this.root.getByText('Normal Package', { exact: true }).waitFor()
    await this.root.getByText('Clean RO-Crate Package', { exact: true }).waitFor()
    await this.root.getByRole('button', { name: 'Package', exact: true }).click()
    await this.root.waitFor({ state: 'detached' })
  }
}
