// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const METADATA_PROFILE_INDEX_FILENAME = 'metadata-profile-index.json'
const REMOTE_PROFILE_PROVIDER_CONFIG_FILENAME = 'remote-profile-providers.json'
const REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE = 'RocKIT.RemoteProfileProvider'
const DATA_REPOSITORY_CONFIG_FILENAME = 'data-repositories.json'
const DATA_REPOSITORY_KEYTAR_SERVICE = 'RocKIT.DataRepository'

function configuredValue(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function setDefault(name: string, value: string): void {
  if (!configuredValue(name)) {
    process.env[name] = value
  }
}

/**
 * Establishes RocKIT's runtime configuration before Theia constructs its
 * EnvVariablesServer. That service snapshots process.env in its constructor,
 * so a BackendApplicationContribution.initialize() hook is already too late.
 */
export function initializeRockitApplicationEnvironment(): string {
  const rootPath = configuredValue('ROCKIT_ROOT_PATH') ?? path.join(os.homedir(), '.rockit')

  setDefault('ROCKIT_ROOT_PATH', rootPath)
  setDefault('THEIA_CONFIG_DIR', rootPath)
  setDefault('ROCKIT_METADATA_PROFILE_INDEX_FILE', METADATA_PROFILE_INDEX_FILENAME)
  setDefault('ROCKIT_REMOTE_PROFILE_PROVIDER_CONFIG_FILE', REMOTE_PROFILE_PROVIDER_CONFIG_FILENAME)
  setDefault(
    'ROCKIT_REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE',
    REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE,
  )
  setDefault('ROCKIT_DATA_REPOSITORY_CONFIG_FILE', DATA_REPOSITORY_CONFIG_FILENAME)
  setDefault('ROCKIT_DATA_REPOSITORY_KEYTAR_SERVICE', DATA_REPOSITORY_KEYTAR_SERVICE)

  setDefault('ARP_PROD_PREFIX', 'https://repo.schema.researchdata.hu/templates/')
  setDefault('ARP_DEV_PREFIX', 'https://repo.cedardev.dsd.sztaki.hu/templates/')
  setDefault('ARP_W3ID_PROD', 'https://w3id.org/arp/schema/')
  setDefault('ARP_W3ID_DEV', 'https://w3id.org/arp/dev/schema/')

  setDefault('ROCKIT_ROCRATE_MCP_NODE_PATH', process.execPath)
  if (process.versions.electron) {
    setDefault('ROCKIT_ROCRATE_MCP_ELECTRON_RUN_AS_NODE', '1')
  }

  fs.mkdirSync(rootPath, { recursive: true })
  console.info(`[RockitEnvironment] Runtime storage root: ${rootPath}`)
  return rootPath
}
