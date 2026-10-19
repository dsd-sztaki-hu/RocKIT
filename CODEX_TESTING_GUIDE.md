<!--
******************************************************************************************
Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).

SPDX-License-Identifier: Apache-2.0
******************************************************************************************
-->

# Codex implementation brief: RocKIT testing

> Use this entire document as the input prompt for a Codex session that improves
> testing in this repository. The unit-test phase was completed first and is
> retained below as an implementation record. The integration phase is also
> complete. The current phase is the bounded Electron end-to-end work described
> below; do not expand it into crosswalk, remote-service, or browser-first work.

## Objective

Maintain the established unit and integration layers, then add a separate
Electron end-to-end layer for a small set of critical user workflows.

The result should make it obvious:

- which commands run each test layer;
- which packages, boundaries, and user workflows they cover;
- which failures existed before the current batch; and
- what small, risk-ordered testing batch should come next.

## Hard boundaries

1. Treat `dev-packages/recrate` as read-only. Do not edit, format, regenerate,
   or otherwise modify anything in that submodule, and do not change its
   submodule pointer. Its existing tests may be reported separately, but they
   are not part of this implementation phase or the root project-owned unit
   suite.
2. Leave the current Zenodo `imprint_publisher` crosswalk failure alone. Do not
   edit crosswalk sources, generated crosswalks, validation rules, review
   documents, or CI exceptions relating to that failure. Do not run the
   crosswalk check as part of the unit-test command.
3. Work only on project-owned files in this repository. Preserve unrelated
   user changes and inspect the worktree before editing.
4. Every new project-owned source or test file must begin with the repository's
   Apache 2.0 banner:

   ```text
   // ******************************************************************************************
   // Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd-sztaki.hu).
   //
   // SPDX-License-Identifier: Apache-2.0
   // ******************************************************************************************
   ```

   Preserve an original license banner when a file is copied from an upstream
   project under a different compatible license. Explain that provenance in the
   final report.
5. End-to-end work is limited to deterministic workflows in the real Electron
   application, using isolated temporary workspaces and Electron user data.
   Browser E2E is secondary and deferred until the Electron smoke and critical
   workflows are stable. Do not test against real remote services.
6. Do not use real API keys, credentials, user configuration, the developer's
   home directory, or public network services.

## What counts as a unit test in this phase

A unit test should exercise one class, function, service, or small component in
one process. It should replace external boundaries with controlled fakes or
mocks and should be safe to run repeatedly and offline.

Included:

- pure functions and transformations;
- service behavior with mocked Theia dependencies;
- React components rendered with small mocked providers;
- parsing, validation, state transitions, and error handling;
- deterministic promise/timer behavior with restored mocks;
- compact table-driven cases for important input variants.

Not included in the root unit command:

- child processes, CLI lifecycle, sockets, or loopback HTTP servers;
- package creation or installation;
- real filesystem workflows beyond a tightly controlled test double;
- full application startup;
- external services or public network calls;
- generated crosswalk validation;
- the ReCrate submodule's test suite.

Some existing scripts currently mix these categories. Classify them honestly;
do not call a script a unit suite merely because it is fast or already exists.

## Working method

1. Read the implementation before writing its tests. Test public behavior and
   observable effects rather than private implementation details.
2. At the beginning of each batch, run only the relevant existing package suite
   and record its baseline. Distinguish pre-existing failures from regressions.
3. Keep test files next to the established tests for that package and use its
   existing runner. Do not migrate runners as part of adding coverage.
4. Mock at external boundaries: Theia services, filesystem access, timers,
   `fetch`, secure storage, dialogs, downloads, child processes, and repository
   clients. Do not mock the behavior being tested.
5. Use small semantic assertions. Avoid large snapshots, generated output
   snapshots, or assertions that merely duplicate the implementation.
6. Prefer table-driven tests for validation and parsing edge cases. Use
   Arrange/Act/Assert comments only when a longer test benefits from them.
7. Cover success, meaningful boundary cases, and failure behavior. Add a
   regression test for every bug found during the work.
8. Restore spies, fake timers, global state, and mocks after each test. Do not
   use arbitrary sleeps.
9. Production changes are allowed only when a small behavior-preserving
   extraction or injected boundary is necessary for testability. Explain each
   such change.
10. After each batch, run the narrow package suite and the root unit suite. Stop
    and report if an unrelated failure prevents a trustworthy result.

