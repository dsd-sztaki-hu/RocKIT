import {
  buildRedirectDerivedCandidates,
  buildSchemaFetchCandidates,
  decodeTemplateReference,
  deriveResourceBaseUrl,
} from 'rockit-common/lib/common/schema-url-resolution'

describe('schema URL resolution helpers', () => {
  it('derives candidates from a resolved openview redirect target', () => {
    const url = 'https://w3id.org/arp/schema/33677b82-7973-3e4c-b09d-b5189e095627'
    const redirectUrl =
      'https://openview.schema.researchdata.hu/templates/https:%2F%2Frepo.schema.researchdata.hu%2Ftemplates%2F33677b82-7973-3e4c-b09d-b5189e095627'

    expect(buildSchemaFetchCandidates(url)).toEqual([
      url,
      'https://w3id.org/arp/templates/33677b82-7973-3e4c-b09d-b5189e095627',
      'https://repo.schema.researchdata.hu/templates/33677b82-7973-3e4c-b09d-b5189e095627',
      'https://resource.schema.researchdata.hu/templates/https%3A%2F%2Frepo.schema.researchdata.hu%2Ftemplates%2F33677b82-7973-3e4c-b09d-b5189e095627',
    ])
    expect(buildRedirectDerivedCandidates(redirectUrl)).toContain(
      'https://resource.schema.researchdata.hu/templates/https%3A%2F%2Frepo.schema.researchdata.hu%2Ftemplates%2F33677b82-7973-3e4c-b09d-b5189e095627',
    )
  })

  it('builds provider-local repo and resource candidates for w3id urls', () => {
    const provider = {
      domainBase: 'schema.researchdata.hu',
      baseUrl: 'https://schema.researchdata.hu',
    }

    expect(
      buildSchemaFetchCandidates(
        'https://w3id.org/arp/schema/33677b82-7973-3e4c-b09d-b5189e095627',
        provider,
      ),
    ).toContain(
      'https://resource.schema.researchdata.hu/templates/https%3A%2F%2Frepo.schema.researchdata.hu%2Ftemplates%2F33677b82-7973-3e4c-b09d-b5189e095627',
    )
    expect(
      buildSchemaFetchCandidates(
        'https://w3id.org/arp/schema/33677b82-7973-3e4c-b09d-b5189e095627',
        provider,
      ),
    ).not.toContain('https://w3id.org/arp/schema/33677b82-7973-3e4c-b09d-b5189e095627')
  })

  it('derives candidates for raw template ids when provider context exists', () => {
    expect(
      buildSchemaFetchCandidates('33677b82-7973-3e4c-b09d-b5189e095627', {
        domainBase: 'schema.example.org',
      }),
    ).toEqual([
      'https://resource.schema.example.org/templates/33677b82-7973-3e4c-b09d-b5189e095627',
    ])
  })

  it('prefers the configured provider resource base url when present', () => {
    const provider = {
      id: 'test',
      title: 'Test',
      type: 'CEDAR' as const,
      baseUrl: 'https://schema.example.org',
      domainBase: 'schema.example.org',
      resourceBaseUrl: 'https://resource.example.org/',
    }

    expect(deriveResourceBaseUrl(provider)).toBe('https://resource.example.org')
    expect(
      buildSchemaFetchCandidates(
        'https://w3id.org/arp/schema/33677b82-7973-3e4c-b09d-b5189e095627',
        provider,
      ),
    ).toContain(
      'https://resource.example.org/templates/https%3A%2F%2Frepo.schema.example.org%2Ftemplates%2F33677b82-7973-3e4c-b09d-b5189e095627',
    )
  })

  it('derives a generic resource host from a repo host without researchdata-specific rules', () => {
    expect(
      deriveResourceBaseUrl(undefined, 'https://repo.example.org/templates/123'),
    ).toBe('https://resource.example.org')
  })

  it('does not invent a resource host directly from w3id urls without provider context', () => {
    expect(
      deriveResourceBaseUrl(undefined, 'https://w3id.org/arp/schema/123'),
    ).toBeUndefined()
  })

  it('builds default ARP candidates for production and dev w3id schema urls without provider context', () => {
    expect(
      buildSchemaFetchCandidates(
        'https://w3id.org/arp/schema/33677b82-7973-3e4c-b09d-b5189e095627',
      ),
    ).toContain(
      'https://resource.schema.researchdata.hu/templates/https%3A%2F%2Frepo.schema.researchdata.hu%2Ftemplates%2F33677b82-7973-3e4c-b09d-b5189e095627',
    )

    expect(
      buildSchemaFetchCandidates(
        'https://w3id.org/arp/dev/schema/33677b82-7973-3e4c-b09d-b5189e095627',
      ),
    ).toContain(
      'https://resource.cedardev.dsd.sztaki.hu/templates/https%3A%2F%2Frepo.cedardev.dsd.sztaki.hu%2Ftemplates%2F33677b82-7973-3e4c-b09d-b5189e095627',
    )

    expect(buildSchemaFetchCandidates('https://w3id.org/example/schema/123')).toEqual([
      'https://w3id.org/example/schema/123',
      'https://w3id.org/example/templates/123',
    ])
  })

  it('decodes the embedded repo template url from an openview redirect', () => {
    expect(
      decodeTemplateReference(
        'https://openview.schema.researchdata.hu/templates/https:%2F%2Frepo.schema.researchdata.hu%2Ftemplates%2F640c3586-5db2-3a81-a681-c008cf7404fe',
      ),
    ).toBe(
      'https://repo.schema.researchdata.hu/templates/640c3586-5db2-3a81-a681-c008cf7404fe',
    )
  })
})
