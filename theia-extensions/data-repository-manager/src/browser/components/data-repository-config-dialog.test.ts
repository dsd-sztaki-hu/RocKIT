// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import 'reflect-metadata'
import { act } from 'react'

import { DataRepositoryConfigDialog } from './data-repository-config-dialog'
import type { DataRepositoryConfig } from '../types'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const repository: DataRepositoryConfig = {
  id: 'repository-1',
  title: 'ARP production',
  baseUrl: 'https://repo.researchdata.hu',
  apiKey: 'secret',
  providerId: 'arp',
}

const renderDialog = (providers: any[]) => {
  const dialog = new DataRepositoryConfigDialog(
    repository,
    providers,
    { executeForRepository: jest.fn() } as any,
  ) as any

  act(() => dialog.render())
  return dialog
}

describe('DataRepositoryConfigDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows an empty repository type field and disables Save without providers', () => {
    const dialog = renderDialog([])
    const providerSelect = dialog.contentNode.querySelector('select') as HTMLSelectElement
    const saveButton = dialog.contentNode.querySelector(
      '.data-repo-config__btn-save',
    ) as HTMLButtonElement
    const saveTooltip = dialog.contentNode.querySelector(
      '.data-repo-config__save-tooltip',
    ) as HTMLSpanElement
    const providerAlert = dialog.contentNode.querySelector('[role="alert"]') as HTMLDivElement

    expect(dialog.contentNode.textContent).toContain('Repository Type')
    expect(providerSelect).not.toBeNull()
    expect(providerSelect.disabled).toBe(true)
    expect(providerSelect.value).toBe('')
    expect(providerSelect.textContent).toContain('No repository types installed')
    expect(saveButton.disabled).toBe(true)
    expect(saveTooltip.title).toBe(
      'Install a repository provider extension before saving this connection.',
    )
    expect(providerAlert.textContent).toContain('Action required')
    expect(providerAlert.textContent).toContain(
      'No repository provider extensions are installed. Install one from the Extensions view before saving this connection.',
    )

    act(() => dialog.reactRoot.unmount())
  })

  it('enables Save when the configured repository provider is available', () => {
    const dialog = renderDialog([{
      id: 'arp',
      displayName: 'ARP',
      extensionId: 'rockit.arp-repository-provider',
      protocolVersion: '1.0',
      operations: { validate: 'rockit.arp.validate' },
    }])
    const providerSelect = dialog.contentNode.querySelector('select') as HTMLSelectElement
    const saveButton = dialog.contentNode.querySelector(
      '.data-repo-config__btn-save',
    ) as HTMLButtonElement
    const saveTooltip = dialog.contentNode.querySelector(
      '.data-repo-config__save-tooltip',
    ) as HTMLSpanElement

    expect(providerSelect.disabled).toBe(false)
    expect(providerSelect.value).toBe('arp')
    expect(saveButton.disabled).toBe(false)
    expect(saveTooltip.title).toBe('')
    expect(dialog.contentNode.querySelector('[role="alert"]')).toBeNull()

    act(() => dialog.reactRoot.unmount())
  })
})
