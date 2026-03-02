# rocrate-mcp-server

MCP server for RO-Crate editing, validation, and profile-aware constraints.

## Transport vs mode

- Transport: **stdio MCP server** (JSON-RPC over `Content-Length` framing).
- Compatibility: also accepts newline-delimited JSON-RPC (JSONL fallback).
- Access mode (`mode` tool arg): **`local`** or **`remote`**.

Important: `remote` is an RO-Crate data-access mode, **not** HTTP/SSE transport.

## Tools

- `search`: Tavily-backed web search (`TAVILY_API_KEY`, optional per-call `apiKey` fallback).
- `download_url`: download and extract text/raw HTML from one URL.
- `upload_rocrate_to_dataverse`: Dataverse upload (`write: true` required):
  - create (no `pid`): ZIP upload (`ro-crate-metadata.json` + referenced files), local mode only.
  - update (with `pid`): JSON metadata POST to update existing dataset.
- `download_rocrate_from_dataverse`: download crate JSON by PID from Dataverse ARP API.
- `read_crate`: read crate (`local` from disk or `remote` from provided `crate` payload).
- `compute_delta`: compute additive file/dataset delta against crate.
- `apply_changes`: apply compact changeset; requires `write: true`.
  - `updateEntities` supports `merge` (set fields) and `unset` (remove fields).
  - `contextMode` controls auto-`@context` handling:
    - `strict`: no automatic context edits.
    - `auto_add`: add missing profile-derived term mappings only.
    - `auto_reconcile`: add missing mappings and reconcile conflicting existing mappings.
  - Default `contextMode` is `auto_reconcile`.
  - `conformsTo` edits are prohibited in `apply_changes`.
- `update_profile_conforms_to`: update `conformsTo` profile URLs on one Dataset/File entity using `add`/`remove`/`set`; requires `write: true`.
- `validate_crate`: RO-Crate + profile-aware validation.
- `write_crate_atomic`: atomic write in local mode.
- `get_rocrate_context`: summary context including profile resolution hints.
- `suggest_context_terms`: suggest `mergeContext` mappings for used-but-undeclared terms.
- `resolve_profile_schema`: resolve one profile URL via schema index/profile inputs.
- `prepare_remote_profile_payload`: build `schemaIndex` + `profileContents` payload for remote calls.
- `create_profile_context`: cache profile payload server-side; returns `profileContextId`.
- `get_profile_context_info`: inspect cached profile context metadata.
- `delete_profile_context`: delete cached profile context.

## Local vs remote access mode

- `mode: "local"` (default): server reads/writes `ro-crate-metadata.json` on its filesystem.
- `mode: "remote"`: caller passes full crate JSON; no local file access required.

Notes:

- `apply_changes` requires `write: true` in both modes.
- Profile enforcement is entity-local for `Dataset`/`File` entities:
  - If entity has profile `conformsTo` URL(s), only profile-allowed types and
    properties are accepted.
  - If entity has no profile `conformsTo`, any property declared in effective
    `@context` is allowed.
- `apply_changes` always blocks direct `conformsTo` edits on `Dataset`/`File`
  entities. Use `update_profile_conforms_to` instead.
- `update_profile_conforms_to` requires `write: true` in both modes.
- `apply_changes(write=true)` and `write_crate_atomic` only persist in local mode.
- In remote mode, write requests return updated crate payload and do not persist files.
- `compute_delta` in remote mode requires `workspaceEntries` (relative path list, folders ending with `/`).
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

## Environment variables

- `TAVILY_API_KEY`: Tavily key for `search`.
- `TAVILY_API_URL` (optional): Tavily endpoint override.
- `DATAVERSE_BASE_URL` (optional): Dataverse/ARP base URL for upload/download tools (default `http://localhost:8080`).
- `DATAVERSE_OWNER_ID` (optional): owner ID for new uploads (default `root`).
- `DATAVERSE_API_KEY` (optional): API key used as `X-Dataverse-key` header.
- `AROMA_ROOT_PATH` (optional): base directory for schema index/profile files (default `~/.aroma`).
- `AROMA_METADATA_SCHEMA_INDEX_FILE` (optional): schema index filename or absolute path.
- `ROCRATE_MCP_DEFAULT_MODE` (optional): default mode if tool arg omitted (`local` or `remote`).

## MCP client configuration examples

Use absolute paths for both `command` and `args`.

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.rocrate]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/rocrate-mcp-server/lib/server.js"]
startup_timeout_sec = 30
env = { ROCRATE_MCP_DEFAULT_MODE = "local" }
```

### Claude Code

Prefer CLI-based setup:

```bash
claude mcp add-json -s user rocrate '{"type":"stdio","command":"/absolute/path/to/node","args":["/absolute/path/to/rocrate-mcp-server/lib/server.js"],"env":{"ROCRATE_MCP_DEFAULT_MODE":"local"}}'
```

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
      "args": ["/absolute/path/to/rocrate-mcp-server/lib/server.js"],
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
      "args": ["/absolute/path/to/rocrate-mcp-server/lib/server.js"],
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
      "command": ["/absolute/path/to/node", "/absolute/path/to/rocrate-mcp-server/lib/server.js"],
      "environment": {
        "ROCRATE_MCP_DEFAULT_MODE": "local"
      }
    }
  }
}
```