## Current repository inventory

The suites currently invoked by the root `test:unit` command were inspected at
test-file level. A build or compile prerequisite does not determine the
classification; the exercised runtime boundary does.

| Package or suite | Classification | Root unit decision | Evidence |
| --- | --- | --- | --- |
| `dev-packages/recrate` | Out of scope | Exclude | Read-only external submodule under the current rules |
| `rocrate-context-core` | Unit | Include | Uses bundled contexts, in-memory graph data, and injected mock fetch functions |
| `app-state` | Unit | Include | Uses an in-memory storage fake and directly tests state, approvals, and history |
| `schema-validator` | Unit | Include | Tests validation functions/services with mocked managers; one case reads immutable local fixtures but does not test filesystem behavior |
| `ro-crate-editor` | Unit/component-unit | Include | Exercises language helpers, service behavior, and widget host logic with mocked Theia/ReCrate boundaries |
| `property-selector` | Unit/component-unit | Include | Tests the CSV parser and rendered widget with mocked `fetch` and message service |
| `metadata-profile-manager` | Unit | Include | Tests pure locale, path, and schema-URL transformations |
| `global-entity-library` | Unit | Include | Tests pure mapping JSON parsing and recovery behavior |
| `metadata-profile-core/test/test-core.js` | Integration | Exclude | Creates directories/files, mutates environment variables, and exercises an import/index/delete lifecycle |
| `cedar-to-rocrate` | Fixture-backed unit | Include | Converts immutable local input fixtures without network/process/application boundaries |
| `rockit-common/test/default-ro-crate.test.js` | Unit | Include | Uses an in-memory filesystem adapter and tests crate construction, normalization, and serialization |
| `file-explorer` navigator filter | Unit | Include | Pure table-driven glob filtering |
| `file-explorer` navigator diff | Integration | Exclude | Uses Theia `FileService` with `DiskFileSystemProvider` and real fixture paths |
| `file-preview` | Unit | Include | Uses dependency injection with a fake `FileService`; label logic is in memory |
| `agent-launcher` | Unit | Include | Tests pure URL handling and configuration parsing/matching without opening windows or writing configuration |

At the time of this inventory, the project-owned unit selection consists of 23
test files, approximately 122 named/generated cases, and the `rockit-common`
assertion script. The two project-owned files classified as integration are the
`metadata-profile-core` lifecycle script and `navigator-diff.spec.ts`.

This inventory exposes three corrections required for the root command:

1. remove the ReCrate invocation — completed on 2026-10-12;
2. remove `metadata-profile-core` from the unit command — completed on
   2026-10-12; and
3. split `file-explorer` so its navigator-filter unit cases remain while its
   real-disk navigator-diff cases move outside the unit command — completed on
   2026-10-12.

The file-explorer split exposed that the pure predicate test previously relied
on another spec initializing Theia first. The glob predicate was extracted to
`navigator-filter-predicate.ts`, retaining its upstream EPL/GPL license, so the
five unit cases now run independently without loading the Theia-dependent
filter service.

The isolation debt found during inventory was corrected on 2026-10-12:
`app-state` now restores the original `globalThis.window` descriptor, and
`property-selector` restores `global.fetch`, mocks the host-level Lumino update
boundary, and keeps asynchronous React work inside `act(...)`.

The following checks remained outside the completed unit phase and outside the
root unit command:

- MCP protocol, HTTP, socket, CLI, installer, and standalone-package scripts;
- metadata crosswalk generation and validation;
- packaging, complete application, and browser/Electron workflows.

## Current change audit

Changes already present in the worktree have the following relationship to
this unit-first plan:

- Adding runnable Jest scripts/configuration to `metadata-profile-manager` and
  `global-entity-library` supports this plan.
- Fixing the missing `profileManagerService` mock in the existing
  `ro-crate-editor` test supports this plan.
- Making the CEDAR test command compatible with the installed Node/tsx setup
  supports this plan.
- Adding the shared Theia test setup and package `pretest` compilation supports
  running the existing Mocha unit tests, though their runtime should be watched.
- The root `test:unit` command is now the canonical project-owned unit entry
  point. It excludes ReCrate, `metadata-profile-core`, and the real-disk
  navigator-diff spec.
