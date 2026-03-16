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
7. Give a final summary of data added or updated, use table format when possible.
