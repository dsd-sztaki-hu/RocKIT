<!--
******************************************************************************************
Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).

SPDX-License-Identifier: Apache-2.0
******************************************************************************************
-->

# Codex implementation brief: RocKIT testing

> Use this entire document as the input prompt for a Codex session that improves
> testing in this repository. The unit-test phase was completed first and is
> retained below as an implementation record. The current phase is the bounded
> integration-test work described in the integration section; do not expand it
> into crosswalk, remote-service, or browser/Electron end-to-end work.

## Objective

Maintain the clear, fast, deterministic unit-test layer already established for
RocKIT, then build a separate integration layer for important filesystem,
process, HTTP, socket, and packaging boundaries.

The result should make it obvious:

- which tests are unit tests;
- which command runs them;
- which packages and behaviors they cover;
- which failures existed before the current batch; and
- what small, risk-ordered unit-testing batch should come next.

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
5. Integration work is limited to deterministic local filesystem workflows,
   MCP lifecycle/HTTP/socket checks, and standalone-package checks. Do not add
   browser/Electron end-to-end tests or tests against real remote services in
   this phase.
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

## Integration phase — in progress 2026-10-13

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

The planned deterministic local integration cases are now complete. Reassess
the remaining risk before adding another integration batch or considering
full browser/Electron automation.

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
- browser or Electron end-to-end tests;
- merged coverage reports or coverage thresholds;
- broad CI expansion unrelated to the unit and integration commands.

They can be planned after the local integration layer is understandable and
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
- the relevant narrow suite and root unit or integration command pass, or a
  clearly evidenced pre-existing failure is reported without being hidden;
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

Do not claim the application is fully tested. State precisely what the unit
and integration suites protect and which end-to-end risks remain deferred.