- MCP `test:all` and the standalone-package lifecycle now belong to the focused
  root `test:integration:mcp` command and their own CI step. Crosswalk
  validation stays separate, and ReCrate coverage remains out of scope.
- Existing modifications inside `dev-packages/recrate` predate this rule. Do
  not touch, amend, revert, or build on them in this phase; report them as an
  out-of-scope dirty submodule.

## Unit-test priorities

Work in small batches. Do not scatter one superficial test across every
package.

### P0: establish a trustworthy unit command

- Completed on 2026-10-12: every suite currently invoked by root `test:unit`
  was classified at test-file level in the inventory above.
- Completed on 2026-10-12: `yarn test:unit` now runs only project-owned
  unit/component-unit suites and excludes ReCrate, crosswalks, MCP lifecycle
  tests, packaging, and long filesystem workflows.
- Completed on 2026-10-12: `yarn test` remains a simple alias for
  `yarn test:unit`.
- Completed on 2026-10-12: suites are chained with `&&`, so a package failure
  stops the command and propagates a non-zero status.
- Initial baseline on 2026-10-12: `yarn test:unit` passed across 12 workspaces
  with 122 named/generated tests plus the `rockit-common` assertion script in
  57.08 seconds. The focused file-explorer command passed five tests
  independently.
- Stabilized baseline on 2026-10-12: after restoring mutated globals and
  removing expected test-generated console noise, two consecutive
  `yarn test:unit` runs passed in 51.46 and 52.78 seconds with the same test
  counts. No React `act(...)` or application `console.error` warnings remained.

Yarn still reports that its preferred user cache is not writable in the
sandbox, and two packages report missing package-level license metadata. These
environment/metadata warnings do not indicate test failures and are not hidden
by the test configuration.

Do not add broad new test coverage until P0 is complete.

### P1: schema validation — completed 2026-10-12

Expand `schema-validator` with compact table-driven cases for:

- required values: `undefined`, `null`, blank strings, and empty arrays;
- single and multiple cardinality, including URL values;
- numbers including zero, negatives, bounds, `NaN`, and numeric strings;
- string length and regular-expression boundaries, including invalid regexes;
- missing IDs/types, multiple types, and File/Dataset name requirements;
- profile composition, missing profiles, and cached rules;
- targeted validation, cancellation, stale results, and localized errors.

This is the first new-coverage batch because it protects crate correctness and
is well suited to isolated unit tests.

Completed on 2026-10-12: `schema-validator` now has 44 passing unit cases
covering the boundary groups above, including profile composition/fallback,
compiled-rule caching, targeted updates, cancellation, and stale-run
replacement. The batch found and fixed three validator behaviors: optional
select values are now checked when present, zero participates in numeric bound
checks, and non-finite/non-numeric number values are rejected. The package test
and TypeScript build both pass, and all edited files retain their Apache-2.0
banner.

The repository-wide `yarn test:unit` verification also passed after this batch:
159 named/generated tests plus the `rockit-common` assertion script completed
in 51.06 seconds.

### P2: application state and editor host behavior — completed 2026-10-12

Extend `app-state` and `ro-crate-editor` tests for:

- dirty/baseline transitions around successful and failed saves;
- approval parsing, stale approvals, renamed entity IDs, and undo/redo;
- external-change decisions with deduplicated prompts;
- cleanup after errors and rejected promises;
- selection fallbacks, profile changes, validation navigation, and host callback
  failures.

Use mocked persistence and Theia services. Do not turn these into real
filesystem or full-editor integration tests.

Completed on 2026-10-12: `app-state` and `ro-crate-editor` each have 26 passing
unit cases. The batch covers successful/failed save baselines, legacy and stale
approval handling, renamed entity IDs across undo/redo, external-change actions
with concurrent-prompt deduplication, rejected-operation cleanup, entity
fallbacks, profile refreshes, targeted-validation failures, and validation
field navigation. It found and fixed stale approval records remaining under a
deleted entity ID after a rename; existing approvals now follow the live ID,
instead. Both package builds pass.

The repository-wide `yarn test:unit` verification passed after this batch: 178
named/generated tests plus the `rockit-common` assertion script completed in
55.64 seconds.

### P3: pure profile and conversion behavior — completed 2026-10-12

Add focused unit cases for project-owned profile logic:

- locale and regional-locale fallback;
- profile/schema URL normalization;
- CEDAR conversion of optional, repeated, multilingual, and malformed values;
- stable transformations that do not mutate input objects;
- corrupt or missing values represented through mocks rather than real storage.

