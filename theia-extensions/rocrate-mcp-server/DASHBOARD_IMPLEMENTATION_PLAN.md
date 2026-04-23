# RO-Crate MCP Dashboard Implementation Plan

## Goal
Build a local web dashboard for the RO-Crate MCP server to inspect sessions, tool calls, errors, and dependency usage (including Tavily local usage accounting), with safe defaults and minimal impact on MCP stdio behavior.

## Scope and Success Criteria
- Dashboard is optional and disabled by default.
- Dashboard runs on localhost by default and is read-only.
- Server records session and tool-call telemetry with bounded memory usage.
- Dashboard exposes JSON APIs and a minimal local web UI.
- Tavily/dependency usage is visible from local measured counters even without external usage APIs.
- Implementation runs on Node now and remains Bun-compatible for later runtime switch with minimal or no code changes.

## Runtime Compatibility Requirement (Node now, Bun later)
- Prefer standards-based Node APIs available in Bun (`fetch`, `Request`/`Response`, `URL`, `AbortController`, `node:http`, `node:fs`, `node:path`).
- Avoid Node-only behavior that is often problematic in Bun (runtime-specific stream internals, undocumented process hacks, native addons).
- Keep HTTP/dashboard layer dependency-light and framework-agnostic.
- Isolate runtime-sensitive code behind small adapters if needed.
- Add a compatibility check task in CI matrix later (`node` + `bun`) once Bun execution is enabled in this repo.

## Configuration Defaults
- `ROCRATE_DASHBOARD_ENABLED=false`
- `ROCRATE_DASHBOARD_HOST=127.0.0.1`
- `ROCRATE_DASHBOARD_PORT=9393`
- `ROCRATE_DASHBOARD_AUTH_TOKEN` optional
- `ROCRATE_DASHBOARD_RETENTION_HOURS` bounded retention window

## Data Model (Telemetry Schema)
Define these entities first and keep them stable before endpoint/UI implementation:

- `Session`
  - `id`, `startedAt`, `lastActivityAt`, `transportMode`, `requestCount`, `errorCount`, `active`
- `ToolCall`
  - `id`, `sessionId`, `toolName`, `startedAt`, `finishedAt`, `durationMs`, `status`, `errorCode`, `errorMessageShort`, `argsSizeBytes`
- `ErrorEvent`
  - `id`, `sessionId`, `toolName?`, `timestamp`, `errorCode`, `messageShort`
- `DependencyUsage`
  - `dependency` (for example `tavily`), `callCount`, `successCount`, `failureCount`, `avgLatencyMs`, `lastCallAt`
- `AggregateWindow`
  - `windowStart`, `windowEnd`, `totalCalls`, `failedCalls`, `activeSessions`, `p50Ms`, `p95Ms`

## Guardrails
- Cap max retained sessions/events/errors in memory.
- Cap recorded argument payload size to byte length only (no raw sensitive payload storage).
- Cap error message length in telemetry.
- Use rolling retention purge on insert and periodic sweep.

## File-Level Implementation Checklist

### 1) Telemetry Core
- [ ] Add telemetry types in `src/dashboard/types.ts`.
- [ ] Add in-memory collector in `src/dashboard/collector.ts`.
- [ ] Add aggregation helpers (percentiles, fail %, active sessions) in `src/dashboard/aggregates.ts`.
- [ ] Add sanitization/redaction helpers in `src/dashboard/sanitize.ts`.

### 2) Server Instrumentation
- [ ] Add request/session lifecycle instrumentation in `src/server.ts` around `handleRequest`.
- [ ] Add tool lifecycle instrumentation in `src/server.ts` around `handleToolCall`.
- [ ] Record duration, status, error details, and argument-size metadata.
- [ ] Add Tavily/dependency usage accounting in the `search` tool path.
- [ ] Add profile-context cache stats near `profileContextStore` operations.

### 3) Dashboard HTTP API
- [ ] Add dashboard HTTP server module in `src/dashboard/http-server.ts`.
- [ ] Implement `GET /health`.
- [ ] Implement `GET /metrics/summary`.
- [ ] Implement `GET /metrics/tools`.
- [ ] Implement `GET /sessions`.
- [ ] Implement `GET /sessions/:id`.
- [ ] Implement `GET /errors/recent`.
- [ ] Implement `GET /dependencies`.
- [ ] Add optional `GET /events` SSE endpoint for live updates.
- [ ] Enforce localhost bind and optional bearer token auth.

### 4) Dashboard Frontend
- [ ] Add static page `src/dashboard/static/index.html`.
- [ ] Add styles `src/dashboard/static/dashboard.css`.
- [ ] Add client script `src/dashboard/static/dashboard.js`.
- [ ] Render overview cards: total calls, error rate, active sessions, p95 latency.
- [ ] Render tools table: calls, fail %, avg/p95, last error.
- [ ] Render session explorer and recent errors panel.
- [ ] Add auto-refresh and time-range filter (`15m`, `1h`, `24h`).

### 5) Startup and Runtime Safety
- [ ] Wire dashboard startup from `startServer()` in `src/server.ts`.
- [ ] Ensure dashboard startup failure does not crash MCP stdio server.
- [ ] Add graceful shutdown for dashboard HTTP resources.

### 6) Tests
- [ ] Add collector tests in `test/test-dashboard-collector.js`.
- [ ] Add HTTP endpoint tests in `test/test-dashboard-http.js`.
- [ ] Extend MCP integration tests in `test/test-mcp-server.js` for telemetry assertions.
- [ ] Update package test script in `package.json` to include dashboard tests.
- [ ] Add runtime-compatibility smoke test plan for Bun (enable in CI when Bun is introduced).

### 7) Documentation
- [ ] Document env vars, endpoints, auth, retention, and redaction in `README.md`.
- [ ] Add quickstart section for enabling dashboard locally.
- [ ] Add troubleshooting section (port conflict, token mismatch, empty telemetry).

## Phased Rollout

### Phase 1 (MVP)
- In-memory telemetry collector.
- Instrument tool calls.
- `GET /metrics/summary`, `GET /metrics/tools`.
- Simple local dashboard page.

### Phase 2
- Session and error drill-down endpoints/UI.
- Retention tuning and stronger guardrails.
- Optional SSE live updates.

### Phase 3
- Optional persistence for restart-safe history.
- Optional external usage provider interface.
- Auth hardening and operational polish.

## Open Questions
- Should retention be count-based only, or count + time window?
- Should dashboard auth token be mandatory when non-localhost bind is used?
- Do we want persisted metrics in Phase 1 or strictly in-memory MVP?
- When to introduce Bun in CI (phase and branch policy)?
