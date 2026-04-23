# RO-Crate Context Shared Library Specification

## Goal
Create a shared TypeScript library that ports NovaCrate crate-context and schema
resolution functionality into `aroma-2` so it can be consumed by:

- Aroma browser/editor code.
- `rocrate-mcp-server` (Node runtime).

The implementation should reuse NovaCrate code paths as much as possible,
modifying only what is required to make the code runtime-agnostic and package-
scoped.

## Scope

### In scope
- Parse and normalize crate `@context` (string/object/array forms).
- Resolve terms and reverse-resolve IRIs.
- Track crate specification (RO-Crate 1.1/1.2) with known context fallback.
- Load schema documents from URL or local assets.
- Support both JSON-LD and Turtle schema sources.
- Build a unified internal schema graph.
- Query class/property relationships:
  - classes
  - properties for class
  - range/domain
  - subclass/subproperty traversal
- Provide distilled catalog + suggestion APIs for agent/editor workflows:
  - list types
  - suggest types by text query
  - get type details
  - list properties for type
  - suggest properties by text query + type context
  - get property details
- Prefix-based schema autoload rules (`matchesUrls`).
- Deterministic caching and schema source metadata.

### Out of scope
- UI components and stores (Zustand/React).
- MCP tool UX policy and prompting behavior.
- Profile (`conformsTo`) validation logic already in MCP; integration only.

## Why this is needed
Reading only `@context` URLs is insufficient for semantic validation and editor
assistance. `@context` maps terms to IRIs, but class hierarchy, domain/range,
and related constraints come from schema/ontology documents (JSON-LD/TTL).

NovaCrate already implements this split with:

- Context mapping (`CrateContext`).
- Schema registry and loading (`schema-resolver`).
- Schema graph queries (`schema-worker`).

This library ports that core behavior into shared, non-UI modules.

## Source of truth for port
Primary upstream files to port (minimal modifications):

- `lib/crate-context.ts`
- `lib/schema-worker/SchemaResolver.ts`
- `lib/schema-worker/SchemaGraph.ts`
- `lib/schema-worker/SchemaNode.ts`
- `lib/schema-worker/types.ts`
- `lib/schema-worker/helpers.ts` (split into query modules)
- `lib/schema-worker/assets/context-1.1.json`
- `lib/schema-worker/assets/context-1.2.json`

Secondary references:

- `lib/state/schema-resolver.ts` (registry model, defaults)
- `public/schema/*.jsonld` (optional bundled offline schemas)

## Proposed package layout
`dev-packages/rocrate-context-core/`

- `src/context/`
  - `crate-context.ts`
  - `known-contexts.ts`
  - `types.ts`
- `src/registry/`
  - `schema-registry.ts`
  - `defaults.ts`
  - `types.ts`
- `src/loader/`
  - `schema-loader.ts`
  - `jsonld-loader.ts`
  - `ttl-loader.ts`
  - `content-type.ts`
  - `cache.ts`
  - `types.ts`
- `src/graph/`
  - `schema-node.ts`
  - `schema-graph.ts`
  - `queries.ts`
- `src/runtime/`
  - `fetch-adapter.ts`
  - `asset-adapter.ts`
  - `node-fs-cache.ts`
  - `browser-cache.ts`
- `src/index.ts`
- `assets/`
  - `context-1.1.json`
  - `context-1.2.json`
  - optional curated schemas

## Runtime design

### Shared core
Core modules must not depend on React, Zustand, WebWorker, or Theia APIs.
Everything uses explicit interfaces.

### Adapters
- Browser adapter:
  - `fetch`
  - in-memory/indexed cache
  - static bundled assets
- Node adapter:
  - `fetch`/HTTP client
  - filesystem cache
  - local file path assets

This allows identical behavior in editor and MCP with environment-specific I/O.

## Data model contracts

### Context model
- Effective context map: `Record<string, string>`.
- Custom pairs map (inline additions).
- Known context(s) used and fallback status.

### Schema registry entry
- `id`
- `displayName`
- `matchesUrls: string[]`
- `schemaUrl`
- `activeOnSpec: RO_CRATE_VERSION[]`
- optional source mode (`remote` | `local`)

### Graph node model
Unified model independent of input format:
- `@id`
- `@type` (array-normalized internally)
- optional comment/label/definition
- parent class/property refs
- domain refs
- range refs
- raw source metadata

## Parsing and normalization rules

### JSON-LD
- Parse and validate expected top-level shape (`@context`, `@graph`).
- Keep graph entries with identifiable type/class/property semantics.

### Turtle
- Parse TTL to JSON-LD graph.
- Normalize to same internal shape used for JSON-LD.
- Preserve NovaCrate compatibility rewrite logic where required (minimal change).

