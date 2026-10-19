<!--
******************************************************************************************
Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).

SPDX-License-Identifier: Apache-2.0
******************************************************************************************
-->

# E2E fixture data

Store immutable input workspaces and other static Electron E2E data here.
Tests must copy fixture data into a fresh temporary directory before launching
RocKIT and must never modify these source fixtures.

Fixtures must not contain credentials, API keys, developer configuration, or
data that requires a public network service.

`basic-ro-crate` is the default seed. It contains a minimal valid RO-Crate and
a local payload file; keep it small and deterministic.

`profile-validation-ro-crate` is a root-only crate with zero initial validation
errors. `rockit-runtime/required-note-profile` is copied separately into an
isolated `ROCKIT_ROOT_PATH` and provides the local profile used by the profile
selection test.

`rockit-runtime/global-author-profile` provides the local `author` class and
Dataset property used to exercise Global Entity Library selection without a
remote profile service.

`recovery-missing-ro-crate` contains a payload but no metadata file.
`recovery-malformed-ro-crate` contains the same kind of payload plus
intentionally invalid JSON. Recovery tests operate only on temporary copies.
