// Copyright (C) 2026 SZTAKI. SPDX-License-Identifier: Apache-2.0

const REPORT_PROGRESS = 'rockit.repositories.reportProgress'

/** Transport progress to the caller; presentation remains the application's job. */
async function withRepositoryProgress(vscode, providerId, input, options, task) {
  const context = input?.progressContext
  if (
    !context ||
    context.providerId !== providerId ||
    typeof context.operationId !== 'string' ||
    context.commandId !== REPORT_PROGRESS
  ) {
    return vscode.window.withProgress(options, task)
  }
  let pending = Promise.resolve()
  const progress = {
    report(update = {}) {
      // Serialize reports so a late message cannot overtake a newer phase.
      pending = pending
        .then(() =>
          vscode.commands.executeCommand(REPORT_PROGRESS, {
            operationId: context.operationId,
            providerId,
            message: update.message,
            completedSteps: update.completedSteps,
            totalSteps: update.totalSteps,
            awaitingInput: update.awaitingInput,
          }),
        )
        .catch(() => undefined)
      return pending
    },
  }
  try {
    return await task(progress)
  } finally {
    await pending
  }
}

async function withRepositoryInput(progress, task) {
  await progress.report({ awaitingInput: true })
  try {
    return await task()
  } finally {
    await progress.report({ awaitingInput: false })
  }
}

module.exports = { withRepositoryProgress, withRepositoryInput }
