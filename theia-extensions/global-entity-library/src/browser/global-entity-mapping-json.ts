// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// The mapping is derived from the current crate and the global library, so an
// empty or interrupted write can be rebuilt safely during reconciliation.
export const parseGlobalEntityMappingJson = (content: string): unknown => {
    const normalizedContent = content.trim()
    if (!normalizedContent) return {}
    try {
        return JSON.parse(normalizedContent)
    } catch (error) {
        if (error instanceof SyntaxError) return {}
        throw error
    }
}