Keep full import/index/delete lifecycle scenarios outside this phase.

Completed on 2026-10-12: `metadata-profile-manager` has 32 passing unit cases
and `cedar-template-converter` has 19. The batch covers regional-locale and
translation fallback, stable localized paths, blank/malformed schema
references, provider immutability, optional and repeated CEDAR fields,
multilingual text, malformed field data, deterministic output, and source-input
immutability. It found and fixed four pure-function behaviors: blank references
no longer produce empty fetch candidates, repeated localization no longer adds
duplicate language directories, regional Hungarian locales are recognized by
the converter, and missing Hungarian field text falls back to English. The
affected package builds pass.

The repository-wide `yarn test:unit` verification passed after this batch: 195
named/generated tests plus the `rockit-common` assertion script completed in
52.84 seconds.

### P4: small service and component units

Add isolated cases where risk justifies them:

- global entity parsing, duplicate handling, reconciliation, and write errors;
- property-selector fetch failure, malformed CSV, races, and keyboard behavior;
- file-preview labels and resource-property edge cases;
- agent configuration decision/merge logic without writing real config files;
- RocKIT-specific file filtering rules without launching the application.

Completed on 2026-10-12: `global-entity-library` has 8 passing cases for
collection normalization, transient-field removal, duplicate record replacement,
reconciliation with a unique existing record, and recovery after a mocked write
failure. `property-selector` has 12 cases covering quoted/escaped/multiline
CSV, malformed input, fetch failure, filtering, closing, and overlapping fetch
results. `file-preview` has 21 cases, including empty and URI-less selections.
`agent-launcher` has 7 cases for MCP parsing and remembered-setting
replacement/removal. The existing isolated navigator predicate suite has 5
passing glob-filter cases; its full metadata-name filter remains deferred
because importing the whole navigator service initializes framework
preferences, which would make this a framework-startup test rather than a
small unit.

This batch found and fixed two property-selector behaviors: comma-separated,
quoted CSV values were truncated, and an older fetch could overwrite a newer
result. The global-entity-library Jest configuration now uses jsdom and a
minimal `DragEvent` setup so browser service imports can be tested with mocked
boundaries.

The repository-wide `yarn test:unit` verification passed after this batch:
207 named/generated unit cases plus the `rockit-common` assertion script
completed in 61.42 seconds.

To run the same unit suites with a final workspace coverage table, use
`yarn test:unit --coverage`. Jest and Theia/Mocha suites write HTML reports
inside their own ignored `coverage/` directories. The table reports coverage
of files loaded by those unit tests; the Node-script suites without Istanbul
reports show `n/a`. It does not merge package coverage into one percentage or
include ReCrate.

## Integration phase — completed 2026-10-14

The integration layer has two explicit entry points. `yarn test:integration`
runs the RocKIT-owned application integration suites.
`yarn test:integration:mcp` runs only the pre-existing MCP core, CLI, HTTP,
socket, and standalone-package checks. Both are separate from unit tests and
crosswalk validation. `yarn test:all` runs unit, RocKIT integration, MCP
integration, and crosswalk commands in that order. CI also runs the two
integration commands as separate steps and keeps the known crosswalk failure
handling in its own step.

Completed integration steps:

1. Re-baselined the repository and identified the existing local integration
   boundaries without touching ReCrate or the crosswalk.
2. Defined the first application workflow as open, edit, save, and reopen an
   RO-Crate, including a failed metadata write followed by a successful retry.
3. Added that workflow as a real-temporary-filesystem Jest integration test and
   retained a focused root command for the existing MCP core, CLI, HTTP, socket,
   and standalone-package checks.
4. Consolidated the two previously orphaned integration suites—the
   `metadata-profile-core` import/index/delete lifecycle and the file-explorer
   navigator disk diff—under the same command. Added
   `yarn test:integration --coverage`, with separate HTML and JSON reports plus
   a final per-suite table.
5. Added loading-failure integration coverage for missing and malformed
   `ro-crate-metadata.json` files. Both cases use real temporary workspaces and
   verify state cleanup, invalid-state classification, recovery requests, and
   preservation of on-disk metadata.
6. Added partial-save coverage for an HTML preview write failing after metadata
   persistence. The test verifies that the edited JSON remains on disk, the app
   remains dirty, save guards and the load mask are released, and a retry
   creates the preview and marks the crate clean.
