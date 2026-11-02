// Copyright (C) 2026 SZTAKI. SPDX-License-Identifier: Apache-2.0

describe.each(['arp', 'dataverse', 'zenodo'])('%s progress transport', (providerId) => {
  const { withRepositoryProgress, withRepositoryInput } = require(
    `../../${providerId}-repository-provider/src/repository-progress`,
  )
  const context = {
    operationId: 'operation-1',
    providerId,
    commandId: 'rockit.repositories.reportProgress',
  }

  it('reports ordered progress to the app without displaying plugin notifications', async () => {
    const executeCommand = jest.fn().mockResolvedValue(undefined)
    const withProgress = jest.fn()
    const vscode = { commands: { executeCommand }, window: { withProgress } }
    const result = await withRepositoryProgress(
      vscode,
      providerId,
      { progressContext: context },
      {},
      async (progress) => {
        progress.report({ message: 'Uploading first', completedSteps: 0, totalSteps: 2 })
        progress.report({ message: 'Uploading second', completedSteps: 1, totalSteps: 2 })
        return 'done'
      },
    )
    expect(result).toBe('done')
    expect(withProgress).not.toHaveBeenCalled()
    expect(executeCommand.mock.calls.map((call) => call[1].message)).toEqual([
      'Uploading first',
      'Uploading second',
    ])
    expect(executeCommand.mock.calls[1]).toEqual([
      context.commandId,
      expect.objectContaining({
        operationId: context.operationId,
        providerId,
        completedSteps: 1,
        totalSteps: 2,
      }),
    ])
  })

  it('keeps notification progress for callers without the application bridge', async () => {
    const withProgress = jest.fn(async (_options, task) => task({ report() {} }))
    await withRepositoryProgress(
      { window: { withProgress } },
      providerId,
      {},
      {},
      async () => 'done',
    )
    expect(withProgress).toHaveBeenCalledTimes(1)
  })

  it('does not fail repository work if the reporting channel fails', async () => {
    const vscode = {
      commands: {
        executeCommand: jest.fn().mockRejectedValue(new Error('Disconnected')),
      },
    }
    await expect(
      withRepositoryProgress(
        vscode,
        providerId,
        { progressContext: context },
        {},
        async (progress) => {
          progress.report({ message: 'Working' })
          return 'success'
        },
      ),
    ).resolves.toBe('success')
  })

  it('reports the input lifecycle even if the user cancels with an error', async () => {
    const progress = { report: jest.fn() }
    await expect(
      withRepositoryInput(progress, async () => {
        throw new Error('Cancelled')
      }),
    ).rejects.toThrow('Cancelled')
    expect(progress.report.mock.calls).toEqual([
      [{ awaitingInput: true }],
      [{ awaitingInput: false }],
    ])
  })
})
