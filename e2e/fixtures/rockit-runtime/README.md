<!--
******************************************************************************************
Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).

SPDX-License-Identifier: Apache-2.0
******************************************************************************************
-->

# RocKIT runtime fixtures

Each child directory is copied into the test's isolated `ROCKIT_ROOT_PATH`
before Electron starts. Keep these fixtures local and deterministic; never add
credentials, personal configuration, or remote-service dependencies.

`required-note-profile` drives profile validation, while
`global-author-profile` supplies the author relationship needed by the Global
Entity Library workflow.
