# rocrate-mcp-server

MCP server for RO-Crate editing, validation, and profile-aware constraints.

## Install

After the package is published to npm, users can install the standalone MCP
server globally:

```bash
npm install -g rocrate-mcp-server
```

Run it directly over stdio:

```bash
rocrate-mcp-server
```

Or use the recommended shared daemon/proxy topology:

```bash
rocrate-mcp-server --ensure-daemon "$HOME/.aroma/rocrate-mcp-server.sock"
rocrate-mcp-server --connect "$HOME/.aroma/rocrate-mcp-server.sock"
```

Example MCP client configuration for a global install:

```json
{
  "mcpServers": {
    "rocrate": {
      "command": "rocrate-mcp-server",
      "args": [
        "--connect",
        "/Users/<you>/.aroma/rocrate-mcp-server.sock"
      ]
    }
  }
}
```

## Build and package

There are two build paths:

- Workspace build: used by the Theia/Electron application and local
  development.
- Standalone npm build: generates a self-contained npm package for
  `npm install -g rocrate-mcp-server`.

From the repository root, build the workspace server:

```bash
yarn build:rocrate-tools
```

Run the workspace-built server:

```bash
node theia-extensions/rocrate-mcp-server/lib/server.js
```

Build the standalone npm package directory:

```bash
yarn build:rocrate-mcp-standalone
```

This writes:

```text
theia-extensions/rocrate-mcp-server/dist/npm
```

Create the npm tarball:

```bash
yarn pack:rocrate-mcp-standalone
```

This writes:

```text
theia-extensions/rocrate-mcp-server/rocrate-mcp-server-<version>.tgz
```

To test the tarball locally:

```bash
npm install -g ./theia-extensions/rocrate-mcp-server/rocrate-mcp-server-<version>.tgz
rocrate-mcp-server
```

For the current `0.0.1` package version, run this from the repository root:

```bash
npm install -g ./theia-extensions/rocrate-mcp-server/rocrate-mcp-server-0.0.1.tgz
```

To publish to npm, publish the generated package directory:

```bash
cd theia-extensions/rocrate-mcp-server/dist/npm
npm publish
```

Do not publish the raw workspace package for the standalone distribution. The
generated `dist/npm` package bundles the internal workspace code required by
the MCP server while keeping the normal Theia/Electron workspace build
unchanged. The generated package includes:

