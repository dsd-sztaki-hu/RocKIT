// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import 'reflect-metadata'
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DataverseTree from './dataverse-tree'

const repository: any = { id: 'repo', title: 'ARP', providerId: 'arp' }
const parent = { id: 'sztaki', label: 'SZTAKI', hasChildren: true }
const child = { id: 'aroma', label: 'AROMA 2.0 test', hasChildren: false }

function setup() {
    const service: any = {
        supports: () => true,
        executeForRepository: jest.fn(async (_repo, operation, input) => {
            if (operation === 'checkDestination') return { selectable: true }
            if (operation === 'searchDestinations') return { destinations: [parent, child] }
            return { destinations: input.parentId ? [child] : [parent] }
        })
    }
    const onSelected = jest.fn()
    const view = render(React.createElement(DataverseTree, {
        repository, providerService: service, onCollectionSelected: onSelected,
    }))
    return { service, onSelected, ...view }
}

const expand = async (label: string) => {
    await act(async () => {});
    const item = screen.getByText(label).closest('[role="treeitem"]')!
    await act(async () => { fireEvent.click(item.querySelector('.MuiTreeItem-iconContainer svg')!) })
}

describe('DataverseTree lazy browsing', () => {
    it('loads children on expansion, caches them, and selects using the repository alias', async () => {
        const { service, onSelected } = setup()
        await screen.findByText('SZTAKI')
        expect(service.executeForRepository).toHaveBeenCalledTimes(1)
        expect(screen.queryByText('AROMA 2.0 test')).toBeNull()
        await expand('SZTAKI')
        expect(service.executeForRepository.mock.calls.map((call: any[]) => call.slice(1))).toEqual([
            ['listDestinations', { repository }], ['listDestinations', { repository, parentId: 'sztaki' }],
        ])
        await screen.findByText('AROMA 2.0 test')
        expect(service.executeForRepository).toHaveBeenLastCalledWith(repository, 'listDestinations', {
            repository, parentId: 'sztaki',
        })
        await expand('SZTAKI')
        await expand('SZTAKI')
        expect(service.executeForRepository).toHaveBeenCalledTimes(2)
        fireEvent.click(screen.getByText('AROMA 2.0 test'))
        await waitFor(() => expect(onSelected).toHaveBeenCalledWith({
            id: 'aroma', alias: 'aroma', name: 'AROMA 2.0 test', isWritable: true,
        }))
    })

    it('expands name-search matches and restores the original tree when cleared', async () => {
        const { service } = setup()
        await screen.findByText('SZTAKI')
        fireEvent.click(screen.getByRole('button'))
        const input = screen.getByPlaceholderText('Search collection names...')
        fireEvent.change(input, { target: { value: 'SZTAKI' } })
        await waitFor(() => expect(service.executeForRepository).toHaveBeenCalledWith(
            repository, 'searchDestinations', { repository, query: 'SZTAKI' },
        ))
        await screen.findByText('AROMA 2.0 test')
        await expand('SZTAKI')
        // A result can also occur under a matching parent: MUI item IDs must be unique.
        await waitFor(() => expect(screen.getAllByText('AROMA 2.0 test')).toHaveLength(2))
        fireEvent.change(input, { target: { value: '' } })
        await waitFor(() => expect(screen.queryByText('AROMA 2.0 test')).toBeNull())
        expect(screen.getByText('SZTAKI')).toBeTruthy()
    })

    it('supports keyboard expansion before children have been loaded', async () => {
        const { service } = setup()
        await screen.findByText('SZTAKI')
        const item = screen.getByText('SZTAKI').closest('[role="treeitem"]')!
        await act(async () => { fireEvent.keyDown(item, { key: 'ArrowRight' }) })
        await screen.findByText('AROMA 2.0 test')
        expect(service.executeForRepository).toHaveBeenCalledTimes(2)
    })

    it('removes the expansion arrow when a possible branch contains no collections', async () => {
        const { service } = setup()
        await screen.findByText('SZTAKI')
        service.executeForRepository.mockResolvedValueOnce({ destinations: [] })
        await expand('SZTAKI')
        await waitFor(() => {
            const item = screen.getByText('SZTAKI').closest('[role="treeitem"]')!
            expect(item.hasAttribute('aria-expanded')).toBe(false)
        })
    })
})
