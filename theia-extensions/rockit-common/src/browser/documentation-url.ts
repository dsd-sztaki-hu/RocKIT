export function documentationVersion(version: string): string {
  const trimmed = version.trim().replace(/^v\s*/i, '')
  const match = /^(\d+)\.(\d+)/.exec(trimmed)
  return match ? `${match[1]}.${match[2]}` : 'latest'
}

export function buildDocumentationUrl(version: string): string {
  const segment = encodeURIComponent(documentationVersion(version))
  return `https://repo.researchdata.hu/rockit/${segment}/`
}
