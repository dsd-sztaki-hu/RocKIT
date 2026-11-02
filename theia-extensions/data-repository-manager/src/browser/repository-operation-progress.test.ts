// Copyright (C) 2026 SZTAKI. SPDX-License-Identifier: Apache-2.0
import 'reflect-metadata'
import { act } from 'react'
import { LoadMaskContribution } from 'rockit-loadmask/lib/browser/loadmask-contribution'
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service'
import {
  PROGRESS_OPERATIONS,
  RepositoryOperationProgressService,
} from './repository-operation-progress'

const repository = {
  id: 'arp-connection',
  providerId: 'arp',
  title: 'ARP',
  baseUrl: 'https://repo.example',
}

function fixture() {
  const masks = new LoadMaskService()
  const service = new RepositoryOperationProgressService()
  Object.assign(service, { loadMaskService: masks })
  return { service, masks }
}

describe('application-owned repository progress', () => {
  it('renders reported status and work counts in the application overlay and releases the shell for input', async () => {
    const { service, masks } = fixture()
    const shellNode = document.createElement('div')
    document.body.appendChild(shellNode)
    // Theia dialogs are body portals, not descendants of the application shell.
    const portal = document.createElement('div')
    portal.className = 'dialogOverlay'
    const closeButton = document.createElement('button')
    closeButton.textContent = 'Close repository operations'
    const onClose = jest.fn()
    closeButton.addEventListener('click', onClose)
    portal.appendChild(closeButton)
    document.body.appendChild(portal)
    const latePortal = document.createElement('div')
    const alreadyInert = document.createElement('div')
    alreadyInert.setAttribute('inert', 'original')
    document.body.appendChild(alreadyInert)
    const onBackgroundKey = jest.fn()
    document.body.addEventListener('keydown', onBackgroundKey)
    const contribution = new LoadMaskContribution()
    Object.assign(contribution, { loadMaskService: masks })
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean
    }
    const previousEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    try {
      await act(async () => contribution.onStart({ shell: { node: shellNode } } as never))
      const maskHost = document.getElementById('rockit-loadmask-host')
      maskHost?.setAttribute('inert', '')
      let operation!: ReturnType<RepositoryOperationProgressService['begin']>
      await act(async () => {
        operation = service.begin(repository, 'update')
      })
      await act(async () =>
        service.report({
          ...operation.context,
          message: 'Replacing example.csv',
          completedSteps: 2,
          totalSteps: 5,
        }),
      )
      expect(document.querySelector('#rockit-loadmask-message')?.textContent).toBe(
        'Replacing example.csv',
      )
      expect(
        document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
      ).toBe('2')
      expect(shellNode.getAttribute('aria-busy')).toBe('true')
      expect(portal.hasAttribute('inert')).toBe(true)
      expect(maskHost?.hasAttribute('inert')).toBe(false)
      closeButton.click()
      expect(onClose).not.toHaveBeenCalled()
      closeButton.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
      document.querySelector('.rockit-loadmask-overlay')?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      )
      expect(onBackgroundKey).not.toHaveBeenCalled()
      await act(async () => {
        document.body.appendChild(latePortal)
        maskHost?.setAttribute('inert', '')
      })
      expect(latePortal.hasAttribute('inert')).toBe(true)
      expect(maskHost?.hasAttribute('inert')).toBe(false)
      closeButton.focus()
      expect(
        document.getElementById('rockit-loadmask-host')?.contains(document.activeElement),
      ).toBe(true)
      await act(async () => service.report({ ...operation.context, awaitingInput: true }))
      expect(document.querySelector('.rockit-loadmask-overlay')).toBeNull()
      expect(shellNode.hasAttribute('inert')).toBe(false)
      expect(portal.hasAttribute('inert')).toBe(false)
      expect(latePortal.hasAttribute('inert')).toBe(false)
      expect(alreadyInert.getAttribute('inert')).toBe('original')
      await act(async () =>
        service.report({ ...operation.context, awaitingInput: false }),
      )
      expect(document.querySelector('.rockit-loadmask-overlay')).not.toBeNull()
      await act(async () => operation.dispose())
      expect(document.querySelector('.rockit-loadmask-overlay')).toBeNull()
      closeButton.click()
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => contribution.onStop())
      shellNode.remove()
      portal.remove()
      latePortal.remove()
      alreadyInert.remove()
      document.body.removeEventListener('keydown', onBackgroundKey)
      document.getElementById('rockit-loadmask-host')?.remove()
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousEnvironment
    }
  })
  it('keeps the overlay cancellation control usable while background dialogs are blocked', async () => {
    const { masks } = fixture()
    const shellNode = document.createElement('div')
    document.body.appendChild(shellNode)
    const contribution = new LoadMaskContribution()
    Object.assign(contribution, { loadMaskService: masks })
    const environment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean
    }
    const previous = environment.IS_REACT_ACT_ENVIRONMENT
    environment.IS_REACT_ACT_ENVIRONMENT = true
    const onCancel = jest.fn()
    try {
      await act(async () => contribution.onStart({ shell: { node: shellNode } } as never))
      let handle!: ReturnType<LoadMaskService['show']>
      await act(async () => {
        handle = masks.show({ message: 'Working', delay: 0, onCancel })
      })
      const cancel = document.querySelector<HTMLButtonElement>('.rockit-loadmask-cancel')
      expect(cancel).not.toBeNull()
      cancel?.focus()
      await act(async () => {
        cancel?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        )
      })
      expect(onCancel).toHaveBeenCalledTimes(1)
      await act(async () => handle.dispose())
    } finally {
      await act(async () => contribution.onStop())
      shellNode.remove()
      document.getElementById('rockit-loadmask-host')?.remove()
      environment.IS_REACT_ACT_ENVIRONMENT = previous
    }
  })
  it.each([...PROGRESS_OPERATIONS])(
    'keeps the %s overlay open through local completion',
    async (operation) => {
      const { service, masks } = fixture()
      let finishLocal!: () => void
      const localWork = new Promise<void>((resolve) => {
        finishLocal = resolve
      })
      const task = service.run(repository, operation, async () => {
        const context = service.contextFor(repository, operation)
        if (!context) throw new Error('Repository progress session was not created')
        service.report({
          ...context,
          message: 'Uploading example.csv',
          completedSteps: 2,
          totalSteps: 5,
        })
        expect(masks.state).toMatchObject({
          visible: true,
          message: 'Uploading example.csv',
          progress: { worked: 2, total: 5 },
        })
        await localWork
        return 'complete'
      })
      expect(masks.state.visible).toBe(true)
      finishLocal()
      await expect(task).resolves.toBe('complete')
      expect(masks.state.visible).toBe(false)
      expect(service.contextFor(repository, operation)).toBeUndefined()
    },
  )

  it('isolates operations and ignores stale or mismatched reports', () => {
    const { service, masks } = fixture()
    const first = service.begin(repository, 'update')
    const second = service.begin({ ...repository, id: 'other' }, 'update')
    service.report({ ...second.context, providerId: 'zenodo', message: 'Wrong provider' })
    expect(masks.state.message).not.toBe('Wrong provider')
    first.dispose()
    service.report({ ...first.context, message: 'Late upload' })
    expect(masks.state.message).not.toBe('Late upload')
    expect(masks.state.activeCount).toBe(1)
    second.dispose()
  })

  it('hides the overlay for plugin input and restores it for the next stage', () => {
    const { service, masks } = fixture()
    const handle = service.begin(repository, 'import')
    service.report({ ...handle.context, awaitingInput: true })
    expect(masks.state.visible).toBe(false)
    service.report({
      ...handle.context,
      awaitingInput: false,
      message: 'Downloading archive',
    })
    expect(masks.state).toMatchObject({ visible: true, message: 'Downloading archive' })
    handle.dispose()
  })

  it('restores application progress after a metadata prompt fails', async () => {
    const { service, masks } = fixture()
    const handle = service.begin(repository, 'create')
    await expect(
      service.withUserInput(async () => {
        expect(masks.state.visible).toBe(false)
        throw new Error('Prompt cancelled')
      }),
    ).rejects.toThrow('Prompt cancelled')
    expect(masks.state.visible).toBe(true)
    handle.dispose()
  })

  it('closes the overlay on failure and allows a retry', async () => {
    const { service, masks } = fixture()
    await expect(
      service.run(repository, 'sync', async () => {
        throw new Error('Offline')
      }),
    ).rejects.toThrow('Offline')
    expect(masks.state.visible).toBe(false)
    await service.run(repository, 'sync', async () => undefined)
    expect(masks.state.activeCount).toBe(0)
  })

  it('uses indeterminate progress for messages without valid work counts', () => {
    const { service, masks } = fixture()
    const handle = service.begin(repository, 'update')
    service.report({ ...handle.context, completedSteps: 5, totalSteps: 10 })
    service.report({
      ...handle.context,
      message: 'Saving local metadata',
      completedSteps: NaN,
      totalSteps: 0,
    })
    expect(masks.state.progress).toBeUndefined()
    handle.dispose()
  })
})
