// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Locator } from '@playwright/test'
import { TheiaExplorerView } from '@theia/playwright'
import type { RocKitApplicationShell } from './application-shell'

export type RoCrateDescriptionFilter =
  | 'All files'
  | 'Missing RO-Crate description'
  | 'With RO-Crate description'

export class RocKitFileExplorer {
  readonly fileNameFilter: Locator
  readonly root: Locator
  readonly theiaView: TheiaExplorerView

  constructor(readonly shell: RocKitApplicationShell) {
    this.theiaView = new TheiaExplorerView(shell.theia)
    this.root = shell.page.locator('#explorer-view-container--files')
    this.fileNameFilter = this.root.getByLabel('File name')
  }

  async waitForVisible(): Promise<void> {
    await this.theiaView.activate()
    await this.root.waitFor({ state: 'visible' })
    await this.root.locator('.theia-TreeContainer').waitFor({ state: 'visible' })
  }

  fileNode(label: string): Locator {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return this.root
      .locator('.theia-FileStatNode')
      .filter({ hasText: new RegExp(`^\\s*${escapedLabel}\\s*$`) })
  }

  dataSourceNode(label: string): Locator {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return this.root.locator('.navigator-data-source-root').filter({
      hasText: new RegExp(`^\\s*${escapedLabel}\\s*$`),
    })
  }

  dataSourcesHeader(): Locator {
    return this.root.locator('.navigator-header-node').filter({
      hasText: /^\s*Data Sources\s*$/,
    })
  }

  async addDataSource(label: string): Promise<Locator> {
    await this.shell.runCommand('Add New Data Source')
    const node = this.dataSourceNode(label)
    await node.waitFor({ state: 'visible' })
    return node
  }

  async expandDataSource(label: string): Promise<void> {
    const node = this.dataSourceNode(label)
    const toggle = node.locator('.theia-ExpansionToggle')
    await toggle.waitFor({ state: 'visible' })
    if ((await toggle.getAttribute('class'))?.includes('theia-mod-collapsed')) {
      await toggle.click()
    }
  }

  async waitForFile(label: string): Promise<Locator> {
    const node = this.fileNode(label)
    await node.waitFor({ state: 'visible' })
    return node
  }

  async openFile(label: string): Promise<void> {
    await (await this.waitForFile(label)).dblclick()
  }

  async selectFile(label: string): Promise<void> {
    await (await this.waitForFile(label)).click()
  }

  async includeInRoCrateDescription(label: string): Promise<void> {
    await this.runDescriptionAction(label, 'Include in RO-Crate Description')
  }

  async omitFromRoCrateDescription(label: string): Promise<void> {
    await this.runDescriptionAction(label, 'Omit from RO-Crate Description')
  }

  async setFileNameFilter(value: string): Promise<void> {
    await this.fileNameFilter.fill(value)
  }

  async setDescriptionFilter(filter: RoCrateDescriptionFilter): Promise<void> {
    await this.root.getByRole('combobox').click()
    await this.shell.page.getByRole('option', { name: filter, exact: true }).click()
  }

  async refresh(): Promise<void> {
    await this.theiaView.refresh()
  }

  async collapseAll(): Promise<void> {
    await this.theiaView.collapseAll()
  }

  private async runDescriptionAction(label: string, action: string): Promise<void> {
    await this.selectFile(label)
    await this.shell.runCommand(action)
  }
}
