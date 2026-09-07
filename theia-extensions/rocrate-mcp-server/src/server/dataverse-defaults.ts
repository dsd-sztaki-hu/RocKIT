const LOCAL_DATAVERSE_BASE_URL = 'http://localhost:8080'
const RELEASE_DATAVERSE_BASE_URL = 'https://repo.researchdata.hu'

/**
 * The workspace build targets a local ARP/Dataverse instance. The standalone
 * package is compiled as a release build and targets the public ARP service.
 * DATAVERSE_BASE_URL remains the runtime override for both builds.
 */
export const DEFAULT_DATAVERSE_BASE_URL =
  process.env.ROCRATE_MCP_RELEASE_BUILD === 'true'
    ? RELEASE_DATAVERSE_BASE_URL
    : LOCAL_DATAVERSE_BASE_URL
