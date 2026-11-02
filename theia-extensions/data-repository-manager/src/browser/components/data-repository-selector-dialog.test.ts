// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import 'reflect-metadata'
import { act } from 'react'

import { DataRepositorySelectorDialog } from './data-repository-selector-dialog'
import type { DataRepositoryConfig } from '../types'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const repository = (providerId?: string): DataRepositoryConfig => ({
  id: 'repository-1',
  title: 'Legacy repository',
  baseUrl: 'https://repository.example.org',
  providerId,
})

const renderDialog = (repositories: DataRepositoryConfig[]) => {
  const dialog = new DataRepositorySelectorDialog(
    repositories,
    {
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    } as any,
    {
      getProviderForRepository: jest.fn(),
      supports: jest.fn(() => false),
    } as any,
    { list: jest.fn(async () => []) } as any,
  ) as any

  act(() => dialog.render())
  return dialog
}

describe('DataRepositorySelectorDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('warns when a legacy repository has no repository type', () => {
    const dialog = renderDialog([repository()])
    const warning = dialog.contentNode.querySelector('[role="alert"]') as HTMLDivElement

    expect(warning).not.toBeNull()
    expect(warning.textContent).toContain('Repository type required')
    expect(warning.textContent).toContain(
      'Operations are unavailable for those repositories.',
    )

    act(() => dialog.reactRoot.unmount())
  })

  it('marks only repository rows that have no repository type', () => {
    const dialog = renderDialog([repository(), {
      ...repository('arp'),
      id: 'repository-2',
      title: 'Configured repository',
    }])
    const indicators = dialog.contentNode.querySelectorAll(
      '.data-repo-selector__missing-type-indicator',
    )

    expect(indicators).toHaveLength(1)
    expect(indicators[0].getAttribute('title')).toBe(
      'Repository type is missing from this repository configuration.',
    )
    expect(indicators[0].parentElement?.textContent).toContain('Legacy repository')

    act(() => dialog.reactRoot.unmount())
  })

  it('keeps the warning until every repository has a type', () => {
    const dialog = renderDialog([repository('arp'), {
      ...repository('   '),
      id: 'repository-2',
    }])

    expect(dialog.contentNode.querySelector('[role="alert"]')).not.toBeNull()

    dialog.repositories = [repository('arp'), {
      ...repository('dataverse'),
      id: 'repository-2',
    }]
    act(() => dialog.render())

    expect(dialog.contentNode.querySelector('[role="alert"]')).toBeNull()

    act(() => dialog.reactRoot.unmount())
  })
})
