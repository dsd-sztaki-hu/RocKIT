# rocrate-mcp-server

MCP server for RO-Crate editing, validation, and profile-aware constraints.

## Transport vs mode

- Transports:
  - **stdio server** (JSON-RPC over `Content-Length` framing)
  - **UNIX socket daemon** (`--listen <socketPath>`) with stdio proxy clients
    (`--connect <socketPath>`)
  - one-shot daemon bootstrap (`--ensure-daemon <socketPath>`)
- Compatibility: also accepts newline-delimited JSON-RPC (JSONL fallback).
- Access mode (`mode` tool arg): **`local`** or **`remote`**.

Important: `remote` is an RO-Crate data-access mode, **not** HTTP/SSE transport.

### Recommended multi-agent topology

For multiple agents (Codex/Claude/Gemini/Qwen/OpenCode), run one shared daemon
and have each agent connect through proxy mode:

1. Ensure daemon is running (idempotent):
   ```bash
   node /absolute/path/to/rocrate-mcp-server/lib/server.js --ensure-daemon /Users/<you>/.aroma/rocrate-mcp-server.sock
   ```
2. Configure each MCP client to launch:
   ```bash
   node /absolute/path/to/rocrate-mcp-server/lib/server.js --connect /Users/<you>/.aroma/rocrate-mcp-server.sock
   ```

This avoids one full server per agent process and keeps all telemetry in one
dashboard instance.

## Tools

- `search`: Tavily-backed web search (`TAVILY_API_KEY`, optional per-call `apiKey` fallback).
- `download_url`: download and extract text/raw HTML from one URL.
- `upload_rocrate_to_dataverse`: Dataverse upload (`write: true` required):
  - create (no `pid`): ZIP upload (`ro-crate-metadata.json` + referenced files), local mode only.
  - update (with `pid`): JSON metadata POST to update existing dataset.
- `download_rocrate_from_dataverse`: download crate JSON by PID from Dataverse ARP API.
- `read_crate`: read crate (`local` from disk or `remote` from provided `crate` payload).
- `apply_changes`: apply compact changeset.
  - Local mode persists by default.
  - Use `dryRun: true` to preview without writing.
  - `updateEntities` supports `merge` (set fields) and `unset` (remove fields).
  - `updateEntities` targets must already exist in `@graph`; missing IDs are rejected.
  - Destructive changes require `confirmDestructive: true` after explicit user approval:
    `removeEntities`, `removeHasPart`, `updateEntities.unset`, `setRootFields.hasPart`.
  - `contextMode` controls auto-`@context` handling:
    - `strict`: no automatic context edits.
    - `auto_add`: add missing profile-derived term mappings only.
    - `auto_reconcile`: add missing mappings and reconcile conflicting existing mappings.
  - Default `contextMode` is `auto_reconcile`.
  - `conformsTo` edits are prohibited in `apply_changes`.
- `update_profile_conforms_to`: update `conformsTo` profile URLs on one Dataset/File entity using `add`/`remove`/`set`; requires `write: true`.
- `validate_crate`: RO-Crate + profile-aware validation.
- `write_crate_atomic`: atomic write in local mode.
  - Supports `contextMode` (`strict` | `auto_add` | `auto_reconcile`) like `apply_changes`.
  - Default `contextMode` is `auto_reconcile`.
- `get_rocrate_context`: summary context including profile resolution hints.
- `suggest_context_terms`: suggest `mergeContext` mappings for used-but-undeclared terms.
- `list_schema_registry`: list persisted ontology schema registry entries.
- `register_schema`: add or replace one ontology schema registry entry.
- `list_types`: list distilled ontology type candidates from shared context+schema catalog.
- `suggest_types`: suggest matching ontology types for a free-text query.
- `get_type_details`: fetch details for one type (parents, comment, property count).
- `list_properties_for_type`: list properties for one type (optional inherited expansion).
- `suggest_properties`: suggest matching properties for query + selected type(s).
- `get_property_details`: fetch details for one property (domain/range/comment).
- `resolve_profile_schema`: resolve one profile URL via schema index/profile inputs.
- `prepare_remote_profile_payload`: build `schemaIndex` + `profileContents` payload for remote calls.
- `create_profile_context`: cache profile payload server-side; returns `profileContextId`.
- `get_profile_context_info`: inspect cached profile context metadata.
- `delete_profile_context`: delete cached profile context.

