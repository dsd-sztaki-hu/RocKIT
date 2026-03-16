# Profile-First Workflow

Always follow this sequence when curating RO-Crate metadata:

0. Use MCP `rocrate` tools for metadata edits and validation. Do not edit JSON directly.
1. Call `get_rocrate_context` before any edit.
2. Read active profile constraints from `profileRules.allowedPropertiesByClass`.
3. If constraints are missing or unclear, call `resolve_profile_schema`.
4. Build a short plan:
   - required fields still missing
   - recommended optional fields
   - fields explicitly disallowed by profile
5. Only after planning, run web `search` if needed for missing values.
6. Only then start metadata writes with `apply_changes` (default persists in local mode).
   - Use `dryRun=true` when you want preview-only execution.
7. Do not use destructive mutations unless user explicitly requested them and approved `confirmDestructive=true`.
8. After writes, call `read_crate` to verify.
9. Call `validate_crate`:
   - iterative edits: `profileRequiredMode=allow_missing`
   - final publication gate: `profileRequiredMode=enforce_required`

Do not skip profile discovery and infer fields from class names.