7. Added an entity-lifecycle workflow that records add, entity-ID rename, and
   delete transitions in history, persists the final graph, and reloads it into
   fresh state. The reopened crate retains the renamed entity and updated
   reference while the old ID, deleted file entity, and deleted `hasPart`
   reference remain absent.
8. Added undo/redo persistence coverage around the saved baseline. The test
   verifies clean/dirty transitions before and after saving, confirms that redo
   restores the saved state, and confirms a fresh reopen loads the saved crate
   without carrying session history across restarts.
9. Added profile-selection and validation coverage through persistence. The
   workflow saves a selected profile reference, reloads its converted rules
   into fresh application state, verifies the real validator reports the
   profile's missing required field, then saves the correction and verifies a
   second fresh reopen validates cleanly.
10. Added a real-local-file omission and inclusion workflow. It verifies that
    omission updates the ignore rules and removes the file entity and all
    references as one undoable transaction, persists both files, and survives
    reopen. Inclusion removes the persisted ignore rule without silently
    recreating metadata, while the physical workspace file remains untouched
    throughout the workflow.

The root integration command currently covers these local boundaries:

| Suite group | Boundary exercised |
| --- | --- |
| RO-Crate workflow | Real temporary workspace; missing/malformed loading, app state/history, metadata and preview persistence, profile validation, local-file include/omit rules, reopen, write failure, and retry |
| Metadata profiles | Real temporary profile storage; provider configuration and import/list/delete lifecycle |
| Navigator disk diff | Theia file service with a disk provider and local fixture files |

The separate MCP integration command covers core/CLI behavior, child-process
protocol, dashboard HTTP/authentication, Unix socket lifecycle, and standalone
package lifecycle.

Coverage percentages remain separate because the suite groups instrument
different code sets. They describe code loaded by each integration suite, not
whole-application coverage. Reports are ignored build artifacts under
`coverage/integration/<suite>/`.

The planned deterministic local integration cases are complete. The primary
Electron end-to-end phase begins below.

## Electron end-to-end phase — in progress 2026-10-14

Electron is RocKIT's primary application target, so `yarn test:e2e` will run
the Electron suite. Browser E2E is a later compatibility layer, not the first
implementation target.

Use `yarn test:e2e:debug` for Playwright's inspector, `yarn test:e2e:ui` for
its interactive runner, and `yarn test:e2e:report` to open the last HTML
report. These commands exercise the existing Electron build, so run
`yarn build:electron` first when it is missing or stale. E2E remains separate
from `test:all` because launching the desktop application is substantially
slower than the unit and integration suites.

The selected stack is Playwright Test plus Playwright's Electron API. Pin
`@playwright/test` and `playwright` to `1.61.1`, which retains the repository's
Node 18 compatibility, and pin `@theia/playwright` to the application's Theia
version, `1.65.2`. Use Theia page objects only where they operate cleanly on an
already-launched Electron renderer page; RocKIT owns the Electron process,
workspace, user-data, and artifact lifecycle.

The Electron suite must run with one worker because the application enables
single-instance mode. Every test gets a fresh temporary workspace, temporary
`ROCKIT_ROOT_PATH`, and temporary Electron user-data directory. It must never
read the developer's actual configuration, credentials, API keys, or home
directory. External network traffic is blocked or deterministically mocked.
Native Electron dialogs must be replaced through the Electron main process;
tests must not automate OS dialog UI.

Implementation sequence:

1. **Completed:** update this guide to make Electron the primary E2E target and
   define the isolation and scope rules.
2. **Completed:** add pinned Playwright and Theia Playwright dependencies while
   leaving browser-runtime installation to the later CI step.
3. **Completed:** add an Electron-oriented Playwright configuration with one
   worker, CI-only retry, bounded timeouts, list/HTML reporting, and retained
   failure artifacts. The Electron fixture will explicitly attach renderer
   screenshots, video, and traces because Playwright's built-in `page` fixture
   does not launch this application.
4. **Completed:** add the `e2e/fixtures`, `e2e/page-objects`, `e2e/support`, and
   `e2e/tests` structure, with licensed scope documentation and an Apache-2.0
   banner on every future TypeScript file.
