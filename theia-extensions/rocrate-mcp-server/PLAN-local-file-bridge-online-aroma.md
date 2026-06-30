# Local File Bridge With Live AROMA Sync

## Summary

Add a local-file bridge hosted by the existing RO-Crate MCP dashboard HTTP server, and add an AROMA SPA mode that opens, edits, saves, and live-syncs one locally registered `ro-crate-metadata.json`. Agents call an MCP tool with a local file path, receive an online AROMA URL, open it after user confirmation, and AROMA uses the local bridge to read/write only that registered file. If the file changes locally while AROMA is open, AROMA automatically reloads the latest version.

## Protocol

- Add MCP tool `open_aroma_for_local_file`.
  - Input: `{ path: string, aromaBaseUrl?: string }`.
  - Defaults: `aromaBaseUrl = "https://repo.researchdata.hu/aroma"`.
  - Validates `path` exists and basename is `ro-crate-metadata.json`.
  - Registers the absolute path in an in-memory local-file session store with a random unguessable `id`.
  - Returns:

    ```json
    {
      "aromaUrl": "https://repo.researchdata.hu/aroma?localFile=<encoded-local-file-url>",
      "localFileUrl": "http://127.0.0.1:9393/local-file?id=<id>",
      "eventsUrl": "http://127.0.0.1:9393/local-file/events?id=<id>",
      "path": "/absolute/path/to/ro-crate-metadata.json",
      "expiresAt": "..."
    }
    ```

- Add bridge endpoints:
  - `GET /local-file?id=<id>` reads the registered file.
  - `PUT /local-file?id=<id>` writes the registered file.
  - `GET /local-file/events?id=<id>` opens an SSE stream for file changes.
- Do not expose arbitrary `?path=` access. Endpoints only work for files registered by the MCP tool.
- `GET /local-file` returns content plus an opaque SHA-256 etag.
- `PUT /local-file` requires `Content-Type: application/json` and `If-Match`.
  - Writes atomically on matching etag.
  - Returns `412` on stale etag, `428` when `If-Match` is missing, `404` for unknown/expired id.
- SSE emits:
  - `ready` with current etag.
  - `changed` with `{ id, etag, mtime }` when the local file hash changes.
  - `deleted` if the file disappears.
  - heartbeat comments to keep the connection alive.

## MCP Server Changes

- Implement a `local-file-bridge` module in `rocrate-mcp-server`.
  - Owns session registration, lookup, TTL cleanup, SHA-256 etag generation, JSON read, atomic JSON write, and watcher lifecycle.
  - Supports multiple simultaneous sessions for different RO-Crate files.
  - Uses one watcher per path or reference-counted watchers when multiple sessions point to the same file.
  - Refreshes session TTL on GET, PUT, and SSE activity.
- Extend `DashboardHttpServer` routing with `/local-file` and `/local-file/events`.
  - Include CORS headers for `GET, PUT, OPTIONS`.
  - Include `If-Match` in allowed request headers.
  - Include `Access-Control-Allow-Private-Network: true` on preflight and bridge responses.
  - Return SSE with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and no response buffering.
- Keep bridge on the dashboard HTTP server:
  - default `http://127.0.0.1:9393`.
  - no separate port for v1.
- Add env config:
  - `ROCRATE_LOCAL_FILE_BRIDGE_ENABLED`, default `true`.
  - `ROCRATE_LOCAL_FILE_BRIDGE_SESSION_TTL_MINUTES`, default `480`.
  - `ROCRATE_LOCAL_FILE_BRIDGE_ALLOWED_ORIGINS`, default includes `https://repo.researchdata.hu`.
- No bearer auth for v1. The random session `id` is a capability URL and only grants access to the single registered file.
- Update MCP server instructions and workflow docs.
  - After successful edits and validation, agents must offer to open the crate in online AROMA.
  - If the user agrees, agents call `open_aroma_for_local_file` and open the returned `aromaUrl`.
  - Once AROMA is open, agents should not reopen it after later JSON edits unless the user asks; AROMA auto-refreshes via SSE.

## AROMA SPA Changes

- Add local-file mode activated by:

  ```text
  https://repo.researchdata.hu/aroma?localFile=<encoded-local-file-url>
  ```

