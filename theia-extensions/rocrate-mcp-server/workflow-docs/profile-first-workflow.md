# Profile-First Workflow

Always follow this sequence when curating RO-Crate metadata:

0. Use MCP `rocrate` tools for metadata edits and validation. Do not edit JSON directly.
1. Call `get_rocrate_context` before any edit.
2. Identify whether the crate already has active `conformsTo` profile URLs.
3. For RO-Crate metadata authoring, always check and offer schemas/profiles because they guide FAIR metadata creation for both users and agents.
4. If no active profile is present:
   - call `list_metadata_profiles` to show locally available metadata profiles,
   - if useful, call `list_well_known_schemas` to show known remote CEDAR schemas,
   - present every available local profile returned by `list_metadata_profiles` by name, version, and `conformsTo` URL,
   - present any relevant well-known schemas separately by name, version, and derived `conformsTo` URL,
   - do not collapse the list to only the profile you recommend,
   - if one profile seems best, mark it as recommended while still listing the other available profiles,
   - offer a numbered menu in this order: all listed profiles/schemas first, then "provide another schema/profile URL", then "continue without a profile",
   - stop and wait for the user's choice before planning fields, searching the web, or writing metadata,
   - import or attach the selected schema only after the user chooses it,
   - if no profiles/schemas can be listed because of an error, report the error and still offer the user a chance to provide a schema URL.
5. Do not silently continue without a profile after listing available profiles. Continuing without a profile requires the user's explicit choice.
6. Read active profile constraints from `profileRules.allowedPropertiesByClass`.
7. If constraints are missing or unclear, call `resolve_profile_schema`.
8. Build a short plan:
   - required fields still missing
   - recommended optional fields
   - custom fields outside the active profile/schema, if relevant
9. Only after planning, run web `search` if needed for missing values.
10. Only then start metadata writes with `apply_changes` (default persists in local mode).
   - Use `dryRun=true` when you want preview-only execution.
11. Do not use destructive mutations unless user explicitly requested them and approved `confirmDestructive=true`.
12. After writes, call `read_crate` to verify.
13. Call `validate_crate`:
   - iterative edits: `profileRequiredMode=allow_missing`
   - final publication gate: `profileRequiredMode=enforce_required`

Do not skip profile discovery and infer fields from class names.
