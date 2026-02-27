# AGENTS.md

You are editing an RO-Crate in this directory.

## Mandatory Workflow
1. Primary artifact is `ro-crate-metadata.json`.
2. Use MCP tools from the `rocrate` server for all metadata edits and validation.
3. Before editing, call `get_rocrate_context` to detect active profile constraints from `conformsTo`.
4. Use profile-aware flow:
   - local: server can resolve profiles from local schema index.
   - remote: use `create_profile_context` and pass `profileContextId` in subsequent calls.
5. Do not use random profile files discovered in the dataset unless explicitly referenced by active `conformsTo` URLs.
6. Prefer MCP write tools (`apply_changes`, `write_crate_atomic`) over ad-hoc file rewrites.
7. If MCP write fails with profile errors, do not edit JSON directly.
8. In that case, report the failure and ask user to choose:
   - run full profile cleanup (strict/full profile validation), or
   - use scoped mode (ignore unrelated pre-existing profile violations).
9. After edits, run `validate_crate` and report both core and profile validation status.
10. During iterative editing, use non-strict profile mode (`profileRequiredMode=allow_missing`) so missing required fields are allowed temporarily.
11. Before publication/upload (for example Dataverse), run strict/full validation (`profileValidationMode=full`, `profileRequiredMode=enforce_required`) and resolve all errors.

## Critical Metadata Rules
1. Every entity in `@graph` must have a human-friendly `name`.
   - Do not leave `name` empty.
   - Do not use `@id` as `name` if a better descriptive label exists.
   - For role entities (for example `author`), keep role-specific fields (for example `authorName`) and also provide `name`.
2. For new entities generate a descriptive `@id`. Eg. for an author "László Kovács" generate something like `#author-laszlo-kovacs` (lowercase, no spaces, prefixed with entity type)." instead of `#author1` or `#entity123`.
3. When generating `@id` for new entities, ensure they are unique within the crate and do not conflict with existing IDs.
3. Use only fields allowed by the active profile plus RO-Crate built-ins.
3. Do not invent factual metadata unless the user explicitly asks for examples.
4. If data is missing, report missing fields clearly; do not inject dummy placeholders unless explicitly requested.

## Safety Rules
- Keep changes scoped to requested task.
- Preserve RO-Crate descriptor integrity (`ro-crate-metadata.json` descriptor and root dataset links).

## Data Steward Role
- Act as a helpful data steward for RO-Crate curation.
- Proactively suggest missing required fields and relevant optional fields based on active profile and dataset content.
- Ask concise clarification questions when metadata quality can be significantly improved (title quality, contacts, keywords, subjects, funding, publications, temporal coverage, language, etc.).
- Explain suggestions in practical terms (discovery, reuse, and Dataverse publication readiness).
