// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

export interface CrosswalkDocument extends Record<string, unknown> {
    id: string
    name: string
    displayName?: string
}

/** Application extensions contribute packaged defaults without storing user copies. */
export const BundledCrosswalk = Symbol('BundledCrosswalk')
export interface BundledCrosswalk {
    fileName: string
    document: CrosswalkDocument
}

export interface CrosswalkRegistryEntry {
    id: string
    name: string
    fileName: string
    sourceFileName: string
    importedAt?: string
    builtIn?: boolean
    repositories?: string[]
    ruleCount?: number
}

export interface CrosswalkRegistryIndex {
    version: 1
    crosswalks: CrosswalkRegistryEntry[]
}

export interface ParsedCrosswalk {
    document: CrosswalkDocument
    id: string
    name: string
}

export interface CrosswalkSummary {
    repositories: string[]
    ruleCount: number
}

const requiredString = (record: Record<string, unknown>, property: string): string => {
    const value = record[property]
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`The crosswalk must contain a non-empty \"${property}\" property.`)
    }
    return value.trim()
}

export const parseCrosswalk = (content: string): ParsedCrosswalk => {
    let value: unknown
    try {
        value = JSON.parse(content)
    } catch (error) {
        throw new Error(`The selected file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('The crosswalk JSON must contain an object at its top level.')
    }

    const document = value as CrosswalkDocument
    return {
        document,
        id: requiredString(document, 'id'),
        name: requiredString(document, 'name'),
    }
}

export const summarizeCrosswalk = (document: CrosswalkDocument): CrosswalkSummary => {
    const repositories = document.repositories &&
        typeof document.repositories === 'object' &&
        !Array.isArray(document.repositories)
        ? Object.keys(document.repositories).sort((left, right) => left.localeCompare(right))
        : []
    const crosswalks = document.crosswalks &&
        typeof document.crosswalks === 'object' &&
        !Array.isArray(document.crosswalks)
        ? Object.values(document.crosswalks)
        : []
    const ruleCount = crosswalks.reduce((total, value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return total
        const mappings = (value as Record<string, unknown>).mappings
        return total + (Array.isArray(mappings) ? mappings.length : 0)
    }, 0)
    return { repositories, ruleCount }
}
