import type { ToolDefinition } from './types'

export const CHANGE_SET_ALLOWED_KEYS = new Set<string>([
  'addEntities',
  'updateEntities',
  'removeEntities',
  'setRootFields',
  'addHasPart',
  'removeHasPart',
  'mergeContext',
])

export const CHANGE_SET_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    addEntities: { type: 'array', items: { type: 'object' } },
    updateEntities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          '@id': { type: 'string' },
          merge: { type: 'object' },
          unset: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    removeEntities: { type: 'array', items: { type: 'string' } },
    setRootFields: { type: 'object' },
    addHasPart: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dataset: { type: 'string' },
          child: { type: 'string' },
        },
      },
    },
    removeHasPart: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dataset: { type: 'string' },
          child: { type: 'string' },
        },
      },
    },
    mergeContext: { type: 'object' },
  },
  additionalProperties: false,
  description:
    'Canonical keys: addEntities, updateEntities, removeEntities, setRootFields, addHasPart, removeHasPart, mergeContext. updateEntities supports merge (set fields) and unset (remove fields).',
}

export const tools: ToolDefinition[] = [
  {
    name: 'search',
    description:
      'Search the web using Tavily. Requires TAVILY_API_KEY environment variable.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'number' },
        include_raw_content: { type: 'boolean' },
        search_depth: { type: 'string', enum: ['basic', 'advanced'] },
        apiKey: {
          type: 'string',
          description:
            'Optional Tavily API key fallback when TAVILY_API_KEY is not set on the server.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'download_url',
    description:
      'Download one URL. raw_html=true returns page source, otherwise returns extracted readable text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        raw_html: { type: 'boolean' },
        timeout_ms: { type: 'number' },
        max_chars: { type: 'number' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'upload_rocrate_to_dataverse',
    description:
      'Upload to Dataverse ARP API. New dataset (no pid) uploads ZIP (ro-crate-metadata.json + referenced files, local mode only). Existing dataset (pid) posts JSON metadata update.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        pid: {
          type: 'string',
          description: 'Optional PID for update endpoint (/api/arp/rocrate/{pid}).',
        },
        baseUrl: {
          type: 'string',
          description:
            'Optional Dataverse base URL. Defaults to DATAVERSE_BASE_URL or http://localhost:8080.',
        },
        ownerId: {
          type: 'string',
          description:
            'Optional ownerId for new uploads. Defaults to DATAVERSE_OWNER_ID or root.',
        },
        apiKey: { type: 'string', description: 'Optional X-Dataverse-key override.' },
        timeoutMs: { type: 'number' },
        write: { type: 'boolean', enum: [true] },
        profileContextId: { type: 'string' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        indent: { type: 'number' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['write'],
      additionalProperties: false,
    },
  },
  {
    name: 'adopt_pending_dataverse_rocrate',
    description:
      'Replace the local RO-Crate metadata with a Dataverse-updated RO-Crate previously returned by upload_rocrate_to_dataverse as pendingDataverseCrate. Requires write=true.',
    inputSchema: {
      type: 'object',
      properties: {
        pendingId: {
          type: 'string',
          description: 'The pendingDataverseCrate.id returned by upload_rocrate_to_dataverse.',
        },
        write: { type: 'boolean', enum: [true] },
        indent: { type: 'number' },
      },
      required: ['pendingId', 'write'],
      additionalProperties: false,
    },
  },
  {
    name: 'download_rocrate_from_dataverse',
    description:
      'Download crate JSON from Dataverse ARP API by PID. In local mode, requires write=true to persist on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        pid: { type: 'string' },
        version: { type: 'string' },
        baseUrl: {
          type: 'string',
          description:
            'Optional Dataverse base URL. Defaults to DATAVERSE_BASE_URL or http://localhost:8080.',
        },
        apiKey: { type: 'string', description: 'Optional X-Dataverse-key override.' },
        timeoutMs: { type: 'number' },
        write: { type: 'boolean' },
        indent: { type: 'number' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['pid'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_crate',
    description:
      'Read and return RO-Crate JSON. local mode reads ro-crate-metadata.json from disk; remote mode uses provided crate payload.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: {
          type: 'string',
          description: 'Path to ro-crate-metadata.json in local mode.',
        },
        crate: { type: 'object', description: 'RO-Crate JSON payload in remote mode.' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'apply_changes',
    description:
      'Apply compact change-set to crate. By default, local mode persists changes. Set dryRun=true to preview without writing. cratePath must be the ro-crate-metadata.json location to write to in local mode; in remote mode, cratePath is ignored and crate payload is required.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: {
          type: 'string',
          description:
            'Local mode: metadata file path or dataset directory containing ro-crate-metadata.json.',
        },
        crate: { type: 'object' },
        changeSet: CHANGE_SET_INPUT_SCHEMA,
        dryRun: {
          type: 'boolean',
          description:
            'If true, computes and validates changes but does not persist in local mode. Default false.',
        },
        write: {
          type: 'boolean',
          description: 'Deprecated compatibility flag. Ignored.',
        },
        confirmDestructive: {
          type: 'boolean',
          description:
            'Required for destructive edits (removeEntities, removeHasPart, updateEntities.unset, or setRootFields.hasPart). Must be true only with explicit user approval.',
        },
        indent: { type: 'number' },
        profileContextId: { type: 'string' },
        profileRequiredMode: {
          type: 'string',
          enum: ['allow_missing', 'enforce_required'],
          description:
            'allow_missing keeps required-field gaps as warnings; enforce_required fails on missing required profile fields.',
        },
        contextMode: {
          type: 'string',
          enum: ['strict', 'auto_add', 'auto_reconcile'],
          description:
            'strict: no auto context edits; auto_add: add missing mappings; auto_reconcile: also fix mapping conflicts.',
        },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        responseMode: {
          type: 'string',
          enum: ['summary', 'full'],
          description: 'summary returns compact output; full returns full payload/crate.',
        },
      },
      required: ['changeSet'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_profile_conforms_to',
    description:
      'Update conformsTo profile URL(s) on one Dataset/File entity (default "./"). Supports add/remove/set. Requires write=true.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        entityId: { type: 'string' },
        add: { type: 'array', items: { type: 'string' } },
        remove: { type: 'array', items: { type: 'string' } },
        set: { type: 'array', items: { type: 'string' } },
        write: { type: 'boolean', enum: [true] },
        indent: { type: 'number' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['write'],
      additionalProperties: false,
    },
  },
  {
    name: 'validate_crate',
    description:
      'Validate crate structure and references. Includes profile-conformance checks and value-set (enum) violations/hints from active profiles. local mode loads crate from disk; remote mode validates provided crate payload.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: {
          type: 'string',
          description:
            'Local mode: metadata file path or dataset directory containing ro-crate-metadata.json.',
        },
        crate: { type: 'object' },
        strict: { type: 'boolean' },
        profileContextId: { type: 'string' },
        profileRequiredMode: {
          type: 'string',
          enum: ['allow_missing', 'enforce_required'],
          description:
            'allow_missing keeps required-field gaps as warnings; enforce_required fails on missing required profile fields.',
        },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'write_crate_atomic',
    description:
      'Atomically write crate JSON to disk at cratePath. Applies contextMode auto context reconciliation before profile validation (default auto_reconcile).',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: {
          type: 'string',
          description:
            'Local mode: metadata file path or dataset directory containing ro-crate-metadata.json.',
        },
        crate: { type: 'object' },
        indent: { type: 'number' },
        profileContextId: { type: 'string' },
        profileRequiredMode: {
          type: 'string',
          enum: ['allow_missing', 'enforce_required'],
          description:
            'allow_missing keeps required-field gaps as warnings; enforce_required fails on missing required profile fields.',
        },
        contextMode: {
          type: 'string',
          enum: ['strict', 'auto_add', 'auto_reconcile'],
          description:
            'strict: no auto context edits; auto_add: add missing mappings; auto_reconcile: also fix mapping conflicts.',
        },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        responseMode: {
          type: 'string',
          enum: ['summary', 'full'],
          description: 'summary returns compact output; full returns full payload/crate.',
        },
      },
      required: ['crate'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_rocrate_context',
    description:
      'Return crate context and profile hints. Detects conformsTo profile URL and emits schema resolution guidance.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        profileContextId: { type: 'string' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_context_terms',
    description:
      'Suggest mergeContext mappings for terms used in @graph but not declared in @context and not known from default RO-Crate context.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        profileContextId: { type: 'string' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_schema_registry',
    description:
      'List persisted ontology schema registry entries used by ontology query tools.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'register_schema',
    description:
      'Register or update one ontology schema source entry in the persisted schema registry.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        id: { type: 'string' },
        displayName: { type: 'string' },
        matchesUrls: { type: 'array', items: { type: 'string' } },
        schemaUrl: { type: 'string' },
        activeOnSpec: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'displayName', 'matchesUrls', 'schemaUrl'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_types',
    description:
      'List distilled ontology class/type candidates available from shared context+schema catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        search: { type: 'string' },
        offset: { type: 'number' },
        limit: { type: 'number' },
        eagerLoadSchemas: { type: 'boolean' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_types',
    description:
      'Suggest best matching ontology types for a free-text query using shared catalog ranking.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        query: { type: 'string' },
        limit: { type: 'number' },
        eagerLoadSchemas: { type: 'boolean' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_type_details',
    description:
      'Get details for one ontology type (label/comment/parents/property count).',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        typeId: { type: 'string' },
        eagerLoadSchemas: { type: 'boolean' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['typeId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_properties_for_type',
    description:
      'List distilled properties for a given type, optionally including inherited properties.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        typeId: { type: 'string' },
        includeInherited: { type: 'boolean' },
        search: { type: 'string' },
        offset: { type: 'number' },
        limit: { type: 'number' },
        eagerLoadSchemas: { type: 'boolean' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['typeId'],
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_properties',
    description:
      'Suggest best matching properties for a query constrained by one or more type IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        typeIds: { type: 'array', items: { type: 'string' } },
        query: { type: 'string' },
        limit: { type: 'number' },
        eagerLoadSchemas: { type: 'boolean' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['typeIds', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_property_details',
    description:
      'Get details for one ontology property (label/comment/domain/range).',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        propertyId: { type: 'string' },
        eagerLoadSchemas: { type: 'boolean' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['propertyId'],
      additionalProperties: false,
    },
  },
  {
    name: 'resolve_profile_schema',
    description:
      'Resolve profile URL to profile records and converted profile file paths via metadata-schema-index.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        profileUrl: { type: 'string' },
        includeProfileContent: { type: 'boolean' },
        profileContextId: { type: 'string' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
      },
      required: ['profileUrl'],
      additionalProperties: false,
    },
  },
  {
    name: 'prepare_remote_profile_payload',
    description:
      'Prepare schemaIndex/profileContents payload from local profile mappings so callers can pass it to remote-mode profile-aware tools.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        profileUrls: {
          type: 'array',
          items: { type: 'string' },
        },
        includeProfileContent: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_profile_context',
    description:
      'Create server-side cached profile context and return profileContextId for reuse in remote profile-aware tool calls.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        profileUrls: {
          type: 'array',
          items: { type: 'string' },
        },
        includeProfileContent: { type: 'boolean' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        ttlSec: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_profile_context_info',
    description:
      'Return metadata summary for a cached profileContextId without returning full profile contents.',
    inputSchema: {
      type: 'object',
      properties: {
        profileContextId: { type: 'string' },
      },
      required: ['profileContextId'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_profile_context',
    description: 'Delete a cached profileContextId from server memory.',
    inputSchema: {
      type: 'object',
      properties: {
        profileContextId: { type: 'string' },
      },
      required: ['profileContextId'],
      additionalProperties: false,
    },
  },
]
