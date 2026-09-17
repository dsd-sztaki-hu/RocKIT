// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// src/browser/save-ro-crate-protocol.ts

export const RoCrateHtmlGenerator = Symbol('RoCrateHtmlGenerator')

export interface RoCrateHtmlGenerator {
  generate(data: any): string
}
