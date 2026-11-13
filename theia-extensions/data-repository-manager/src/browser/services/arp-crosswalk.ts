// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { CrosswalkDocument } from 'crosswalk-manager/lib/browser/crosswalk-manager-types'

interface ArpRule {
  direction: string
  source: { block: string; entityClass: string; field: string }
  canonical: { entity: string; entityClass: string; property: string; localName?: string }
  transformations?: Array<{ operation: string; values?: unknown[] }>
}

interface ArpCrosswalk extends CrosswalkDocument {
  crosswalks?: { arpRoCrateToCanonical?: { mappings?: ArpRule[] } }
  repositories?: { arp?: { blocks?: Record<string, {
    roCrate?: { profile?: { classes?: Record<string, {
      inputs?: Array<{ id: string; name: string }>
    }> } }
  }> } }
}

export function mapArpCrate<T extends { '@graph'?: Array<Record<string, unknown>> }>(
  crate: T,
  document: CrosswalkDocument,
  direction: 'toArp' | 'fromArp',
): T {
  const crosswalk = document as ArpCrosswalk
  const rules = crosswalk.crosswalks?.arpRoCrateToCanonical?.mappings
  if (!Array.isArray(rules)) {
    throw new Error(`The selected crosswalk '${document.id}' has no ARP RO-Crate mappings.`)
  }

  const mappings = rules
    .filter(rule => rule.direction === 'both' || (
      direction === 'fromArp' && rule.direction === 'forward'))
    .map(rule => {
      const { block, entityClass, field } = rule.source
      const inputs = crosswalk.repositories?.arp?.blocks?.[block]
        ?.roCrate?.profile?.classes?.[entityClass]?.inputs
      const arpProperty = inputs?.find(input => input.name === field)?.id || field
      return {
        rule,
        source: direction === 'toArp' ? rule.canonical.property : arpProperty,
        alias: direction === 'toArp' ? rule.canonical.localName : field,
        target: direction === 'toArp' ? arpProperty : rule.canonical.property,
        entityClass: direction === 'toArp' ? rule.canonical.entityClass : entityClass,
      }
    })

  return {
    ...crate,
    '@graph': crate['@graph']?.map(entity => {
      const mapped = { ...entity }
      const types = Array.isArray(entity['@type']) ? entity['@type'] : [entity['@type']]
      for (const { rule, source, alias, target, entityClass } of mappings) {
        if (!types.includes(entityClass) ||
            (rule.canonical.entity === 'root' && entity['@id'] !== './')) continue
        const key = Object.prototype.hasOwnProperty.call(entity, source) ? source : alias
        if (!key || !Object.prototype.hasOwnProperty.call(entity, key)) continue
        const value = transformValue(entity[key], rule.transformations ?? [])
        delete mapped[key]
        if (value !== undefined) {
          Object.defineProperty(mapped, target, {
            value, enumerable: true, configurable: true, writable: true,
          })
        }
      }
      return mapped
    }),
  }
}

function transformValue(value: unknown, operations: NonNullable<ArpRule['transformations']>): unknown {
  let values = Array.isArray(value) ? value : [value]
  let multiple = Array.isArray(value)
  for (const { operation, values: omitted } of operations) {
    switch (operation) {
      case 'omitEmpty':
        values = values.filter(item => item != null &&
          (typeof item !== 'string' || item.trim() !== ''))
        break
      case 'omitValues':
        values = values.filter(item => !omitted?.includes(item))
        break
      case 'trim':
        values = values.map(item => typeof item === 'string' ? item.trim() : item)
        break
      case 'first':
        multiple = false
        values = values.slice(0, 1)
        break
      case 'asArray':
        multiple = true
        break
      case 'parseNumber':
        values = values.map(item => typeof item === 'string' && item.trim() &&
          Number.isFinite(Number(item)) ? Number(item) : item)
        break
      case 'normalizeDate':
        values = values.map(item => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(item)
          ? item.slice(0, 10) : item)
        break
      case 'validateUrl':
        // Leave the value in the payload for the repository's validation.
        break
    }
  }
  return values.length ? (multiple ? values : values[0]) : undefined
}
