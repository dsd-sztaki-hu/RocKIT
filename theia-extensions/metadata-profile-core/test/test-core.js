// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const core = require('../lib/index.js')

  const profileEnvNames = [
    'ROCKIT_ROOT_PATH',
    'ROCKIT_METADATA_PROFILE_INDEX_FILE',
    'ROCKIT_REMOTE_PROFILE_PROVIDER_CONFIG_FILE',
    'ROCKIT_REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE',
  ]
  const originalProfileEnv = Object.fromEntries(
    profileEnvNames.map((name) => [name, process.env[name]]),
  )
  try {
    for (const name of profileEnvNames) {
      delete process.env[name]
    }
    assert.equal(
      core.resolveProfileRootPath(),
      path.join(os.homedir(), '.rockit'),
      'profile storage should default to ~/.rockit',
    )

    const rockitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-profile-rockit-'))
    process.env.ROCKIT_ROOT_PATH = rockitRoot
    process.env.ROCKIT_METADATA_PROFILE_INDEX_FILE = 'rockit-index.json'
    const configuredStorage = core.ensureProfileStorage()
    assert.equal(configuredStorage.rootPath, rockitRoot)
    assert.equal(
      configuredStorage.indexPath,
      path.join(rockitRoot, 'rockit-index.json'),
      'ROCKIT_* settings should select the configured profile storage',
    )
    assert.ok(fs.existsSync(configuredStorage.indexPath))
  } finally {
    for (const [name, value] of Object.entries(originalProfileEnv)) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-profile-core-test-'))

  const storage = core.ensureProfileStorage(root)
  assert.ok(fs.existsSync(storage.cedarDir), 'cedar directory should exist')
  assert.ok(fs.existsSync(storage.roCrateDir), 'ro-crate directory should exist')
  assert.ok(fs.existsSync(storage.indexPath), 'profile index should exist')
  const providerConfigPath = path.join(root, 'remote-profile-providers.json')
  assert.ok(fs.existsSync(providerConfigPath), 'remote profile provider config should exist')
  const seededProviders = JSON.parse(fs.readFileSync(providerConfigPath, 'utf8'))
  assert.equal(seededProviders.length, 1)
  assert.equal(seededProviders[0].id, 'arp-prod')
  assert.equal(seededProviders[0].title, 'ARP Production')
  assert.equal(seededProviders[0].accessMode, 'dataverseProxy')
  assert.equal(seededProviders[0].dataverseProxyBaseUrl, 'https://repo.researchdata.hu')

  const removedDefault = await core.deleteCedarProvider('arp-prod', root)
  assert.equal(removedDefault.deleted, true)
  core.ensureProfileStorage(root)
  assert.deepEqual(JSON.parse(fs.readFileSync(providerConfigPath, 'utf8')), [])

  const fixturePath = path.resolve(
    __dirname,
    '../../cedar-to-rocrate/test-resources/citationCedarTemplate.json',
  )
  const rawContent = fs.readFileSync(fixturePath, 'utf8')
  const imported = await core.importCedarTemplateContent({
    rawContent,
    rootPath: root,
    source: 'remote',
  })

  assert.equal(imported.profile.name, 'Citation Metadata')
  assert.ok(fs.existsSync(imported.sourcePath), 'source CEDAR file should be written')
  assert.ok(fs.existsSync(imported.convertedPath), 'converted profile should be written')
  const hungarianConvertedPath = path.join(
    root,
    imported.profile.files.convertedPaths.hu,
  )
  assert.ok(
    fs.existsSync(hungarianConvertedPath),
    'Hungarian converted profile should be written',
  )
  const englishProfile = JSON.parse(fs.readFileSync(imported.convertedPath, 'utf8'))
  const hungarianProfile = JSON.parse(fs.readFileSync(hungarianConvertedPath, 'utf8'))
  const structuralSignature = (profile) =>
    Object.fromEntries(
      Object.entries(profile.classes).map(([className, definition]) => [
        className,
        (definition.inputs || []).map((input) => ({
          name: input.name,
          type: input.type,
          multiple: input.multiple,
        })),
      ]),
    )
  assert.deepEqual(structuralSignature(hungarianProfile), structuralSignature(englishProfile))
  assert.equal(englishProfile.localisation.Dataset, 'Dataset')
  assert.equal(hungarianProfile.localisation.Dataset, 'Adatcsomag')

  const listing = core.listLocalProfiles(root)
  assert.equal(listing.profiles.length, 1)
  assert.deepEqual(listing.index.conformsToIndex[imported.profile.conformsTo], [
    imported.profile.id,
  ])

  fs.writeFileSync(
    providerConfigPath,
    JSON.stringify(
      [
        {
          id: 'local-provider',
          title: 'Local Provider',
          baseUrl: 'https://cedar.example.test/',
          domainBase: 'example.test',
          type: 'CEDAR',
        },
      ],
      null,
      2,
    ),
    'utf8',
  )
  const providers = await core.loadCedarProviders(root)
  assert.equal(providers.providers.some((provider) => provider.id === 'arp-prod'), false)
  assert.equal(providers.providers.some((provider) => provider.id === 'local-provider'), true)
  assert.equal(providers.configPath, providerConfigPath)
  assert.equal(
    core.deriveDataverseProxyBaseUrl('schema.researchdata.hu'),
    'https://repo.researchdata.hu',
  )
  assert.equal(
    core.deriveDataverseProxyBaseUrl('https://resource.schema.researchdata.hu/templates/123'),
    'https://repo.researchdata.hu',
  )

  await core.saveCedarProvider(
    {
      id: 'arp-prod-keyed',
      title: 'ARP Prod',
      baseUrl: 'https://cedar.schema.researchdata.hu/',
      domainBase: 'schema.researchdata.hu',
      accessMode: 'dataverseProxy',
      dataverseProxyBaseUrl: 'http://localhost:8080',
      type: 'CEDAR',
    },
    root,
  )
  const dedupedProviders = await core.loadCedarProviders(root)
  assert.equal(
    dedupedProviders.providers.filter(
      (provider) => provider.displayUrl === 'https://cedar.schema.researchdata.hu/',
    ).length,
    1,
  )
  assert.equal(
    dedupedProviders.providers.find((provider) => provider.displayUrl === 'https://cedar.schema.researchdata.hu/')
      .dataverseProxyBaseUrl,
    'http://localhost:8080',
  )

  const deletedProvider = await core.deleteCedarProvider('local-provider', root)
  assert.equal(deletedProvider.deleted, true)
  assert.equal(
    deletedProvider.providers.some((provider) => provider.id === 'local-provider'),
    false,
  )

  const deleted = await core.deleteMetadataProfile({
    id: imported.profile.id,
    rootPath: root,
  })
  assert.equal(deleted.removed.id, imported.profile.id)
  assert.equal(fs.existsSync(hungarianConvertedPath), false)
  assert.equal(core.listLocalProfiles(root).profiles.length, 0)

  console.log('metadata-profile-core tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