5. **Completed:** implement a test-workspace fixture that copies immutable
   fixture data into a new temporary directory for every test and removes the
   copy after the test, including failed tests.
6. **Completed:** implement an Electron fixture using `_electron.launch()` with
   `electron-app/lib/backend/electron-main.js`, the temporary workspace path,
   a temporary `--electronUserData` path, and a temporary `ROCKIT_ROOT_PATH`.
   It captures renderer console/page errors, blocks external traffic, mocks
   native dialogs, retains failure artifacts, and always closes all processes.
7. **Completed:** add small RocKIT page objects for the application shell, file
   explorer, and RO-Crate editor, exposed through the Electron test's `rockit`
   fixture. They use Theia's helpers where compatible and otherwise prefer
   roles, labels, visible text, stable IDs, and semantic data attributes.
8. **Completed:** add the first smoke case: launch Electron, open the fixture
   workspace, wait for Theia and the RO-Crate editor, verify the root dataset
   and core shell, and fail on unexpected startup or renderer errors. Shared
   diagnostics have exact allowances for two existing Ant Design deprecations:
   `Button.Group` in the entities overview and `onFilterDropdownOpenChange` in
   the metadata-profile table. Remove each allowance when its component is
   migrated to the supported API.
9. **Completed:** add the first critical workflow: edit root metadata through
   the UI, invoke the application's Save command, verify the change reached
   `ro-crate-metadata.json`, close Electron, and relaunch the same workspace.
   The relaunch uses new Electron user-data, home, `ROCKIT_ROOT_PATH`, and
   process state, while retaining only the temporary workspace; both the new
   editor UI and the metadata file must contain the saved value. Shared error
   diagnostics now apply the same narrow startup-warning allowance to both
   permanent cases.
10. **Completed:** add a UI entity-lifecycle workflow using a Dataset linked
    through the root `hasPart` property. It verifies add/undo/redo,
    edit/undo/redo, and delete/undo/redo through the real Electron controls,
    then checks both the entity and its root reference are added to and removed
    from `ro-crate-metadata.json` after explicit saves. The page-object layer
    now includes Structure-tree navigation and focus-safe, cross-platform
    history shortcuts.
11. **Completed:** add a locally seeded profile-selection and validation-
    correction workflow. A dedicated isolated `ROCKIT_ROOT_PATH` fixture
    provides one indexed profile without network access, and a minimal
    workspace begins with zero errors. The test associates the profile through
    the selector, verifies its required-field error and profile tab, supplies
    the value through the editor, verifies validation returns to zero, saves,
    and checks both `conformsTo` and the corrected value on disk.
12. **Completed:** add a file-explorer omit/include workflow over the real
    `data.txt` payload in the copied temporary workspace. The test selects the
    file and invokes both explorer commands through Electron's command palette,
    verifies omitted styling and `.rockit/ignored.txt` persistence, confirms
    omission removes the File entity and root `hasPart` reference without
    deleting or changing the local file, then includes the file again. Inclusion
    removes the ignore rule and omitted styling while intentionally leaving the
    removed description absent, matching the application's explicit contract
    that include changes scope but does not manufacture metadata entities.
13. **Completed:** add two metadata-recovery workflows using isolated fixtures.
    One temporary workspace contains a real payload but no
    `ro-crate-metadata.json`; the other contains the payload plus intentionally
    malformed JSON. Each test verifies the correct recovery dialog and action,
    then confirms RocKIT writes a parseable crate containing its metadata
    descriptor, root Dataset, payload File, and root `hasPart` reference. They
    also verify the editor reloads the generated root, the preview and ignore
    store are created, and the original payload remains unchanged. The
    malformed case requires exactly the expected parsing diagnostic and rejects
    any additional renderer or main-process error.
14. **Completed:** add deterministic package and Electron-only command smoke
    coverage with the OS boundaries replaced in the Electron main process. The
    packaging case selects Normal Package through RocKIT's real dialog, records
    the native Save request, returns a path inside the isolated Electron home,
    and inspects the resulting ZIP to confirm it contains the workspace payload
    and metadata while excluding `.rockit`. A second case selects the real file
    in the explorer and exercises Reveal in Finder (or its platform equivalent)
    plus Open With System Editor. It verifies both commands send the exact local
    path to recorded `showItemInFolder` and `openExternal` calls while the test
    fixture prevents any OS window or external application from opening.
