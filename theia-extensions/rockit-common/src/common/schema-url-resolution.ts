// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

export interface SchemaSourceProviderLike {
  resourceBaseUrl?: string
  domainBase?: string
  baseUrl?: string
  displayUrl?: string
}

const ARP_W3ID_PROD_PREFIX = 'https://w3id.org/arp/schema/'
const ARP_W3ID_DEV_PREFIX = 'https://w3id.org/arp/dev/schema/'
const ARP_REPO_PROD_PREFIX = 'https://repo.schema.researchdata.hu/templates/'
const ARP_REPO_DEV_PREFIX = 'https://repo.cedardev.dsd.sztaki.hu/templates/'

export function deriveResourceBaseUrl(
  provider?: SchemaSourceProviderLike,
  templateUrl?: string,
): string | undefined {
  if (provider?.resourceBaseUrl) {
    return provider.resourceBaseUrl.replace(/\/+$/, '')
  }

  const providerDomain =
    provider?.domainBase ||
    provider?.baseUrl?.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '') ||
    provider?.displayUrl?.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '')
  if (providerDomain) {
    return `https://resource.${providerDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  }

  const value = templateUrl?.trim() ?? ''
  if (!/^https?:\/\//.test(value)) {
    return undefined
  }

  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host === 'w3id.org' || host === 'www.w3id.org') {
      return undefined
    }
    if (host.startsWith('resource.')) {
      return url.origin
    }

    const parts = host.split('.')
    if (parts.length < 2) {
      return undefined
    }

    const first = parts[0]
    if (['repo', 'open', 'openview', 'cedar'].includes(first)) {
      parts[0] = 'resource'
    } else {
      parts.unshift('resource')
    }

    return `${url.protocol}//${parts.join('.')}`
  } catch {
    return undefined
  }
}

export function buildSchemaFetchCandidates(
  input: string,
  provider?: SchemaSourceProviderLike,
): string[] {
  const value = input.trim()
  const resourceBaseUrl = deriveResourceBaseUrl(provider, value)
  const providerTemplateCandidates = buildProviderTemplateCandidates(value, provider, resourceBaseUrl)

  if (!/^https?:\/\//.test(value)) {
    return Array.from(
      new Set([resourceBaseUrl ? `${resourceBaseUrl}/templates/${encodeURIComponent(value)}` : value]),
    )
  }

  const isW3id = isW3idUrl(value)
  const defaultArpCandidates = buildDefaultArpW3idCandidates(value)
  const candidates = [
    ...(isW3id && provider ? [] : [value]),
    rewriteTemplatePath(value),
    rewriteOpenViewUrl(value),
    rewriteArtifactUrl(value),
    ...defaultArpCandidates,
    resourceBaseUrl ? `${resourceBaseUrl}/templates/${encodeURIComponent(value)}` : '',
    ...providerTemplateCandidates,
  ].filter((candidate) => candidate !== '')

  return Array.from(new Set(candidates))
}