### Content type handling
- Prefer explicit content type.
- Allow robust fallback for `text/plain` when content is valid JSON-LD.
- Surface parse errors with source URL and parser stage.

## Behavior parity target with NovaCrate
The library must preserve NovaCrate behavior for:

- context resolution/reverse mapping
- known RO-Crate context handling
- prefix-based autoload
- class/property query semantics
- deduped parallel schema fetches

Any intentional differences must be documented in `CHANGELOG_PORTING.md`.

## Integration points

### Aroma editor
- replace direct NovaCrate-specific context/worker logic with library API
- keep UI components unchanged where possible (adapter layer only)

### MCP server
- use same library for context-term validation and schema-aware checks
- avoid duplicate JSON-LD/TTL parser logic in server code
- expose catalog/suggestion functionality via MCP tools backed by the shared lib
  (no ontology dumping into prompts)

## Porting plan (minimal-change strategy)

### Phase 0: Package skeleton
1. Create new workspace package with TypeScript build and test setup.
2. Add strict linting and `exports` map.

### Phase 1: Direct port of core classes
1. Copy `CrateContext` and known contexts with minimal path changes.
2. Copy `SchemaNode`, `SchemaGraph`, `SchemaResolver`.
3. Replace NovaCrate UI/store dependencies with interfaces.
4. Keep existing method signatures where feasible.

### Phase 2: Decouple worker helpers
1. Port `helpers.ts` into pure query APIs.
2. Remove worker wrapper assumptions.
3. Expose both high-level query facade and lower-level graph API.

### Phase 2.5: Catalog and suggestion API
1. Add distilled catalog API module to shared lib (types/properties/details).
2. Add lexical + structural suggestion ranking on top of shared graph queries.
3. Ensure pagination and bounded result sizes for agent-safe outputs.

### Phase 3: Registry extraction
1. Port schema registry type/defaults from NovaCrate store.
2. Move persistence concerns out of core package.
3. Provide pure in-memory registry; host app persists if needed.

### Phase 4: Runtime adapters
1. Introduce fetch and asset provider interfaces.
2. Implement browser and Node adapters.
3. Ensure Node can load local assets and cache on disk.

### Phase 5: Integration in aroma-2
1. Add editor-side adapter usage first.
2. Keep behavior parity with current flow.
3. Move MCP validation/context checks to library APIs incrementally.
4. Expose shared catalog/suggestion APIs in MCP as thin wrappers.

### Phase 6: Deprecate duplicate logic
1. Remove legacy duplicated context/schema code after parity verification.
2. Keep compatibility shims for one release cycle.

## Testing strategy

## Current upstream test status
NovaCrate appears to have end-to-end/integration tests, but no dedicated unit
suite for `CrateContext`, `SchemaResolver`, `SchemaGraph`, and `SchemaNode`.

### Required tests for this package

#### Unit tests
- `CrateContext`
  - parse all valid `@context` shapes
  - resolve/reverse behavior
  - known-context fallback behavior
- `SchemaLoader`
  - JSON-LD success/failure cases
  - TTL success/failure cases
  - content-type fallback logic
  - deduped concurrent fetch behavior
- `SchemaGraph`
  - class hierarchy traversal
  - property inheritance
  - domain/range lookup
  - subClass/subProperty traversal

#### Contract tests
- Given a fixture crate + schema set, assert same results as NovaCrate for:
  - `getAllClasses`
  - `getPossibleEntityProperties`
  - `getPropertyRange`

#### Integration tests
- Browser adapter fixture (mock fetch).
- Node adapter fixture (local files + remote mock).
- MCP-side smoke tests using library context validation.

### Fixtures to include
- small JSON-LD schema fixture
- small TTL schema fixture
- mixed `@context` fixture (known URL + inline terms)
- malformed context/schema fixtures for negative tests

## Risks and mitigations

### Risk: Runtime drift between browser and MCP
Mitigation: adapter interfaces + shared contract tests run in both envs.

### Risk: External schema instability
Mitigation: optional curated local snapshots + pinning + cache metadata.

### Risk: Behavior regression from NovaCrate
Mitigation: parity tests against selected NovaCrate fixtures.

## Deliverables
1. New workspace package `rocrate-context-core` with build/test pipeline.
2. Ported core context/schema graph code.
3. JSON-LD + TTL support in shared loader.
4. Adapter layer for browser and Node.
5. Test suite (unit + contract + integration).
6. Migration notes for editor and MCP integration.

## Acceptance criteria
- Library can parse crate context and resolve terms identically in browser/Node.
- Library can load both JSON-LD and TTL schemas and build usable graph.
- Query APIs return deterministic results for provided fixtures.
- MCP and editor can both consume the same package without duplicated logic.
- All new tests pass in CI.
