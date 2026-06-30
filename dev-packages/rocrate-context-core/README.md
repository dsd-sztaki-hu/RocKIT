# rocrate-context-core

Shared RO-Crate context and ontology query library for `rockit`.

This package provides runtime-agnostic core logic used by both UI/editor code
and `rocrate-mcp-server`:

- crate `@context` parsing and term resolution
- known RO-Crate context loading (1.1/1.2)
- schema loading from JSON-LD and Turtle
- schema graph traversal (types/properties/range/domain/inheritance)
- distilled catalog and suggestion APIs for agents/editors

## Status

Initial port from NovaCrate core modules is implemented. See:

- `SPEC.md` for architecture and migration plan
- `src/` for current APIs
- `test/` for initial unit/contract-style tests

## Key APIs

Exported from `src/index.ts`:

- `CrateContext`
- `SchemaLoader`
- `SchemaResolver`
- `SchemaGraph`
- `SchemaQueryService`
- `OntologyCatalog`

### Catalog-oriented methods (`OntologyCatalog`)

- `listTypes({ search, offset, limit })`
- `suggestTypes(query, { limit })`
- `getTypeDetails(typeId)`
- `listPropertiesForType(typeId, { includeInherited, search, offset, limit })`
- `suggestProperties(typeIds, query, { limit })`
- `getPropertyDetails(propertyId)`

## Build and test

From monorepo root:

```bash
./node_modules/.bin/tsc -p dev-packages/rocrate-context-core/tsconfig.json
node --test dev-packages/rocrate-context-core/test/*.test.js
```

When workspace lockfile/install is available, package scripts can also be used.

## Attribution and citation

This package ports and adapts context/schema logic from NovaCrate.

Attribution:

- Original implementation source: [NovaCrate](https://github.com/kit-data-manager/NovaCrate)
- Author: Christopher Raquet (Karlsruhe Institute of Technology, KIT)
- ORCID: [https://orcid.org/0009-0003-2196-9187](https://orcid.org/0009-0003-2196-9187)
- Project page: [https://kit-data-manager.github.io/NovaCrate/](https://kit-data-manager.github.io/NovaCrate/)
- Upstream license: Apache-2.0
