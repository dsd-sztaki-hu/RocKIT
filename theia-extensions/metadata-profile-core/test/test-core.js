const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const core = require('../lib/index.js')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-profile-core-test-'))

  const storage = core.ensureProfileStorage(root)
  assert.ok(fs.existsSync(storage.cedarDir), 'cedar directory should exist')
  assert.ok(fs.existsSync(storage.roCrateDir), 'ro-crate directory should exist')
  assert.ok(fs.existsSync(storage.indexPath), 'schema index should exist')
  const providerConfigPath = path.join(root, 'remote-schema-providers.json')
  assert.ok(fs.existsSync(providerConfigPath), 'remote schema provider config should exist')
  const seededProviders = JSON.parse(fs.readFileSync(providerConfigPath, 'utf8'))
  assert.equal(seededProviders.length, 1)
  assert.equal(seededProviders[0].id, 'arp-prod')
  assert.equal(seededProviders[0].accessMode, 'dataverseProxy')
  assert.equal(seededProviders[0].dataverseProxyBaseUrl, 'https://repo.researchdata.hu')

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
  assert.equal(core.listLocalProfiles(root).profiles.length, 0)

  console.log('metadata-profile-core tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
