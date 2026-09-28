# Metadata Profile Manager Extension
A comprehensive profile management system for the RocKIT application, enabling users to import, manage, and associate metadata profiles (including profiles converted from CEDAR templates) with their research data packages.

## Overview

The **Metadata Profile Manager** is a frontend-only Eclipse Theia extension that provides:

- **Profile Import**: Import metadata profiles from local files or remote URLs
- **Remote Repository Browsing**: Browse and import profiles from configured providers
- **Profile Management**: View, search, filter, sort, and delete managed profiles
- **Automatic Conversion**: Convert supported templates to RO-Crate profiles automatically
- **Self-Healing Index**: Automatically detect and repair index inconsistencies
- **RO-Crate Integration**: Seamlessly associate profiles with entities in RO-Crate metadata

This extension is critical for RocKIT's profile-driven form generation and validation workflow, enabling researchers to define custom metadata requirements that can be applied consistently across research projects.

## Table of Contents

- [Features](#features)
- [Installation & Setup](#installation--setup)
- [Architecture Overview](#architecture-overview)
- [User Guide](#user-guide)
  - [Importing Profiles](#importing-profiles)
  - [Browsing Remote Repositories](#browsing-remote-repositories)
  - [Managing Profiles](#managing-profiles)
  - [Remote Provider Management](#remote-provider-management)
- [Developer Guide](#developer-guide)
  - [Extension Structure](#extension-structure)
  - [API for External Integrations](#api-for-external-integrations)
  - [Extending the Extension](#extending-the-extension)
- [Configuration](#configuration)
- [Data Flow](#data-flow)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **File Import** | Import Cedar template JSON files from local filesystem |
| **URL Import** | Import profiles directly from remote URLs with authentication support |
| **Remote Browsing** | Browse and search Cedar template repositories via configured providers |
| **Profile Association** | Associate profiles with RO-Crate entities for form generation |
| **Auto-Conversion** | Automatically convert Cedar templates to RO-Crate profiles |
| **Self-Healing Index** | Detect orphaned entries and discover unindexed files automatically |
| **Secure Storage** | API keys stored securely using keytar (not in configuration files) |

### UI Features

- **Searchable Table**: Search across name, version, reference ID, conformance URLs, and download URLs
- **Filtering**: Filter by source type (local/remote), search terms, and custom criteria
- **Sorting**: Sort columns alphabetically or by date
- **Pagination**: Navigate large profile collections with pagination controls
- **Selection Modes**: Checkbox or radio button selection for batch operations

## Installation & Setup

### Prerequisites

- **Node.js**: Version 18+ (project uses Yarn workspaces)
- **Yarn**: Project uses Yarn berry (v2+) via `.yarnrc.yml`
- **Theia Framework**: Eclipse Theia 1.65.2 runtime environment

### Installation

This extension is part of the RocKIT monorepo and is automatically installed when building the application:

```bash
# From project root
yarn install
yarn build
```

The extension is included in both browser and electron app builds via Lerna workspace configuration.

### Environment Configuration

Configure the following environment variables before starting the application:

| Variable | Default | Description |
|----------|---------|-------------|
| `ROCKIT_ROOT_PATH` | *Required* | Root directory path for profile storage (`metadata-profiles/cedar/`, `metadata-profiles/ro-crate/`) |
| `ROCKIT_METADATA_PROFILE_INDEX_FILE` | `metadata-profile-index.json` | Filename for the master index file within ROCKIT_ROOT_PATH |
| `ROCKIT_REMOTE_PROFILE_PROVIDER_CONFIG_FILE` | `remote-profile-providers.json` | Filename for remote provider configurations |
| `ROCKIT_REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE` | `RocKIT.RemoteProfileProvider` | Keytar service identifier for secure credential storage |

#### Example Configuration (Linux/macOS)

```bash
export ROCKIT_ROOT_PATH="$HOME/.rockit/profiles"
export ROCKIT_METADATA_PROFILE_INDEX_FILE="metadata-profile-index.json"
export ROCKIT_REMOTE_PROFILE_PROVIDER_CONFIG_FILE="remote-profile-providers.json"
export ROCKIT_REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE="RocKIT.RemoteProfileProvider"
```

#### Example Configuration (Windows)

```cmd
set ROCKIT_ROOT_PATH=%USERPROFILE%\.rockit\profiles
set ROCKIT_METADATA_PROFILE_INDEX_FILE=metadata-profile-index.json
set ROCKIT_REMOTE_PROFILE_PROVIDER_CONFIG_FILE=remote-profile-providers.json
set ROCKIT_REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE=RocKIT.RemoteProfileProvider
```

### URL Prefix Configuration

The extension uses environment variables to determine which template repository URLs and W3ID identifiers to use:

| Variable | Production Value | Development Value | Description |
|----------|------------------|-------------------|-------------|
| `ARP_PROD_PREFIX` | `https://repo.schema.researchdata.hu/templates/` | `https://repo.cedardev.dsd.sztaki.hu/templates/` | Base URL for Cedar template repository |
| `ARP_DEV_PREFIX` | Same as above (development mode) | Same as above | Development template repository URL |
| `ARP_W3ID_PROD` | `https://schema.researchdata.hu/w3id/` | `https://cedardev.dsd.sztaki.hu/w3id/` | W3ID URL prefix for schema identifiers |
| `ARP_W3ID_DEV` | Same as above (development mode) | Same as above | Development W3ID identifier prefix |

## Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Metadata Profile Manager                        │
│                        (Frontend Extension)                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │   Contribution   │───▶│   Frontend       │───▶│   Widget     │  │
│  │                  │    │   Module         │    │             │  │
│  │ - Command        │    │ - DI Container   │    │ - Table      │  │
│  │ - Menu Entry     │    │ - Service Bind   │    │ - Toolbar    │  │
│  └──────────────────┘    └──────────────────┘    └──────┬───────┘  │
│                                                        │           │
│                              ┌─────────────────────────┼───────────┐
│                              ▼                         ▼           │
│                    ┌──────────────────┐    ┌──────────────────┐   │
│                    │   Service Layer  │    │   UI Components  │   │
│                    │                  │    │                  │   │
│                    │ - Profile Manager│    │ - Table          │   │
│                    │ - Index Sync     │    │ - Toolbar        │   │
│                    │ - File Ops       │    │ - Selector Dialog│   │
│                    │ - Remote API     │    │ - Import URL     │   │
│                    └────────┬─────────┘    │ - Provider List  │   │
│                             │              │ - Provider Config│   │
│                             │              │ - Cedar Tree     │   │
│                             │              └──────────────────┘   │
│                             │                                      │
│                    ┌────────▼─────────┐                           │
│                    │  Store Services  │                           │
│                    │                  │                           │
│                    │ - Provider Store │◀────── keytar (secure)    │
│                    │ - Index Mutex    │                           │
│                    └──────────────────┘                           │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        External Integrations                        │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │   AppState       │    │  rockit-common   │    │ Cedar        │  │
│  │   Service        │    │  Protocol        │    │ Converter    │  │
│  │                  │    │                  │    │              │  │
│  │ - Schema Assoc.  │    │ - Interface Def. │    │ - Template   │  │
│  │ - Profile Merge  │    │ - Event Emitter  │    │ - RO-Crate   │  │
│  └──────────────────┘    └──────────────────┘    └──────────────┘  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                          File System                                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  metadata-profiles/cedar/          metadata-profiles/ro-crate/ │   │
│  │  (Raw templates)                  (Converted profiles)       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  metadata-profile-index.json             remote-profile-providers.json │
│  (Master index with profile metadata)    (Provider configurations)    │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Patterns

#### 1. Theia Extension Framework

The extension follows Eclipse Theia's widget and contribution model:

- **Contribution**: Registers commands and menu entries (`View → Metadata Profile Manager`)
- **Frontend Module**: Configures Inversify DI container with service bindings
- **Widget**: StatefulWidget-based React component for the main UI

#### 2. Dependency Injection (InversifyJS)

All services and components use TypeScript decorators:

```typescript
@injectable()
export class MetadataProfileManagerService {
    @inject(MetadataProfileManager)
    protected readonly profileManager: MetadataProfileManager;
}
```

**Key Bindings**:
- `MetadataProfileManager` → `MetadataProfileManagerServiceImpl`
- `RemoteSchemaProviderStoreService` → `RemoteSchemaProviderStoreServiceImpl`
- `MetadataProfileManagerWidget` → Widget factory binding

#### 3. React Integration

The widget uses React 18 with `createRoot` for rendering within Theia:

```typescript
const root = createRoot(containerRef.current!);
root.render(<MetadataProfileManagerWidget {...props} />);
```

#### 4. State Synchronization

Integration with **AppStateService** enables:
- Profile association with RO-Crate entities via selector dialog
- Automatic profile merging when schemas are added/removed
- Real-time updates to form generation based on schema changes

### Data Models

#### SchemaInfo Interface

```typescript
interface SchemaInfo {
    id: string;              // Generated UUID (truly unique)
    name: string;            // schema:name field value
    version: string;         // pav:version field value
    source: 'local' | 'remote';
    type: string;            // Currently always 'cedar'
    files: SchemaFiles;      // {sourcePath, convertedPath} relative paths
    aux: SchemaAux;          // {templateUuid?, reference}
    conformsTo?: string;     // W3ID URL derived from schemaId
    downloadUrl?: string;
    createdAt: string | null;
    updatedAt: string | null;
    downloadedAt: string;
}

interface SchemaFiles {
    sourcePath: string;      // Path to raw Cedar template JSON
    convertedPath: string;   // Path to converted RO-Crate profile JSON
}

interface SchemaAux {
    templateUuid?: string;   // UUID from remote repository (if applicable)
    reference: string;       // Reference identifier for the schema
}
```

#### RemoteSchemaProviderConfig Interface

```typescript
interface RemoteSchemaProviderConfig {
    id: string;              // Unique provider identifier
    title: string;           // Display name
    baseUrl: string;         // Base URL for API endpoints
    domainBase: string;      // Domain prefix for W3ID URLs
    type: 'CEDAR';           // Provider type (currently fixed)
    apiKey?: string;         // Stored securely in keytar, not here
}
```

## User Guide

### Accessing the Extension

1. Open RocKIT application
2. Navigate to **View → Metadata Profile Manager** from the menu bar
3. The Metadata Profile Manager panel will open as a dockable widget

### Importing Profiles

#### From Local File

1. Click the **"Import from File"** button in the toolbar (folder icon)
2. Select one or more Cedar template JSON files from your filesystem
3. The extension will:
   - Validate the file structure
   - Extract schema metadata (name, version)
   - Convert to RO-Crate profile format
   - Save both source and converted files
   - Update the index

#### From URL

1. Click the **"Import from URL"** button in the toolbar (link icon)
2. Enter the URL of a Cedar template JSON file
3. If authentication is required:
   - The extension will attempt with stored credentials first
   - Falls back to unauthenticated request on 401/403 errors
4. Upon successful download, files are saved and indexed

#### From Remote Repository (Browse)

1. Click the **"Browse Remote"** button in the toolbar (globe icon)
2. Select a configured remote provider from the dialog
3. The Cedar tree view will load, showing available templates
4. Navigate through categories to find desired schemas
5. Click on a template to select it for import
6. Confirm import to download and convert

### Managing Profiles

#### Viewing Profile Details

The main table displays:
- **Name**: Profile display name (from schema:name)
- **Version**: Profile version (from pav:version)
- **Source**: Whether local or remote
- **Ref**: The `@id` reference identifier
- **Conforms To**: W3ID URL for conformance
- **Download URL**: Remote download location (if applicable)

#### Searching and Filtering

1. Use the search box to filter by:
   - Schema name
   - Version number
   - Reference ID (@id)
   - Conforms To URL
   - Download URL

2. Click column headers to sort alphabetically or by date

3. Use the source dropdown to filter between local and remote profiles

#### Deleting Profiles

**Single Profile**:
1. Select the profile row (checkbox or radio mode)
2. Click the trash icon in the row, OR
3. Right-click and select "Delete" from context menu

**Multiple Profiles**:
1. Hold Ctrl/Cmd to select multiple rows
2. Click the **"Delete"** button in the toolbar

**Confirmation Dialog**:
- Shows count of selected profiles
- Lists profile names for verification
- Requires explicit confirmation before deletion

#### Profile Association with RO-Crate Entities

1. Select one or more profiles from the table
2. Click the **"Associate with Entity"** button (link icon)
3. The selector dialog opens showing available entities in your RO-Crate
4. Choose an entity type and confirm association
5. The profile's W3ID URL is added to the entity's `conformsTo` field

### Remote Provider Management

#### Adding a New Provider

1. Click the **"Manage Providers"** button (gear icon) in toolbar
2. In the provider list dialog, click **"Add Provider"**
3. Fill in the configuration form:
   - **Title**: Display name for this repository
   - **Base URL**: API endpoint base URL
   - **Domain Base**: Domain prefix for W3ID URLs
   - **API Key** (optional): For authenticated repositories

4. Click **"Test Connection"** to validate credentials
5. If successful, click **"Save"** to store configuration securely

#### Editing a Provider

1. Open the provider management dialog
2. Select the provider from the list
3. Click **"Edit"** to modify settings
4. Update any fields as needed
5. Test connection before saving changes

#### Deleting a Provider

1. Open the provider management dialog
2. Select the provider from the list
3. Click **"Delete"** and confirm removal

**Note**: Deleting a provider does NOT remove profiles imported from that repository—it only removes the configuration for future browsing.

## Developer Guide

### Extension Structure

```
theia-extensions/metadata-profile-manager/
├── package.json                    # Extension metadata & dependencies
├── tsconfig.json                   # TypeScript compiler options
├── README.md                       # This documentation file
└── src/
    └── browser/
        ├── metadata-profile-manager-contribution.ts   # Command/menu registration
        ├── metadata-profile-manager-frontend-module.ts # DI container configuration
        ├── metadata-profile-manager-widget.tsx        # Main React widget
        ├── types.ts                              # TypeScript interfaces
        ├── services/
        │   ├── metadata-profile-manager-service.ts    # Core service (38KB)
        │   └── remote-schema-provider-store-service.ts # Secure storage service
        └── components/
            ├── metadata-schema-table.tsx             # Data display component
            ├── metadata-schema-toolbar.tsx           # Toolbar buttons
            ├── metadata-schema-selector.tsx          # Entity association dialog
            ├── metadata-schema-import-from-url-dialog.tsx  # URL import dialog
            ├── remote-schema-provider-list-dialog.tsx        # Provider list UI
            ├── remote-schema-provider-config-dialog.tsx      # Provider config form
            ├── remote-schema-provider-selector-dialog.tsx    # Provider selection
            ├── cedar-tree.tsx                      # Tree view for browsing
            ├── connection-success-dialog.tsx       # Connection test result
            └── icons.tsx                           # Custom icon components
```

### API for External Integrations

The extension exposes a service interface via `rockit-common` for other extensions to interact with schema management:

#### MetadataProfileManager Interface

Defined in [`theia-extensions/rockit-common/src/common/metadata-profile-manager-protocol.ts`](../../rockit-common/src/common/metadata-profile-manager-protocol.ts):

```typescript
export const MetadataProfileManager = Symbol('MetadataProfileManager');

export interface MetadataProfileManager {
    /**
     * Removes the "metadata" suffix from a schema name if present.
     * @param name The schema name to process
     * @returns Name without suffix, or null if no match
     */
    nameWithoutMetadataSuffix(name: string): string | null;

    /**
     * Loads all managed schemas from the index.
     * @returns Promise resolving to array of SchemaInfo objects
     */
    loadAllSchemas(): Promise<SchemaInfo[]>;

    /**
     * Retrieves the converted RO-Crate profile content for a schema.
     * @param sourcePath Relative path to the Cedar template file
     * @returns Parsed JSON content of the converted profile
     */
    getConvertedProfileContent(sourcePath: string): Promise<any>;

    /**
     * Merges a new profile into an existing RO-Crate structure.
     * @param crate Current RO-Crate metadata object
     * @param newProfile Profile to merge in
     * @param profile Base profile for merging context
     * @param profileUrl Optional URL identifier for the profile
     * @returns Merged profile object ready for insertion into crate
     */
    getMergedProfile(
        crate: Record<string, any>,
        newProfile: Record<string, any>,
        profile: Record<string, any>,
        profileUrl?: string
    ): Promise<Record<string, any>>;

    /**
     * Event emitted when schemas are added, removed, or modified.
     */
    readonly onDidChangeSchemas: Event<void>;
}
```

#### Usage Example

```typescript
import { MetadataProfileManager } from 'rockit-common/lib/browser';

@injectable()
export class MyExtensionContribution {
    @inject(MetadataProfileManager)
    protected readonly profileManager: MetadataProfileManager;

    async loadProfilesForFormGeneration() {
        const profiles = await this.profileManager.loadAllProfiles();
        
        for (const profile of profiles) {
            if (profile.source === 'remote') {
                const profileContent = await this.profileManager.getConvertedProfileContent(
                    profile.files.convertedPath
                );
                // Use profileContent for form generation...
            }
        }

        // Listen for profile changes
        this.profileManager.onDidChangeProfiles(() => {
            console.log('Profile collection changed, refresh UI');
        });
    }
}
```

### Extending the Extension

#### Adding New Schema Types

To support additional template formats beyond Cedar:

1. **Extend `SchemaInfo.type`** in [`types.ts`](src/browser/types.ts) to include new type values
2. **Update conversion logic** in `metadata-profile-manager-service.ts`:
   - Add case handling for new type in the conversion switch statement
   - Implement format-specific metadata extraction
3. **Register converter service** in frontend module if using external converter library

#### Adding New UI Components

1. Create component file in `src/browser/components/`
2. Import and bind in [`metadata-profile-manager-frontend-module.ts`](src/browser/metadata-profile-manager-frontend-module.ts):
   ```typescript
   binding.bind(MetadataProfileManagerWidget).toDynamicValue(ctx => 
       // Custom widget factory logic
   );
   ```
3. Register command contribution in [`metadata-profile-manager-contribution.ts`](src/browser/metadata-profile-manager-contribution.ts)

#### Adding New Remote Provider Types

1. Extend `RemoteSchemaProviderConfig.type` to support new provider types
2. Update URL resolution logic in `remote-schema-provider-store-service.ts`
3. Add provider-specific authentication handling if needed

## Configuration

### Environment Variables Reference

| Variable | Required | Default | Example Value |
|----------|----------|---------|---------------|
| `ROCKIT_ROOT_PATH` | Yes | *None* | `/home/user/.rockit/profiles` |
| `ROCKIT_METADATA_PROFILE_INDEX_FILE` | No | `metadata-profile-index.json` | `custom-index.json` |
| `ROCKIT_REMOTE_PROFILE_PROVIDER_CONFIG_FILE` | No | `remote-profile-providers.json` | `my-providers.json` |
| `ROCKIT_REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE` | No | `RocKIT.RemoteProfileProvider` | `rockit-profiles-v2` |

### Index File Structure

The master index file (`metadata-profile-index.json`) contains:

```json
{
  "schemas": [
    {
      "id": "uuid-generated-123",
      "name": "Researcher Profile Template",
      "version": "1.0.0",
      "source": "remote",
      "type": "cedar",
      "files": {
        "sourcePath": "metadata-profiles/cedar/researcher-profile.json",
        "convertedPath": "metadata-profiles/ro-crate/researcher-profile-rocrate.json"
      },
      "aux": {
        "templateUuid": "cedar-uuid-456",
        "reference": "researcher-profile-ref"
      },
      "conformsTo": "https://schema.researchdata.hu/w3id/researcher-profile/1.0.0",
      "downloadUrl": "https://repo.schema.researchdata.hu/templates/researcher-profile.json",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": null,
      "downloadedAt": "2024-01-15T10:30:05Z"
    }
  ]
}
```

### Provider Configuration File Structure

The remote provider configuration file (`remote-profile-providers.json`) contains:

```json
{
  "providers": [
    {
      "id": "cedar-production",
      "title": "CEDAR Production Repository",
      "baseUrl": "https://repo.schema.researchdata.hu/api/",
      "domainBase": "schema.researchdata.hu",
      "type": "CEDAR"
    },
    {
      "id": "cedar-development",
      "title": "CEDAR Development Repository",
      "baseUrl": "https://repo.cedardev.dsd.sztaki.hu/api/",
      "domainBase": "cedardev.dsd.sztaki.hu",
      "type": "CEDAR"
    }
  ]
}
```

**Note**: API keys are NOT stored in this file—they are securely stored using keytar with the service identifier specified by `ROCKIT_REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE`.

## Data Flow

### Schema Import Workflow (File)

```
User Action: Click "Import from File"
    │
    ▼
File Dialog Opens → User Selects JSON Files
    │
    ▼
MetadataProfileManagerService.importFromFile()
    │
    ├─▶ Validate file structure and required fields
    ├─▶ Extract schema:name, pav:version, @id
    ├─▶ Generate unique UUID for profile id
    ├─▶ Convert Cedar template to RO-Crate profile
    │     (using cedar-template-converter library)
    ├─▶ Save source file to metadata-profiles/cedar/
    ├─▶ Save converted file to metadata-profiles/ro-crate/
    └─▶ Update index with new profile entry
    │
    ▼
Index Synchronization Check → onDidChangeSchemas event emitted
    │
    ▼
UI Table Refreshes → New schema appears in list
```

### Schema Import Workflow (Remote URL)

```
User Action: Click "Import from URL" / Enter URL
    │
    ▼
MetadataProfileManagerService.importFromUrl()
    │
    ├─▶ Resolve hostname against configured providers
    ├─▶ Attempt request with stored API key (if provider has one)
    ├─▶ On 401/403: Retry without authentication (fallback)
    ├─▶ Validate response is valid JSON schema
    ├─▶ Process and save as in file import workflow
    └─▶ Update index
    │
    ▼
UI Refreshes with new remote schema entry
```

### RO-Crate Profile Merging Workflow

```
User Action: Associate profile with RO-Crate entity
    │
    ▼
AppStateService.roCrate updated with conformsTo URL
    │
    ▼
RoCrateLoaderContribution.watchSchemaChanges() detects change
    │
    ▼
refreshCompleteProfile() triggered
    │
    ├─▶ Extract all conformsTo URLs from RO-Crate metadata
    ├─▶ Match each URL against managed profiles
    ├─▶ For each match:
    │     └─▶ Load converted profile content
    │          └─▶ Merge into completeProfile via profileManager.getMergedProfile()
    │
    ▼
AppStateService.completeProfile updated → Form generation uses merged profile
```

## Troubleshooting

### Common Issues and Solutions

#### Issue: Schema Not Appearing in Table After Import

**Symptoms**: Import completes without error, but new schema doesn't appear in the table.

**Solutions**:
1. Click the **Refresh** button to force index reload
2. Check `ROCKIT_ROOT_PATH` environment variable points to correct directory
3. Verify `metadata-profile-index.json` exists and is valid JSON:
   ```bash
   cat $ROCKIT_ROOT_PATH/metadata-profile-index.json | jq .
   ```
4. If corrupted, delete the index file—the extension will regenerate it on next import

#### Issue: "Failed to Connect" When Testing Provider

**Symptoms**: Connection test fails with network error or timeout.

**Solutions**:
1. Verify `baseUrl` is correct and accessible from your environment
2. Check firewall/proxy settings that may block API access
3. If using API key, verify it's valid for the specified endpoint
4. Test connectivity manually:
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" https://your-provider/api/health
   ```

#### Issue: API Key Not Being Used for Remote Requests

**Symptoms**: 401 errors when accessing protected templates, even with configured key.

**Solutions**:
1. Verify provider configuration has `apiKey` field populated (stored in keytar)
2. Check `ROCKIT_REMOTE_PROFILE_PROVIDER_KEYTAR_SERVICE` matches the service identifier used during setup
3. Clear and re-enter API key via provider config dialog
4. On Linux, verify keytar can access system credential store:
   ```bash
   node -e "const keytar = require('keytar'); keytar.findPassword('RocKIT.RemoteProfileProvider', 'cedar-production').then(console.log).catch(console.error)"
   ```

#### Issue: Index Contains Orphaned Entries

**Symptoms**: Table shows schemas whose files have been deleted manually.

**Solutions**:
1. The extension performs automatic self-healing on startup via `synchronizeIndex()`
2. Manually trigger sync by clicking **Refresh** button
3. For persistent issues, delete the index file and re-import all profiles:
   ```bash
   rm $ROCKIT_ROOT_PATH/metadata-profile-index.json
   # Restart application - index will be regenerated
   ```

#### Issue: UUID Generation Fails in Offline Environment

**Symptoms**: Error about `crypto.randomUUID()` not available.

**Solutions**:
1. The extension includes a fallback pure JavaScript UUID generator
2. Ensure Node.js version is 18+ for native crypto support
3. If using older Node, the fallback will generate valid but non-cryptographic UUIDs

#### Issue: Schema Conversion Produces Invalid RO-Crate Profile

**Symptoms**: Converted profile fails validation or form generation errors.

**Solutions**:
1. Verify source Cedar template has required fields: `schema:name`, `pav:version`
2. Check template follows CEDAR schema format specifications
3. Review conversion logs in application console for detailed error messages
4. Test conversion independently using the `cedar-template-converter` library

### Debug Mode

Enable verbose logging by setting environment variable before starting application:

```bash
export METADATA_SCHEMA_DEBUG=true
yarn start
```

This will output detailed operation logs including:
- Index synchronization details
- API request/response headers
- Conversion process steps
- File system operations

## Best Practices

### Schema Naming Conventions

Follow these conventions for consistent schema management:

1. **Descriptive Names**: Use clear, descriptive names that indicate the template's purpose
   - ✅ `Researcher Profile Template`
   - ❌ `Template1`

2. **Version Format**: Use semantic versioning (MAJOR.MINOR.PATCH)
   - ✅ `1.0.0`, `2.1.3`
   - ❌ `v1`, `release-2024`

3. **Reference IDs**: Use kebab-case for @id references
   - ✅ `researcher-profile-template`
   - ❌ `ResearcherProfileTemplate`, `researcher_profile_template`

### Index Maintenance

For optimal performance and reliability:

1. **Regular Refreshes**: Click the Refresh button periodically to ensure index consistency
2. **Backup Index File**: Before major operations, copy `metadata-profile-index.json`:
   ```bash
   cp $ROCKIT_ROOT_PATH/metadata-profile-index.json metadata-profile-index.backup.json
   ```
3. **Monitor Disk Space**: The extension stores both source and converted files—ensure adequate storage

### Security Considerations

1. **API Key Storage**: API keys are stored in system secure storage (keytar), NOT in configuration files
2. **Environment Variables**: Never commit environment variable values to version control
3. **Remote Provider URLs**: Verify provider URLs before adding them to your configuration
4. **File Permissions**: Ensure `ROCKIT_ROOT_PATH` directory has appropriate read/write permissions

### Performance Optimization

For large schema collections:

1. **Use Pagination**: The table supports pagination—avoid loading all schemas at once if possible
2. **Search Efficiency**: Use specific search terms rather than broad filters for faster results
3. **Batch Operations**: Group related deletions or associations to minimize index updates

### Extension Integration Guidelines

When integrating with other RocKIT extensions:

1. **Use the Protocol**: Always interact via `MetadataProfileManager` interface, not direct service access
2. **Listen for Events**: Subscribe to `onDidChangeSchemas` event for real-time updates
3. **Handle Errors Gracefully**: Schema operations may fail—implement retry logic where appropriate
4. **Respect Concurrency**: The service uses mutex locking for index access—don't bypass this mechanism

---

## Contributing

Contributions to the Metadata Profile Manager extension are welcome! Please follow these guidelines:

1. **Code Style**: Follow TypeScript best practices and existing code conventions
2. **Testing**: Add unit tests for new functionality in `src/browser/services/*.spec.ts`
3. **Documentation**: Update this README.md when adding features or changing behavior
4. **Commit Messages**: Use conventional commits format (e.g., `feat: add schema export function`)

## Authorship

This package is maintained by SZTAKI, Department of Distributed Systems
(<https://dsd.sztaki.hu>).

Individual contributors are listed in `package.json`.

## License

This package is licensed under the Apache License, Version 2.0. See
[LICENSE.md](../../LICENSE.md) for details.
