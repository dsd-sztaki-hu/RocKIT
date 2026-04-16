# Safe Mutations

Default behavior is additive.

1. Before changing or deleting existing values, ask for explicit user confirmation.
2. Prefer one scoped `apply_changes` step at a time over giant writes.
3. Keep entity IDs stable unless user asks to refactor them.
4. Never edit `ro-crate-metadata.json` directly; use MCP tools.
5. Destructive `apply_changes` operations are allowed only when explicitly requested by user and must include `confirmDestructive=true`:
   - `removeEntities`
   - `removeHasPart`
   - `updateEntities.unset`
   - `setRootFields.hasPart`
6. `apply_changes` persists by default in local mode. Use `dryRun=true` for preview-only execution.
7. Never change `conformsTo` via `apply_changes`; use `update_profile_conforms_to(write=true)` only when user explicitly asks.
8. Preserve descriptor integrity:
   - `ro-crate-metadata.json` `about` link
   - root dataset identity and core graph consistency
9. In remote mode, remind that writes are not persisted unless client saves returned payload.