- In `App.tsx`, derive `localFileUrl` and `eventsUrl`.
  - `eventsUrl` defaults to `localFileUrl` path plus `/events`, preserving the same `id`.
  - If `localFile` is present, skip Dataverse dataset download and do not require `dataset`.
  - Hide/disable `NoDatasetModal` for local-file mode.
- Add local bridge client helpers, e.g. `src/local-file-bridge.ts`.
  - `loadLocalFile(url)` performs `GET`, returns crate content and etag.
  - `saveLocalFile(url, crate, etag)` performs `PUT` with `If-Match`.
  - `subscribeLocalFileEvents(eventsUrl, handlers)` wraps `EventSource`.
- Local-file startup flow:
  - `GET localFileUrl`.
  - Use returned `content` as `roCrateMetadataJson`.
  - Store returned `etag`.
  - Use bundled `citationProfile` as base profile.
  - Build effective editor profile from crate `conformsTo` values via existing `getMergedProfile`.
  - Select root entity `./`.
- Local-file save flow:
  - Reuse `handleSaveCrate` validation and state update path.
  - In `doSaveCrate`, branch on local-file mode:
    - save to bridge with current `etag`.
    - update stored `etag` from response.
    - set existing `crateSaved`/`saveFailed` UI state.
- Local external-change flow:
  - Open `EventSource(eventsUrl)` after local-file load succeeds.
  - On `changed`, immediately call `GET localFileUrl`.
  - Replace AROMA's crate view with the fetched content, update stored `etag`, recompute merged profile from `conformsTo`, reset history/undo state, clear `crateCanBeSaved`, and show the current file state.
  - This auto-replaces unsaved browser edits by design.
  - On `deleted`, show save/load failure state and switch to read-only until the file reappears or the page is reloaded.
- The crate itself is expected to contain `conformsTo` fields for the profile(s) AROMA should use. No Dataverse dataset PID is required in local-file mode.

## Test Plan

- MCP/dashboard tests:
  - `open_aroma_for_local_file` rejects missing paths and files not named `ro-crate-metadata.json`.
  - tool returns default `https://repo.researchdata.hu/aroma?...`.
  - multiple registered files receive distinct ids and stay isolated.
  - `GET /local-file?id=<id>` returns content and SHA-256 etag.
  - `PUT` with matching `If-Match` writes atomically and returns a new etag.
  - stale `If-Match` returns `412`; missing `If-Match` returns `428`.
  - unknown id returns `404`.
  - SSE endpoint emits `ready`, then emits `changed` after local file modification.
  - preflight includes CORS, `If-Match`, and private-network headers.
- AROMA tests:
  - local-file query mode loads crate from mocked bridge and does not show the no-dataset modal.
  - save calls mocked bridge with `If-Match`.
  - returned etag replaces previous etag after save.
  - mocked SSE `changed` event triggers reload and replaces the visible crate.
  - external reload clears dirty/save-pending state and resets undo/history.
  - profile construction uses bundled citation profile plus crate `conformsTo` merge.
- Workflow tests or assertions:
  - `read_agent_workflow_doc("rocrate_workflow.md")` mentions optional online AROMA review.
  - `checklists.md` tells agents to offer AROMA after validation.
  - MCP server instructions mention `open_aroma_for_local_file` and auto-refresh behavior.
- Verification commands:
  - `./node_modules/.bin/tsc -b theia-extensions/rocrate-mcp-server`
  - `node theia-extensions/rocrate-mcp-server/test/test-dashboard-http.js`
  - in `describo-react`: targeted Jest tests, then `npm run build`.

## Assumptions

- Default online AROMA URL is `https://repo.researchdata.hu/aroma`.
- The bridge is hosted on the existing dashboard HTTP server, default `127.0.0.1:9393`.
- V1 supports multiple simultaneous registered local RO-Crate files in one shared MCP server.
- No explicit auth header/token is required in v1; the opaque session id and single-file allowlist are the protection boundary.
- If the local file changes while AROMA has unsaved edits, AROMA automatically replaces its view with the local file.
- AROMA's local-file mode depends on profiles declared by `conformsTo` in the RO-Crate; no Dataverse dataset PID is required.
