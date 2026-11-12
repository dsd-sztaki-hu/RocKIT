# Changelog

All notable changes to RocKIT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changes listed under **Unreleased** are planned for version 1.1.0.

## [Unreleased]

### Added

- Added a plugin-based repository provider architecture for ARP, Dataverse, and
  Zenodo integrations.
- Added automatic repository type detection and an option to trigger detection
  when adding a repository.
- Added a crosswalk registry and default crosswalk definitions for transforming
  metadata during repository operations.
- Added progress reporting for repository plugin operations.
- Added unit, integration, and end-to-end test coverage for repository and
  crosswalk workflows.

### Changed

- Upgraded Eclipse Theia from 1.65.2 to 1.76.0.
- Moved repository browsing, import, export, synchronization, linking, update,
  and draft deletion operations into repository provider plugins.
- Made repository integrations capability-driven so that RocKIT only presents
  operations supported by the selected provider.
- Moved the Plugins menu action to the Visual Studio Code-compatible extension
  view.
- Improved repository status feedback, including warnings when a repository
  type is missing.

### Deprecated

### Removed

- Removed the legacy repository implementations built into the core
  application after their operations were moved to provider plugins.
- Removed the obsolete test repository provider.

### Fixed

- Restored lazy Dataverse tree browsing and name-only filtering.
- Restored application update checks by allowing requests to the GitHub API.
- Fixed localization issues in menu items.
- Fixed Windows compatibility issues in unit, integration, MCP, and end-to-end
  tests.
- Fixed OpenCode detection and MCP configuration compatibility on Windows.
- Fixed the dataset selection styling and several repository warning states.

### Security

## [1.0.10] - 2026-10-02

This is the baseline release from which the changelog is maintained. For changes
in this and earlier releases, see the Git history.

[Unreleased]: https://github.com/dsd-sztaki-hu/RocKIT/compare/v1.0.10...HEAD
[1.0.10]: https://github.com/dsd-sztaki-hu/RocKIT/releases/tag/v1.0.10
