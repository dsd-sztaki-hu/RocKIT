// Copyright (C) 2026 SZTAKI. SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/electron-app'

test('blocks an open repository dialog until the repository operation finishes', async ({
  appPage,
  rockit,
}) => {
  await rockit.shell.waitForReady()
  await rockit.shell.runCommand('Repository Operations')
  const dialog = appPage.locator('#theia-dialog-shell').filter({
    has: appPage
      .locator('.dialogTitle')
      .getByText('Select Data Repository', { exact: true }),
  })
  await expect(dialog).toBeVisible()
  const close = dialog.locator('.dialogTitle .closeButton')
  const closeBox = await close.boundingBox()
  if (!closeBox) throw new Error('Repository dialog close button is not visible')

  // Use the running application's real singleton. This exercises the same mask
  // as deletion without contacting a repository or deleting a remote dataset.
  await appPage.evaluate(() => {
    type Provider = {
      beginOperationProgress(
        repository: object,
        operation: string,
        message: string,
      ): { dispose(): void }
    }
    const state = window as unknown as {
      theia: {
        container: {
          _bindingDictionary: {
            traverse(
              callback: (key: unknown, bindings: Array<{ cache?: Provider }>) => void,
            ): void
          }
        }
      }
      repositoryMaskTestHandle?: { dispose(): void }
    }
    let provider: Provider | undefined
    state.theia.container._bindingDictionary.traverse((_key, bindings) => {
      provider ??= bindings
        .map((binding) => binding.cache)
        .find(
          (value) =>
            typeof value?.beginOperationProgress === 'function' &&
            Object.prototype.hasOwnProperty.call(value, 'operationProgressService'),
        )
    })
    if (!provider) throw new Error('Repository provider service has not initialized')
    state.repositoryMaskTestHandle = provider.beginOperationProgress(
      {
        id: 'isolated-mask-test',
        providerId: 'arp',
        title: 'ARP',
        baseUrl: 'https://example.invalid',
      },
      'delete',
      'Deleting remote dataset...',
    )
  })
  try {
    await expect(appPage.locator('.rockit-loadmask-overlay')).toBeVisible()
    await expect(appPage.locator('#rockit-loadmask-host')).not.toHaveAttribute(
      'inert',
      '',
    )
    await expect(dialog).toHaveAttribute('inert', '')
    await appPage.mouse.move(
      closeBox.x + closeBox.width / 2,
      closeBox.y + closeBox.height / 2,
    )
    expect(await close.evaluate((element) => element.matches(':hover'))).toBe(false)
    await appPage.mouse.click(
      closeBox.x + closeBox.width / 2,
      closeBox.y + closeBox.height / 2,
    )
    await appPage.keyboard.press('Escape')
    await appPage.keyboard.press('Tab')
    await expect(dialog).toHaveCount(1)
    expect(
      await appPage.evaluate(() =>
        document.getElementById('rockit-loadmask-host')?.contains(document.activeElement),
      ),
    ).toBe(true)
  } finally {
    await appPage.evaluate(() => {
      const state = window as unknown as {
        repositoryMaskTestHandle?: { dispose(): void }
      }
      state.repositoryMaskTestHandle?.dispose()
      delete state.repositoryMaskTestHandle
    })
  }
  await expect(appPage.locator('.rockit-loadmask-overlay')).toHaveCount(0)
  await expect(dialog).not.toHaveAttribute('inert', '')
  await close.click()
  await expect(dialog).toHaveCount(0)
})
