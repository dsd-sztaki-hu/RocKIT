// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as fs from 'node:fs'
import * as path from 'node:path'

import { DEFAULT_ROCRATE_CONTEXT, type RoCrate } from './types'

export function normalizeCrate(crate: unknown): RoCrate {
  if (!crate || typeof crate !== 'object' || Array.isArray(crate)) {
    return { '@context': DEFAULT_ROCRATE_CONTEXT, '@graph': [] }
  }
  const next = crate as RoCrate
  if (!Array.isArray(next['@graph'])) {
    next['@graph'] = []
  }
  if (!('@context' in next)) {
    next['@context'] = DEFAULT_ROCRATE_CONTEXT
  }
  return next
}

export function cloneCrate(crate: RoCrate): RoCrate {
  return JSON.parse(JSON.stringify(crate)) as RoCrate
}

export function readCrateFromFile(cratePath: string): RoCrate {
  const payload = fs.readFileSync(cratePath, 'utf8')
  const parsed = JSON.parse(payload) as unknown
  return normalizeCrate(parsed)
}

export function writeCrateAtomic(
  cratePath: string,
  crate: RoCrate,
  indent = 2,
): void {
  const directory = path.dirname(cratePath)
  fs.mkdirSync(directory, { recursive: true })

  const normalized = normalizeCrate(cloneCrate(crate))
  let payload = JSON.stringify(normalized, null, indent)
  if (!payload.endsWith('\n')) {
    payload += '\n'
  }

  const tempPath = path.join(
    directory,
    `.${path.basename(cratePath)}.tmp-${process.pid}-${Date.now()}`,
  )
  fs.writeFileSync(tempPath, payload, 'utf8')
  fs.renameSync(tempPath, cratePath)
}

export function resolveCratePath(cratePath?: string): string {
  return path.resolve(cratePath ?? 'ro-crate-metadata.json')
}