export function decodeTemplateReference(value: string): string | undefined {
  try {
    const url = new URL(value)
    const match = url.pathname.match(/\/templates\/(.+)$/)
    if (!match) {
      return undefined
    }
    const decoded = decodeURIComponent(match[1]).replace(/^https:%2F%2F/i, 'https://')
    return /^https?:\/\//.test(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

export function buildRedirectDerivedCandidates(
  finalUrl: string,
  provider?: SchemaSourceProviderLike,
): string[] {
  const decodedReference = decodeTemplateReference(finalUrl)
  const derivedFromFinalUrl = buildSchemaFetchCandidates(finalUrl, provider)
  const derivedFromDecodedReference = decodedReference
    ? buildSchemaFetchCandidates(decodedReference, provider)
    : []

  return Array.from(
    new Set([
      finalUrl,
      ...(decodedReference ? [decodedReference] : []),
      ...derivedFromFinalUrl,
      ...derivedFromDecodedReference,
    ]),
  )
}

function rewriteOpenViewUrl(value: string): string {
  return value.includes('openview.') ? value.replace('openview.', 'open.') : ''
}

function rewriteArtifactUrl(value: string): string {
  return value.includes('/artifacts/') ? value.replace('/artifacts/', '/templates/') : ''
}

function rewriteTemplatePath(value: string): string {
  if (value.includes('/schema/')) {
    return value.replace('/schema/', '/templates/')
  }
  if (value.includes('/artifacts/')) {
    return value.replace('/artifacts/', '/templates/')
  }
  return ''
}

function buildProviderTemplateCandidates(
  value: string,
  provider?: SchemaSourceProviderLike,
  resourceBaseUrl?: string,
): string[] {
  if (!provider || !resourceBaseUrl || !/^https?:\/\//.test(value) || !isW3idUrl(value)) {
    return []
  }

  const templateId = extractTrailingTemplateId(value)
  const repoBaseUrl = deriveRepoBaseUrl(provider, value)
  const openViewBaseUrl = deriveOpenViewBaseUrl(provider, value)
  if (!templateId || !repoBaseUrl) {
    return []
  }

  const repoTemplateUrl = `${repoBaseUrl}/templates/${templateId}`
  return [
    repoTemplateUrl,
    openViewBaseUrl
      ? `${openViewBaseUrl}/templates/${encodeURIComponent(repoTemplateUrl).replace(
          /^https%3A/i,
          'https:',
        )}`
      : '',
    `${resourceBaseUrl}/templates/${encodeURIComponent(repoTemplateUrl)}`,
  ].filter((candidate) => candidate !== '')
}

function buildDefaultArpW3idCandidates(value: string): string[] {
  const repoTemplateUrl = defaultArpW3idToRepoTemplateUrl(value)
  if (!repoTemplateUrl) {
    return []
  }
  const resourceBaseUrl = deriveResourceBaseUrl(undefined, repoTemplateUrl)
  return [
    repoTemplateUrl,
    resourceBaseUrl ? `${resourceBaseUrl}/templates/${encodeURIComponent(repoTemplateUrl)}` : '',
  ].filter((candidate) => candidate !== '')
}

function defaultArpW3idToRepoTemplateUrl(value: string): string | undefined {
  if (value.startsWith(ARP_W3ID_PROD_PREFIX)) {
    return `${ARP_REPO_PROD_PREFIX}${value.substring(ARP_W3ID_PROD_PREFIX.length)}`
  }
  if (value.startsWith(ARP_W3ID_DEV_PREFIX)) {
    return `${ARP_REPO_DEV_PREFIX}${value.substring(ARP_W3ID_DEV_PREFIX.length)}`
  }
  return undefined
}

function deriveRepoBaseUrl(
  provider?: SchemaSourceProviderLike,
  value?: string,
): string | undefined {
  const origin = deriveProviderOrigin(provider, value)
  if (!origin) {
    return undefined
  }
  return rewriteOriginSubdomain(origin, 'repo')
}

function deriveOpenViewBaseUrl(
  provider?: SchemaSourceProviderLike,
  value?: string,
): string | undefined {
  const origin = deriveProviderOrigin(provider, value)
  if (!origin) {
    return undefined
  }
  return rewriteOriginSubdomain(origin, 'openview')
}

function deriveProviderOrigin(
  provider?: SchemaSourceProviderLike,
  value?: string,
): string | undefined {
  const source =
    provider?.baseUrl ||
    provider?.displayUrl ||
    provider?.domainBase ||
    value
  if (!source || !/^https?:\/\//.test(source) && source === value) {
    return undefined
  }
  try {
    const url = new URL(/^https?:\/\//.test(source) ? source : `https://${source}`)
    return url.origin
  } catch {
    return undefined
  }
}

function rewriteOriginSubdomain(origin: string, subdomain: string): string {
  const url = new URL(origin)
  const parts = url.hostname.split('.')
  const first = parts[0]?.toLowerCase()
  if (['repo', 'resource', 'open', 'openview', 'cedar'].includes(first)) {
    parts[0] = subdomain
  } else if (first === 'schema') {
    parts.unshift(subdomain)
  } else {
    parts.unshift(subdomain)
  }
  url.hostname = parts.join('.')
  return url.origin
}

function extractTrailingTemplateId(value: string): string | undefined {
  try {
    const url = new URL(value)
    const segments = url.pathname.split('/').filter(Boolean)
    return segments.length > 0 ? segments[segments.length - 1] : undefined
  } catch {
    return undefined
  }
}

function isW3idUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname === 'w3id.org' || url.hostname === 'www.w3id.org'
  } catch {
    return false
  }
}
