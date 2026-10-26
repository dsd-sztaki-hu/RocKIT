// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { TheiaApp, type TheiaWorkspace } from '@theia/playwright'

const applicationStartupTimeout = 45_000

const workspaceReference = (workspacePath: string): TheiaWorkspace => {
  const normalizedPath =
    process.platform === 'win32'
      ? workspacePath.replace(
          /^([A-Z]):/,
          (_match, drive: string) => `${drive.toLowerCase()}:`,
        )
      : workspacePath
  const pathAsPathComponent = normalizedPath.startsWith(path.sep)
    ? normalizedPath
    : `${path.sep}${normalizedPath}`

  return {
    get path() {
      return normalizedPath
    },
    get pathAsPathComponent() {
      return pathAsPathComponent.replaceAll('\\', '/')
    },
    pathAsUrl(subpath: string) {
      return pathToFileURL(path.resolve(normalizedPath, subpath)).toString()
    },
  } as unknown as TheiaWorkspace
}

export class RocKitApplicationShell {
  readonly mainContent: Locator
  readonly menuBar: Locator
  readonly root: Locator
  readonly statusBar: Locator
  readonly theia: TheiaApp

  constructor(
    readonly page: Page,
    readonly workspacePath: string,
  ) {
    this.theia = new TheiaApp(page, workspaceReference(workspacePath), true)
    this.root = page.locator('#theia-app-shell')
    this.mainContent = page.locator('#theia-main-content-panel')
    this.menuBar = page.locator('[id="theia:menubar"]')
    this.statusBar = page.locator('#theia-statusBar')
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForSelector('.theia-preload', {
      state: 'detached',
      timeout: applicationStartupTimeout,
    })
    await this.page.waitForSelector('.theia-ApplicationShell', {
      state: 'visible',
      timeout: applicationStartupTimeout,
    })
    await this.theia.waitForInitialized()
    await this.root.waitFor({ state: 'visible' })
    await this.mainContent.waitFor({ state: 'visible' })
  }

  tab(label: string): Locator {
    return this.page
      .locator('.lm-TabBar-tab')
      .filter({ has: this.page.getByText(label, { exact: true }) })
  }

  async activateTab(label: string): Promise<void> {
    const tab = this.tab(label).filter({ visible: true }).last()
    await tab.click()
    await tab.waitFor({ state: 'visible' })
  }

  async activeTabLabels(): Promise<string[]> {
    return this.page.locator('.lm-TabBar-tab.lm-mod-current:visible').allInnerTexts()
  }

  async runCommand(action: string): Promise<void> {
    await this.theia.quickCommandPalette.open()
    await this.theia.quickCommandPalette.type(action, true)
    await this.page
      .locator(this.theia.quickCommandPalette.selector)
      .waitFor({ state: 'hidden' })
  }
}