- bundled `lib/server.js`
- dashboard static assets
- bundled `cedar-template-converter` dependency for dynamic CEDAR conversion

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
   rocrate-mcp-server --ensure-daemon /Users/<you>/.aroma/rocrate-mcp-server.sock
   ```
   Or, from a workspace build:
   ```bash
   node /absolute/path/to/rocrate-mcp-server/lib/server.js --ensure-daemon /Users/<you>/.aroma/rocrate-mcp-server.sock
   ```
2. Configure each MCP client to launch:
   ```bash
   rocrate-mcp-server --connect /Users/<you>/.aroma/rocrate-mcp-server.sock
   ```

This avoids one full server per agent process and keeps all telemetry in one
dashboard instance.

## Tools

- `set_agent_session_context`: record whether the agent was launched inside AROMA or externally.
- `read_agent_workflow_doc`: read bundled RO-Crate editing workflow guidance.
- `open_aroma_for_local_file`: register a local `ro-crate-metadata.json` through the local file bridge and return an AROMA URL.
- `search`: Tavily-backed web search (`TAVILY_API_KEY`, optional per-call `apiKey` fallback).
- `download_url`: download and extract text/raw HTML from one URL.
- `list_well_known_schemas`: browse/search configured CEDAR registry providers for known Dataverse metadata schemas.
- `list_remote_schema_tree`: browse configured CEDAR providers as a folder tree.
- `import_well_known_schema`: import a known CEDAR schema/profile into the shared profile store.
- `list_metadata_profiles`: list persisted CEDAR/recrate metadata profiles.
- `import_metadata_profile`: import a CEDAR metadata profile from URL or local source path.
- `delete_metadata_profile`: delete one persisted profile and its source/converted files.
- `upload_rocrate_to_dataverse`: Dataverse upload (`write: true` required):
  - create (no `pid`): ZIP upload (`ro-crate-metadata.json` + referenced files), local mode only.
  - update (with `pid`): JSON metadata POST to update existing dataset.
- `adopt_pending_dataverse_rocrate`: replace local metadata with the Dataverse-updated crate returned by upload.
- `download_rocrate_from_dataverse`: download crate JSON by PID from Dataverse ARP API.
- `read_crate`: read crate (`local` from disk or `remote` from provided `crate` payload).
- `create_default_rocrate`: initialize a directory with `ro-crate-metadata.json` and `.aroma/ignored.txt`.
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

## Internal code bundling

The standalone npm package is generated from this workspace package but is not
the same artifact as the workspace package. `build:standalone` uses esbuild to
bundle the MCP server and internal workspace packages into
`dist/npm/lib/server.js`.

Internal packages such as `rocrate-context-core`, `metadata-profile-core`, and
`aroma2-common` are resolved from the workspace at build time and bundled into
the generated CLI. The dynamic ESM dependency `cedar-template-converter` is
vendored into `dist/npm/node_modules` and marked as a bundled dependency so
global npm installs do not need the monorepo checkout.

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

The dashboard exposes read-only monitoring APIs plus configuration, schema,
profile, local-file bridge, and Tavily test endpoints:

- `GET /` - Dashboard UI
- `GET /static/*` - Dashboard static assets
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
- `POST /test/tavily-search` - Test Tavily search settings from the dashboard
- `GET /schema-registry?mode=local|remote` - List schema registry entries
- `POST /schema-registry` - Register/replace schema entry
- `PUT /schema-registry/:id` - Update schema entry
- `DELETE /schema-registry/:id?mode=local|remote` - Remove schema entry
- `GET /metadata-profiles` - List stored metadata profiles
- `POST /metadata-profiles/import-url` - Import a profile by URL
- `POST /metadata-profiles/import-known` - Import a well-known profile
- `GET /metadata-profiles/providers` - List remote schema providers
- `POST /metadata-profiles/providers` - Add a remote schema provider
- `PUT /metadata-profiles/providers` - Update a remote schema provider
- `DELETE /metadata-profiles/providers/:id` - Remove a remote schema provider
- `GET /metadata-profiles/remote-schemas` - Browse remote schemas
- `GET /metadata-profiles/remote-folder` - Browse a remote provider folder
- `GET /metadata-profiles/storage-status` - Inspect profile storage state
- `DELETE /metadata-profiles/:id` - Delete a metadata profile
- `GET /local-file?id=...` - Read a registered local RO-Crate file
- `PUT /local-file?id=...` - Save a registered local RO-Crate file
- `GET /local-file/events?id=...` - Server-sent events for local file updates

## Local File Bridge Protocol

The local file bridge lets the hosted AROMA web application edit a
`ro-crate-metadata.json` file that lives on the user's local filesystem. It is
not a general file server. A local MCP server process registers one specific
RO-Crate metadata file, exposes a short-lived HTTP session for that file, and
returns an AROMA URL containing the bridge URL.

### When it is used

Agents should call `open_aroma_for_local_file` after successful local edits or
validation when the user is working outside an already-open AROMA session and
would benefit from opening the result in the AROMA UI. Agents launched from
inside AROMA should call `set_agent_session_context` with
`launchContext: "inside_aroma"` and should not generate a bridge URL unless the
user explicitly asks.

### Registration flow

1. The MCP client calls:

   ```json
   {
     "name": "open_aroma_for_local_file",
     "arguments": {
       "path": "/absolute/path/to/ro-crate-metadata.json"
     }
   }
   ```

2. The MCP server validates that:
   - the local file bridge is enabled,
   - the dashboard HTTP server is enabled,
   - the target basename is exactly `ro-crate-metadata.json`,
   - the file exists and contains a JSON object with `@context` and `@graph`.

3. The server creates an in-memory session with a random id, starts watching the
   file, and returns:

   ```json
   {
     "aromaUrl": "https://repo.researchdata.hu/aroma?localFile=http%3A%2F%2F127.0.0.1%3A9393%2Flocal-file%3Fid%3D...",
     "localFileUrl": "http://127.0.0.1:9393/local-file?id=...",
     "eventsUrl": "http://127.0.0.1:9393/local-file/events?id=...",
     "path": "/absolute/path/to/ro-crate-metadata.json",
     "expiresAt": "..."
   }
   ```

4. The user opens `aromaUrl`. AROMA reads the `localFile` query parameter and
   uses the bridge endpoints to load, watch, and save the local file.

Use `aromaBaseUrl` to point at another AROMA deployment:

```json
{
  "path": "/absolute/path/to/ro-crate-metadata.json",
  "aromaBaseUrl": "http://localhost:3000"
}
```

### HTTP endpoints

`GET /local-file?id=<session-id>` returns the current file payload:

```json
{
  "id": "...",
  "path": "/absolute/path/to/ro-crate-metadata.json",
  "name": "ro-crate-metadata.json",
  "contentType": "application/json",
  "etag": "\"sha256:...\"",
  "mtime": "2026-06-14T08:00:00.000Z",
  "content": {
    "@context": "...",
    "@graph": []
  }
}
```

`PUT /local-file?id=<session-id>` saves a full RO-Crate JSON object. The request
must include `If-Match: <etag from GET>`. If the file changed since the caller
loaded it, the bridge returns `412` with the current ETag instead of
overwriting. Missing `If-Match` returns `428`.

`GET /local-file/events?id=<session-id>` opens a Server-Sent Events stream:

- `ready`: sent immediately with the current `etag` and `mtime`.
- `changed`: sent when the watched file content hash changes.
- `deleted`: sent if the watched file disappears.
- `error`: sent if the bridge cannot read or parse the watched file.
- comment heartbeats are sent every 25 seconds to keep the stream alive.

The bridge uses `fs.watchFile` with a 1 second polling interval. Saves are
atomic: the server writes a temporary file next to `ro-crate-metadata.json` and
renames it over the original.

### Session lifetime and security

Bridge sessions are in memory only and expire after 480 minutes by default.
Every successful bridge request refreshes the expiration time. Restarting the
MCP server invalidates all bridge URLs.

The bridge is intentionally narrow:

- only registered session ids can access files,
- only files named `ro-crate-metadata.json` can be registered,
- writes must be complete JSON objects with `@context` and `@graph`,
- browser CORS is restricted to configured origins,
- the bridge requires the local dashboard HTTP server.

Configure it with:

- `ROCRATE_LOCAL_FILE_BRIDGE_ENABLED=false` to disable bridge routes.
- `ROCRATE_LOCAL_FILE_BRIDGE_ALLOWED_ORIGINS` to override allowed browser origins.
- `ROCRATE_LOCAL_FILE_BRIDGE_SESSION_TTL_MINUTES` to change session TTL.
- `ROCRATE_DASHBOARD_HOST` and `ROCRATE_DASHBOARD_PORT` to control the local bridge URL host/port.

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

## Agent workflow docs

The server provides its RO-Crate editing workflow through MCP so agents do not
need copied instruction files in the dataset directory.

- Call `read_agent_workflow_doc()` first to read `rocrate_workflow.md`.
- Then call `read_agent_workflow_doc({ "name": "<doc-name>" })` for the step
  docs referenced by `rocrate_workflow.md`.
- The tool response includes `availableDocs` with all valid doc names.
- Unknown doc names fail with an error that lists the available docs.

## Build, test, run

```bash
yarn workspace rocrate-mcp-server build
yarn workspace rocrate-mcp-server test
yarn workspace rocrate-mcp-server start
```

Recommended first-time build order:

```bash
yarn build:rocrate-tools
```

### Run modes

Direct stdio server:

```bash
rocrate-mcp-server
# or from a workspace build:
node /absolute/path/to/rocrate-mcp-server/lib/server.js
```

Shared daemon:

```bash
# Start daemon explicitly
rocrate-mcp-server --listen /Users/<you>/.aroma/rocrate-mcp-server.sock

# Or start only if needed
rocrate-mcp-server --ensure-daemon /Users/<you>/.aroma/rocrate-mcp-server.sock

# Per-agent proxy client
rocrate-mcp-server --connect /Users/<you>/.aroma/rocrate-mcp-server.sock
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
- `ROCRATE_DATAVERSE_KEEP_UPLOAD_ZIPS` (optional): keep temporary Dataverse upload ZIPs for debugging.

### Profile Resolution
- `AROMA_ROOT_PATH` (optional): base directory for schema index/profile files (default `~/.aroma`).
- `AROMA_METADATA_SCHEMA_INDEX_FILE` (optional): schema index filename or absolute path.
- `ROCRATE_REMOTE_SCHEMA_REGISTRY_DIR` (optional): remote-mode schema registry directory (default `~/.aroma/schema-registry-remote`).
- `AROMA_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE` (optional): remote CEDAR provider config filename or absolute path.
- `AROMA_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE` (optional): keytar service name for provider API keys.
- `ARP_PROD_PREFIX`, `ARP_DEV_PREFIX` (optional): override ARP template URL prefixes.
- `ARP_W3ID_PROD`, `ARP_W3ID_DEV` (optional): override ARP w3id URL prefixes.

### Dashboard
- `ROCRATE_DASHBOARD_ENABLED`: Enable/disable dashboard (default: `true`).
- `ROCRATE_DASHBOARD_HOST`: Dashboard bind address (default: `127.0.0.1`).
- `ROCRATE_DASHBOARD_PORT`: Dashboard port (default: `9393`).
- `ROCRATE_DASHBOARD_AUTH_TOKEN` (optional): Bearer token for dashboard authentication.
- `ROCRATE_DASHBOARD_RETENTION_HOURS`: Data retention period in hours (default: `24`).
- `ROCRATE_DASHBOARD_DETAILED_LOGGING`: Store tool params/results (default: `true`).

### Local File Bridge
- `ROCRATE_LOCAL_FILE_BRIDGE_ENABLED`: enable/disable local file bridge routes (default `true`). `open_aroma_for_local_file` also requires the dashboard HTTP server.
- `ROCRATE_LOCAL_FILE_BRIDGE_ALLOWED_ORIGINS`: comma-separated allowed browser origins for bridge CORS.
- `ROCRATE_LOCAL_FILE_BRIDGE_SESSION_TTL_MINUTES`: bridge registration TTL in minutes.

## MCP client configuration examples

For global npm installs, configure clients to run `rocrate-mcp-server`
directly. If the client does not inherit your shell `PATH`, use the absolute
path returned by `which rocrate-mcp-server`.

For workspace development, replace the command with `node` and put
`/absolute/path/to/rocrate-mcp-server/lib/server.js` as the first argument.

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.rocrate]
command = "rocrate-mcp-server"
args = ["--connect", "/Users/<you>/.aroma/rocrate-mcp-server.sock"]
startup_timeout_sec = 30
env = { ROCRATE_MCP_DEFAULT_MODE = "local" }
```

If you do not run a shared daemon, fallback to direct stdio by removing
`--connect` and socket args.

### Claude Code

Prefer CLI-based setup:

```bash
claude mcp add-json -s user rocrate '{"type":"stdio","command":"rocrate-mcp-server","args":["--connect","/Users/<you>/.aroma/rocrate-mcp-server.sock"],"env":{"ROCRATE_MCP_DEFAULT_MODE":"local"}}'
```

For direct stdio mode, omit the `args` array.

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
      "command": "rocrate-mcp-server",
      "args": ["--connect", "/Users/<you>/.aroma/rocrate-mcp-server.sock"],
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
      "command": "rocrate-mcp-server",
      "args": ["--connect", "/Users/<you>/.aroma/rocrate-mcp-server.sock"],
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
      "command": ["rocrate-mcp-server", "--connect", "/Users/<you>/.aroma/rocrate-mcp-server.sock"],
      "environment": {
        "ROCRATE_MCP_DEFAULT_MODE": "local"
      }
    }
  }
}
```
