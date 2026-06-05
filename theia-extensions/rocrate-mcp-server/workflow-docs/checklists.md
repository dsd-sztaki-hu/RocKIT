# Checklists

## Preflight checklist

1. Confirm target crate path and mode (`local`/`remote`).
2. Load context with `get_rocrate_context`.
3. Identify active profile URLs and allowed properties.
4. Build required vs optional field plan.
5. Confirm any destructive changes with user first.

## Post-write checklist

1. `read_crate` and verify intended changes are present.
2. Ensure all newly added entities have human-friendly `name`.
3. Ensure all newly added entity `@id` values are descriptive and unique.
4. `validate_crate` and capture summary.
5. Call out remaining warnings with recommended fixes.
6. State whether crate is publication-ready (`enforce_required`).
7. If publication-ready and the user asked for Dataverse upload, run `upload_rocrate_to_dataverse(write=true)` using MCP defaults; do not ask for Dataverse URL/API key first.
8. After successful Dataverse upload, show the returned `dataverseUrl` as the dataset link and retain the returned RO-Crate representation for follow-up file links.
9. Give a final summary of data added or updated; use table format when possible.