15. **Completed:** added root commands for normal (`yarn test:e2e`), debug
    (`yarn test:e2e:debug`), UI (`yarn test:e2e:ui`), and report
    (`yarn test:e2e:report`) modes. E2E remains separate from `test:all` while
    startup cost and stability are being established.
16. **Completed:** added a dedicated Linux CI job that installs dependencies,
    builds `electron-app`, and runs `yarn test:e2e` under Xvfb. It uses the
    suite's one-worker Playwright configuration and uploads the HTML report plus
    retained screenshots, videos, and traces for 14 days when the job fails.
17. **Completed:** audited the E2E support and page-object code and found no
    fixed test sleeps; waits are condition-based and the only timer is a
    bounded process-cleanup guard. Ran the complete suite three consecutive
    times with `yarn test:e2e --repeat-each=3`: all 27 executions passed in
    6.9 minutes without a failure. No Electron/Playwright process, temporary
    workspace, or temporary runtime remained afterward, and repeated launches
    did not encounter a single-instance conflict. The dedicated Linux CI job
    remains the independent confirmation of runner-specific stability before
    considering a secondary browser E2E project.

### Electron feature-breadth batch — in progress 2026-10-16

1. **Completed:** added a Multi Edit workflow over the root Dataset and a File.
   It uses the Structure tree's real multi-selection and context menu, enables
   schema.org properties in the dialog, and applies one shared description to
   both entities. The test verifies the processed/updated/applied counts, that
   one undo and redo affect both entities, the saved JSON, and both values after
   relaunch with fresh Electron state. The focused case passed three consecutive
   final-code runs. On macOS and Linux, failure-path process cleanup now also
   captures Electron's descendant processes before shutdown and terminates only
   survivors, avoiding an orphaned Theia backend when a test fails with a dialog
   open.
2. **Completed:** added deterministic AI-review coverage driven by the real
   external-metadata watcher. The test auto-reloads two externally generated
   root Dataset changes, accepts the new description, rejects the suggested
   name, and verifies the resulting metadata plus the approved-only
   `.rockit/ro-crate-approval.json` sidecar. A fresh Electron launch confirms
   the accepted value and AI-edited marker persist while the rejected value and
   pending-review controls do not. The focused final-code case passed three
   consecutive runs, and the complete 11-test Electron suite passed in 4.3
   minutes. The regression run also exposed and fixed a transient-read race in
   the existing profile-validation disk assertion so its poll retries while
   metadata is being rewritten.
3. **Completed:** added the general schema-property chooser workflow for scalar
   and entity-valued properties. The test confirms the chooser defaults to the
   Schema.org catalogue and entity-matching filter, disables that filter to use
   the general catalogue, searches for and adds an `issn` `Text` value, then
   searches for and adds a `publisher` linked `Person`. It verifies the two
   editor shapes, saved scalar and graph relationship, and both values after a
   fresh Electron launch. The focused final-code case passed three consecutive
   runs, and the complete 12-test Electron suite passed in 3.8 minutes.
4. **Completed:** added a fully local schema-management workflow. A test-owned
   HTTP server supplies deterministic JSON-LD while the real Electron UI
   registers and loads the schema, filters the property chooser to it, and adds
   its custom scalar property to the root Dataset. The test verifies the saved
   value and exact JSON-LD context mapping, relaunches with the same Electron
   profile to confirm the schema registry persists, removes the schema, and
   relaunches again to confirm removal persists without deleting the crate's
   existing metadata association. The focused final-code case passed three
   consecutive runs. The shared readiness helper now gives Theia's preload
   phase a targeted 45-second allowance after a repeat run exposed the previous
   library-default 15-second startup limit. The complete 13-test Electron suite
   passed in 4.6 minutes.
5. **Deferred:** repository connection management will be tested after its
   planned refactor; do not add E2E coverage for the current implementation.
6. **Completed:** added an offline Global Entity Library workflow backed by a
   test-owned local author profile. The test creates an author through the real
   library UI, verifies the persisted global record, selects it from the
   editor's dedicated `Global entities` lookup group, and verifies the saved
   graph relationship plus workspace-local record mapping and synchronization
   hash. A relaunch with the same isolated Electron profile confirms that the
   library record, crate relationship, and mapping all persist. Both new
   TypeScript files carry the Apache-2.0 banner; immutable JSON profile fixtures
   follow the existing fixture-data convention and are documented in the
   fixture READMEs. The focused final-code case passed three consecutive runs
   in 2.8 minutes, and the expanded 14-test Electron suite passed in 8.5
   minutes.