## Shared ontology core dependency

Ontology query/suggestion tools are backed by the shared library:

- `dev-packages/rocrate-context-core`

Current server integration loads:

- `dev-packages/rocrate-context-core/lib/index.js`

So before running `rocrate-mcp-server`, build the shared lib at least once:

```bash
./node_modules/.bin/tsc -p dev-packages/rocrate-context-core/tsconfig.json
```

## Dashboard

The RO-Crate MCP server includes a built-in web dashboard for real-time monitoring and debugging. The dashboard provides:

- **Live telemetry**: Tool calls, sessions, errors, and latency metrics
- **Session inspection**: View detailed information per MCP session
- **Tool call details**: Inspect parameters and results (with detailed logging enabled)
- **Error tracking**: Recent errors with timestamps and stack traces
- **Dependency monitoring**: External service call tracking (Tavily, Dataverse)
- **Runtime configuration**: Toggle detailed logging and adjust retention settings

### Accessing the Dashboard

By default, the dashboard starts automatically at `http://127.0.0.1:9393`. Open this URL in your browser to view the dashboard.

Notes:
- Sessions are connection-scoped: each active `--connect` client appears as a
  separate dashboard session.
- `Requests` is the per-session tool call count.

### Dashboard Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ROCRATE_DASHBOARD_ENABLED` | Enable/disable dashboard | `true` (enabled) |
| `ROCRATE_DASHBOARD_HOST` | Dashboard bind address | `127.0.0.1` |
| `ROCRATE_DASHBOARD_PORT` | Dashboard port | `9393` |
| `ROCRATE_DASHBOARD_AUTH_TOKEN` | Optional bearer token for authentication | (none) |
| `ROCRATE_DASHBOARD_RETENTION_HOURS` | Data retention period | `24` |
| `ROCRATE_DASHBOARD_DETAILED_LOGGING` | Store tool params/results | `true` |

### Dashboard API Endpoints

The dashboard exposes read-only APIs (plus one config write endpoint):

- `GET /` - Dashboard UI
- `GET /health` - Server health and uptime
- `GET /metrics/summary?minutes=N` - Summary statistics
- `GET /metrics/tools?minutes=N` - Tool-specific stats
- `GET /sessions` - List all sessions
- `GET /sessions/:id` - Session details with tool calls
- `GET /errors/recent?limit=N` - Recent errors
- `GET /dependencies` - External dependency usage
- `GET /timeseries?interval=N&minutes=N` - Time-series data
- `GET /tool-calls/:id` - Detailed tool call info
- `GET /config` - Get current configuration
- `POST /config` - Update configuration (detailed logging, retention)
- `GET /schema-registry?mode=local|remote` - List schema registry entries
- `POST /schema-registry` - Register/replace schema entry
- `PUT /schema-registry/:id` - Update schema entry
- `DELETE /schema-registry/:id?mode=local|remote` - Remove schema entry

### Memory Management

The dashboard uses bounded in-memory storage with automatic cleanup:

- Max 100 sessions
- Max 10,000 tool calls
- Max 1,000 error events
- Data older than retention period is automatically purged

### Detailed Logging

By default, tool call parameters and results are stored. Disable detailed logging if you need lower memory usage:

1. Set `ROCRATE_DASHBOARD_DETAILED_LOGGING=false` before starting the server, or
2. Toggle it via the Settings modal in the dashboard UI

With detailed logging enabled:
- Tool parameters are truncated at 100KB
- Results are truncated at 100KB
- Error messages show full stack traces

## Local vs remote access mode

- `mode: "local"` (default): server reads/writes `ro-crate-metadata.json` on its filesystem.
- `mode: "remote"`: caller passes full crate JSON; no local file access required.

Notes:

- `apply_changes` writes by default in local mode (unless `dryRun: true`).
- `validate_crate` reports dangling local `@id` references as errors across
  entity-reference properties (not only `hasPart`).
- Profile enforcement is entity-local for `Dataset`/`File` entities:
  - If entity has profile `conformsTo` URL(s), only profile-allowed types and
    properties are accepted.
  - If entity has no profile `conformsTo`, any property declared in effective
    `@context` is allowed.
