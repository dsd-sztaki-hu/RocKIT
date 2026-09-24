// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

export const ROCKIT_IGNORE_DIR = '.rockit'
export const ROCKIT_IGNORE_FILE = 'ignored.txt'

export const RO_CRATE_METADATA_FILE = 'ro-crate-metadata.json'
export const RO_CRATE_PREVIEW_FILE = 'ro-crate-preview.html'
export const RO_CRATE_APPROVAL_FILE_NAME = 'ro-crate-approval.json'
export const RO_CRATE_APPROVAL_FILE = `${ROCKIT_IGNORE_DIR}/${RO_CRATE_APPROVAL_FILE_NAME}`

export const DEFAULT_IGNORED_ENTRIES = [
  RO_CRATE_PREVIEW_FILE,
  RO_CRATE_METADATA_FILE,
  RO_CRATE_APPROVAL_FILE_NAME,
  RO_CRATE_APPROVAL_FILE,
  'AGENTS.md',
  'CLAUDE.md',
  `${ROCKIT_IGNORE_DIR}/`,
] as const

export const DEFAULT_IGNORED_ROOT_FILES = [
  RO_CRATE_METADATA_FILE,
  RO_CRATE_PREVIEW_FILE,
  RO_CRATE_APPROVAL_FILE_NAME,
] as const
