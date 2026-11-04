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

const provider = (id: string, detectionPriority = 0) => ({
  id,
  displayName: id.toUpperCase(),
  detectionPriority,
  extensionId: `example.${id}`,
  protocolVersion: '1.0',
  operations: { detect: `example.${id}.detect`, validate: `example.${id}.validate` },
})

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
      extensionId: 'SZTAKI-DSD.arp-repository-provider',
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

  it('renders Base URL before Repository Type and enables autodetection when a URL is set', () => {
    const dialog = renderDialog([provider('arp')])
    const labels = Array.from(dialog.contentNode.querySelectorAll('label'))
      .map((label: Element) => label.textContent?.trim())
    const detectButton = dialog.contentNode.querySelector(
      '.data-repo-config__autodetect-btn',
    ) as HTMLButtonElement

    expect(labels.indexOf('Base URL')).toBeLessThan(labels.indexOf('Repository Type'))
    expect(detectButton.disabled).toBe(false)
    expect(detectButton.classList.contains('main')).toBe(true)
    expect(detectButton.closest('.data-repo-config__base-url-row')).not.toBeNull()
    expect(detectButton.parentElement?.title).toBe(
      'Ask the installed repository plugins to identify the repository type from this Base URL.',
    )

    act(() => dialog.reactRoot.unmount())
  })

  it('asks specialized providers first and falls back to a generic provider', async () => {
    const execute = jest.fn()
      .mockResolvedValueOnce({ supported: false })
      .mockResolvedValueOnce({ supported: true })
    const dialog = new DataRepositoryConfigDialog(
      repository,
      [provider('dataverse'), provider('arp', 100), provider('zenodo')],
      { execute } as any,
    ) as any

    await act(async () => {
      dialog.render()
      await dialog.handleAutoDetect()
    })

    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls.map(call => call[0].providerId)).toEqual(['arp', 'dataverse'])
    expect((dialog.contentNode.querySelector('select') as HTMLSelectElement).value)
      .toBe('dataverse')

    act(() => dialog.reactRoot.unmount())
  })

  it('stops at ARP before probing generic Dataverse when ARP recognizes the URL', async () => {
    const execute = jest.fn().mockResolvedValue({ supported: true })
    const dialog = new DataRepositoryConfigDialog(
      repository,
      [provider('dataverse', -100), provider('arp', 100)],
      { execute } as any,
    ) as any

    await act(async () => {
      dialog.render()
      await dialog.handleAutoDetect()
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0].providerId).toBe('arp')
    expect((dialog.contentNode.querySelector('select') as HTMLSelectElement).value).toBe('arp')

    act(() => dialog.reactRoot.unmount())
  })

  it('notifies when no provider recognizes the URL', async () => {
    const info = jest.fn().mockResolvedValue(undefined)
    const dialog = new DataRepositoryConfigDialog(
      repository,
      [provider('arp')],
      { execute: jest.fn().mockResolvedValue({ supported: false }) } as any,
      { info } as any,
    ) as any

    await act(async () => {
      dialog.render()
      await dialog.handleAutoDetect()
    })

    expect(info).toHaveBeenCalledWith(
      'None of the installed repository providers could identify this URL.',
    )

    act(() => dialog.reactRoot.unmount())
  })
})