7. **Completed:** added an offline data-source registration workflow through
   Electron's mocked native folder picker. The test creates an external folder
   and CSV payload inside the isolated Electron home, invokes the real `Add New
   Data Source` command, and verifies the dialog requested a single directory
   and returned the exact controlled path. It checks the separate `Data
   Sources` explorer group, expands the registered root, verifies its payload,
   and confirms the exact folder URI was persisted through Theia storage while
   the source file and RO-Crate metadata remained unchanged. A relaunch with
   the same isolated Electron profile confirms the source root, payload, and
   stored URI remain available. The focused final-code case passed three
   consecutive runs in 2.1 minutes, and the expanded 15-test Electron suite
   passed in 8.9 minutes, including the existing save-dialog and OS-shell
   boundary cases.
8. **Completed locally; Linux confirmation pending the next pushed CI run:**
   ran the expanded suite three consecutive times with
   `yarn test:e2e --repeat-each=3`. All 45 executions passed on their first
   attempt in 27.2 minutes, with no retry, failure artifact, orphaned E2E
   Electron/Playwright process, temporary workspace, or temporary runtime left
   behind. CI-mode discovery lists all 15 tests, and all 30 E2E TypeScript files
   pass Biome; the intentionally malformed JSON recovery fixture remains
   excluded from parse/format validation by design. Re-audited the existing
   Linux job: it builds Electron, runs the same complete `yarn test:e2e` command
   under Xvfb with one worker, has a 15-minute Playwright limit inside a
   45-minute job limit, and uploads failure artifacts. The current 8.9-minute
   single-suite baseline fits those limits. Because this expanded suite exists
   only in the local worktree, do not claim a Linux pass until the first GitHub
   Actions run after these changes are committed and pushed; record that run's
   result here when available.

## Techniques to use

- **Equivalence partitions and boundary values:** validation, cardinality,
  locales, URL/path inputs, empty/missing/malformed data.
- **Decision tables:** combinations of dirty state, save result, approval state,
  and user decisions.
- **State-transition tests:** load/edit/save/fail and approve/reject/undo/redo
  behavior with mocked persistence.
- **Parameterized tests:** many compact input/output cases sharing one rule.
- **Metamorphic properties:** an empty update is identity, repeated
  normalization is stable, and a transformation does not mutate its input.
- **Fault injection:** rejected dependencies, malformed responses, and timeout
  or cancellation paths with deterministic mocks.
- **Component tests:** user-level roles, labels, visible outcomes, focus, and
  callbacks rather than CSS classes or component internals.

Property-based tests may be introduced only for a pure critical function where
they add clear value, use a fixed/reported seed, and do not add excessive
runtime or dependency weight.

## Deferred work

Do not implement these items while following this guide:

- ReCrate test additions or coverage work;
- the known Zenodo crosswalk decision;
- tests against real remote repository or search services;
- browser E2E tests before the Electron suite is stable;
- packaged-distribution E2E before the development Electron bundle is stable;
- merged coverage reports or coverage thresholds;
- broad CI expansion unrelated to the unit and integration commands.

They can be planned after the primary Electron E2E layer is understandable and
stable.

## Definition of done for a testing batch

A batch is complete only when:

- every new file has the correct license banner;
- no file or pointer under `dev-packages/recrate` was changed;
- the crosswalk files and known error were untouched;
- tests demonstrate observable behavior rather than implementation details;
- success, important boundaries, and relevant failures are covered;
- tests are deterministic, offline, isolated, and restore all mocks/state;
- the narrow package suite passes;
- the relevant narrow suite and root unit, integration, or E2E command pass, or
  a clearly evidenced pre-existing failure is reported without being hidden;
- exact commands and test counts are recorded.

## Final report expected from Codex

Report:

1. the testing batch completed and why it was chosen;
2. files changed and behaviors covered;
3. exact commands run, suite/case counts, and results;
4. pre-existing failures or environment limitations;
5. any production extraction made for testability;
6. confirmation that ReCrate and the crosswalk were untouched; and
7. the next smallest risk-ordered testing batch.

Do not claim the application is fully tested. State precisely what the unit,
integration, and Electron E2E suites protect and which risks remain deferred.
