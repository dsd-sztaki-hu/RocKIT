<!--
******************************************************************************************
Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).

SPDX-License-Identifier: Apache-2.0
******************************************************************************************
-->

# Electron E2E tests

Place Playwright test files matching `*.e2e.spec.ts` here. Tests should verify
complete user-visible Electron workflows and observable disk results through
the shared fixtures and page objects.

`electron-startup.e2e.spec.ts` is the first smoke case. It verifies that the
isolated fixture workspace opens in the real Electron shell without startup or
renderer errors.

`electron-metadata-persistence.e2e.spec.ts` edits and saves the root dataset,
checks the temporary `ro-crate-metadata.json`, then relaunches Electron with
fresh application state and verifies the saved value in both the new renderer
and the file.

`electron-entity-lifecycle.e2e.spec.ts` creates, edits, and deletes a linked
Dataset through the UI, checks undo and redo for every mutation, and verifies
the saved graph and root reference on disk.

`electron-profile-validation.e2e.spec.ts` associates a locally seeded profile,
checks its required-field error, corrects the metadata through the editor, and
verifies the zero-error state and saved JSON without using the network.

`electron-file-omit-include.e2e.spec.ts` omits a real payload in the temporary
workspace, verifies its ignore rule and metadata removal without deleting the
file, then includes it back and verifies it remains intentionally undescribed.

`electron-metadata-recovery.e2e.spec.ts` accepts RocKIT's recovery action for
both missing and malformed metadata, then verifies the generated crate, preview,
ignore store, editor state, and preservation of the real local payload.

`electron-package-commands.e2e.spec.ts` creates and inspects a normal ZIP via a
mocked native Save dialog, then verifies the Electron-only reveal and system-
editor commands reach mocked main-process shell boundaries without opening OS
applications.

`electron-multi-edit.e2e.spec.ts` selects the root Dataset and a File through
the Structure tree, bulk-adds a shared description, verifies the operation is a
single undoable/redoable history change, then saves and relaunches to verify
both entities in the UI and on disk.

`electron-ai-review.e2e.spec.ts` writes two deterministic external suggestions
while Electron is running, accepts one and rejects the other through the real
review controls, then verifies the saved metadata and approval sidecar before
and after a fresh Electron launch.

`electron-property-chooser.e2e.spec.ts` opens the general Schema.org property
catalogue, confirms and disables its default entity-matching filter, then adds
an `issn` scalar and a `publisher` linked `Person`. It verifies both editor
shapes, the saved graph relationship, and their state after a fresh Electron
launch.

`electron-schema-management.e2e.spec.ts` registers and loads a custom JSON-LD
schema served by a test-owned localhost server, associates its scalar property
with the root Dataset, and verifies the saved value and context mapping. It
relaunches with the same Electron profile to confirm registry persistence,
removes the schema, and relaunches again to confirm the removal persists while
the crate metadata remains intact.

## Commands

- `yarn test:e2e` runs the Electron E2E suite normally.
- `yarn test:e2e:debug` runs the suite with Playwright's inspector and headed
  debugging.
- `yarn test:e2e:ui` opens Playwright's interactive UI mode.
- `yarn test:e2e:report` opens the most recently generated HTML report.
- `yarn test:e2e --repeat-each=3` runs the local three-pass stability check.

The suite exercises the built Electron application. Run `yarn build:electron`
first if the build is missing or stale.

Import `test` and `expect` from `../support/electron-app` so every case uses the
shared Electron lifecycle and isolated workspace fixtures.