- `apply_changes` always blocks direct `conformsTo` edits on `Dataset`/`File`
  entities. Use `update_profile_conforms_to` instead.
- `update_profile_conforms_to` requires `write: true` in both modes.
- `apply_changes(dryRun=false)` and `write_crate_atomic` only persist in local mode.
- In remote mode, write requests return updated crate payload and do not persist files.
- `upload_rocrate_to_dataverse` always runs strict preflight validation:
  core RO-Crate strict checks plus profile validation with
  `profileRequiredMode=enforce_required`. Upload is blocked on any validation error.
- `upload_rocrate_to_dataverse` also calls Dataverse
  `/api/arp/validateRoCrate?strict=true` before upload and blocks if Dataverse
  reports any validation issue.
- Upload preflight enforces context coverage for used terms:
  used `@graph` fields must be declared in `@context` unless treated as
  default RO-Crate context terms.
- `upload_rocrate_to_dataverse` create flow requires local mode and zips
  `ro-crate-metadata.json` together with files referenced by `File` entities
  in the crate graph.

## Response mode (`responseMode`)

Heavy tools support `responseMode: "summary" | "full"`:

- `read_crate`
- `apply_changes`
- `update_profile_conforms_to`
- `validate_crate`
- `write_crate_atomic`
- `get_rocrate_context`
- `suggest_context_terms`

Defaults:

- Local mode defaults to `summary` for `read_crate`, `apply_changes`, `write_crate_atomic`.
- Local mode defaults to `summary` for `update_profile_conforms_to`.
- Remote mode defaults to `full` for `read_crate`, `apply_changes`, `update_profile_conforms_to`, `write_crate_atomic` so updated crate payload is available to caller.
- `validate_crate` and `get_rocrate_context` default to `summary`.
- `suggest_context_terms` defaults to `summary` in local mode, `full` in remote mode.

Use `responseMode: "full"` only when caller explicitly needs full crate or full report payloads.

## Profile-aware behavior

Profile resolution can come from:

- Local mode:
  - `~/.aroma/metadata-schema-index.json` (or env overrides)
  - converted profile files referenced by index entries
- Remote mode:
  - caller-supplied `schemaIndex`
  - caller-supplied `profileContents`
  - or server-cached `profileContextId`

Validation/write knobs:

- `profileRequiredMode`: `allow_missing` or `enforce_required`
- `contextMode`: `strict`, `auto_add`, or `auto_reconcile` (default)

Recommended:

- Interactive editing: `allow_missing`
- Pre-publication gate: `enforce_required`

Profile activation:

- Use `update_profile_conforms_to` first when user asks to add/remove/replace
  profile URLs on the crate.
- Profile scope is entity-local: profile fields apply only to entities that
  explicitly declare the profile URL in their own `conformsTo`.
- This tool only mutates `conformsTo` and intentionally does not enforce
  profile conformance at activation time, so pre-existing unrelated profile
  violations do not block profile attachment.
- After profile activation, use normal profile-aware edit/validate flow
  (`apply_changes`, `validate_crate`).

## Build, test, run

```bash
yarn workspace rocrate-mcp-server build
yarn workspace rocrate-mcp-server test
yarn workspace rocrate-mcp-server start
```

Recommended first-time build order:

```bash
./node_modules/.bin/tsc -p dev-packages/rocrate-context-core/tsconfig.json
yarn workspace rocrate-mcp-server build
```

### Run modes

Direct stdio server:

```bash
node /absolute/path/to/rocrate-mcp-server/lib/server.js
```

Shared daemon:

```bash
# Start daemon explicitly
node /absolute/path/to/rocrate-mcp-server/lib/server.js --listen /Users/<you>/.aroma/rocrate-mcp-server.sock

# Or start only if needed
node /absolute/path/to/rocrate-mcp-server/lib/server.js --ensure-daemon /Users/<you>/.aroma/rocrate-mcp-server.sock

# Per-agent proxy client
node /absolute/path/to/rocrate-mcp-server/lib/server.js --connect /Users/<you>/.aroma/rocrate-mcp-server.sock
```

## Environment variables

