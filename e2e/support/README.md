<!--
******************************************************************************************
Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).

SPDX-License-Identifier: Apache-2.0
******************************************************************************************
-->

# E2E support code

Keep Electron launch, temporary-workspace, artifact, and cleanup helpers here.
Support code must isolate the workspace, Electron user-data directory, and
`ROCKIT_ROOT_PATH` for every test and must reliably stop launched processes.

Import `test` and `expect` from `test-workspace.ts` in E2E cases that need an
isolated copy of a fixture workspace.

Electron tests should instead import `test` and `expect` from `electron-app.ts`.
Its `electronApp`, `appPage`, `electronDiagnostics`, `electronRuntime`, and
`rockit` fixtures launch the built desktop application with isolated runtime
storage, blocked external traffic, deterministic native dialogs, failure
artifacts, bounded process cleanup, and shared RocKIT page objects.

The `electronRuntime.restartWithFreshState()` helper closes the current
Electron process and relaunches the same temporary workspace with new Electron
user-data, home, and RocKIT configuration directories. Use the returned page
objects after relaunch; page objects from the prior renderer are intentionally
stale.

Set `electronSaveDialogFileName` to a plain file name when a test needs the
native Save dialog to return a deterministic path inside the temporary Electron
home. `electronRuntime.readMainProcessInteractions()` reports native Save
dialog requests plus mocked `openExternal` and `showItemInFolder` calls. These
boundaries never open real OS dialogs or applications during E2E tests.

Set the `rockitRuntimeFixtureName` test option to copy a named fixture from
`e2e/fixtures/rockit-runtime` into every fresh `ROCKIT_ROOT_PATH`. Tests that do
not set it retain an empty runtime root and cannot inherit seeded profiles.