### Server Configuration
- `ROCRATE_MCP_DEFAULT_MODE` (optional): default mode if tool arg omitted (`local` or `remote`).

### External Services
- `TAVILY_API_KEY`: Tavily key for `search`.
- `TAVILY_API_URL` (optional): Tavily endpoint override.
- `DATAVERSE_BASE_URL` (optional): Dataverse/ARP base URL for upload/download tools (default `http://localhost:8080`).
- `DATAVERSE_OWNER_ID` (optional): owner ID for new uploads (default `root`).
- `DATAVERSE_API_KEY` (optional): API key used as `X-Dataverse-key` header.

### Profile Resolution
- `AROMA_ROOT_PATH` (optional): base directory for schema index/profile files (default `~/.aroma`).
- `AROMA_METADATA_SCHEMA_INDEX_FILE` (optional): schema index filename or absolute path.
- `ROCRATE_REMOTE_SCHEMA_REGISTRY_DIR` (optional): remote-mode schema registry directory (default `~/.aroma/schema-registry-remote`).

### Dashboard
- `ROCRATE_DASHBOARD_ENABLED`: Enable/disable dashboard (default: `true`).
- `ROCRATE_DASHBOARD_HOST`: Dashboard bind address (default: `127.0.0.1`).
- `ROCRATE_DASHBOARD_PORT`: Dashboard port (default: `9393`).
- `ROCRATE_DASHBOARD_AUTH_TOKEN` (optional): Bearer token for dashboard authentication.
- `ROCRATE_DASHBOARD_RETENTION_HOURS`: Data retention period in hours (default: `24`).
- `ROCRATE_DASHBOARD_DETAILED_LOGGING`: Store tool params/results (default: `true`).

## MCP client configuration examples

Use absolute paths for both `command` and `args`.

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.rocrate]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/rocrate-mcp-server/lib/server.js", "--connect", "/Users/<you>/.aroma/rocrate-mcp-server.sock"]
startup_timeout_sec = 30
env = { ROCRATE_MCP_DEFAULT_MODE = "local" }
```

If you do not run a shared daemon, fallback to direct stdio by removing
`--connect` and socket args.

### Claude Code

Prefer CLI-based setup:

```bash
claude mcp add-json -s user rocrate '{"type":"stdio","command":"/absolute/path/to/node","args":["/absolute/path/to/rocrate-mcp-server/lib/server.js"],"env":{"ROCRATE_MCP_DEFAULT_MODE":"local"}}'
```

For shared daemon mode, set args to:
`["/absolute/path/to/rocrate-mcp-server/lib/server.js","--connect","/Users/<you>/.aroma/rocrate-mcp-server.sock"]`

Then verify:

```bash
claude mcp get rocrate
```

### Gemini CLI (`~/.gemini/settings.json`)

Gemini CLI uses `mcpServers` in settings JSON (user-level `~/.gemini/settings.json`, or project-level `.gemini/settings.json`).

```json
{
  "mcpServers": {
    "rocrate": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/rocrate-mcp-server/lib/server.js", "--connect", "/Users/<you>/.aroma/rocrate-mcp-server.sock"],
      "env": {
        "ROCRATE_MCP_DEFAULT_MODE": "local"
      }
    }
  }
}
```

### Qwen Code (`~/.qwen/settings.json`)

Qwen Code can use the same `mcpServers` JSON shape as Gemini-style clients.

```json
{
  "mcpServers": {
    "rocrate": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/rocrate-mcp-server/lib/server.js", "--connect", "/Users/<you>/.aroma/rocrate-mcp-server.sock"],
      "env": {
        "ROCRATE_MCP_DEFAULT_MODE": "local"
      }
    }
  }
}
```

### OpenCode (`~/.config/opencode/config.json`)

OpenCode expects `mcp` (not `mcpServers`):

```json
{
  "mcp": {
    "rocrate": {
      "type": "local",
      "enabled": true,
      "command": ["/absolute/path/to/node", "/absolute/path/to/rocrate-mcp-server/lib/server.js", "--connect", "/Users/<you>/.aroma/rocrate-mcp-server.sock"],
      "environment": {
        "ROCRATE_MCP_DEFAULT_MODE": "local"
      }
    }
  }
}
```
