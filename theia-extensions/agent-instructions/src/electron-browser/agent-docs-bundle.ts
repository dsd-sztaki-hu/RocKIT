// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: agent-docs/*.md

export const AGENT_DOCS_DIR = '.aroma'

export const AGENT_DOCS_BUNDLE: Record<string, string> = {
  'checklists.md': `# Checklists

## Preflight checklist

1. Confirm target crate path and mode (\`local\`/\`remote\`).
2. Load context with \`get_rocrate_context\`.
3. Identify active profile URLs and allowed properties.
4. Build required vs optional field plan.
5. Confirm any destructive changes with user first.

## Post-write checklist

1. \`read_crate\` and verify intended changes are present.
2. Ensure all newly added entities have human-friendly \`name\`.
3. Ensure all newly added entity \`@id\` values are descriptive and unique.
4. \`validate_crate\` and capture summary.
5. Call out remaining warnings with recommended fixes.
6. State whether crate is publication-ready (\`enforce_required\`).
7. Give a final summary of data added or updated, use table format when possible.
`,
  'entity-quality-and-id-rules.md': `# Entity Quality and ID Rules

These rules are mandatory for RO-Crate metadata quality.

1. Every entity in \`@graph\` must have a human-friendly \`name\`.
2. Do not leave \`name\` empty.
3. Do not use \`@id\` as \`name\` when a clearer human label is available.
4. For role entities (for example \`author\`), keep role-specific fields (for example \`authorName\`) and also provide \`name\`.
5. For new entities, generate descriptive \`@id\` values.
   - Example: \`#author-laszlo-kovacs\`
   - Avoid generic IDs like \`#author1\`, \`#entity123\`, \`#item\`.
6. Ensure every new \`@id\` is unique within the crate and does not collide with existing IDs.
7. Use only profile-allowed fields plus RO-Crate built-ins.
8. Do not invent factual metadata unless user explicitly requests examples.
9. If data is missing, report missing fields clearly; do not inject dummy placeholders unless explicitly requested.
`,
  'profile-alignment-rules.md': `# Profile Alignment Rules

1. Profile conformance is a hard constraint for profiled \`Dataset\`/\`File\` entities.
2. Set only properties explicitly allowed by active profile rules.
3. Start setting values for required fields first, then recommended optional fields, then any remaining allowed fields.
4. If a requested property is disallowed:
   - explain the constraint,
   - propose an allowed alternative field/entity,
   - or propose profile update via \`update_profile_conforms_to\`.
5. Never force disallowed fields via custom \`@context\` mappings.
6. Use profile value-set hints from validation output when present.
7. Keep \`conformsTo\` changes separate:
   - use \`update_profile_conforms_to(write=true)\`,
   - then \`read_crate\`,
   - then continue edits.
`,
  'profile-first-workflow.md': `# Profile-First Workflow

Always follow this sequence when curating RO-Crate metadata:

0. Use MCP \`rocrate\` tools for metadata edits and validation. Do not edit JSON directly.
1. Call \`get_rocrate_context\` before any edit.
2. Read active profile constraints from \`profileRules.allowedPropertiesByClass\`.
3. If constraints are missing or unclear, call \`resolve_profile_schema\`.
4. Build a short plan:
   - required fields still missing
   - recommended optional fields
   - fields explicitly disallowed by profile
5. Only after planning, run web \`search\` if needed for missing values.
6. Only then start metadata writes with \`apply_changes\` (default persists in local mode).
   - Use \`dryRun=true\` when you want preview-only execution.
7. Do not use destructive mutations unless user explicitly requested them and approved \`confirmDestructive=true\`.
8. After writes, call \`read_crate\` to verify.
9. Call \`validate_crate\`:
   - iterative edits: \`profileRequiredMode=allow_missing\`
   - final publication gate: \`profileRequiredMode=enforce_required\`

Do not skip profile discovery and infer fields from class names.
`,
  'safe-mutations.md': `# Safe Mutations

Default behavior is additive.

1. Before changing or deleting existing values, ask for explicit user confirmation.
2. Prefer one scoped \`apply_changes\` step at a time over giant writes.
3. Keep entity IDs stable unless user asks to refactor them.
4. Never edit \`ro-crate-metadata.json\` directly; use MCP tools.
5. Destructive \`apply_changes\` operations are allowed only when explicitly requested by user and must include \`confirmDestructive=true\`:
   - \`removeEntities\`
   - \`removeHasPart\`
   - \`updateEntities.unset\`
   - \`setRootFields.hasPart\`
6. \`apply_changes\` persists by default in local mode. Use \`dryRun=true\` for preview-only execution.
7. Never change \`conformsTo\` via \`apply_changes\`; use \`update_profile_conforms_to(write=true)\` only when user explicitly asks.
8. Preserve descriptor integrity:
   - \`ro-crate-metadata.json\` \`about\` link
   - root dataset identity and core graph consistency
9. In remote mode, remind that writes are not persisted unless client saves returned payload.
`,
  'search-and-evidence.md': `# Search and Evidence

Always use the rocrate MCP \`search\` tool when searching the web and the rocrate MCP  \`download_url\` tool when downloading files.

Use \`search\` only when metadata values are unknown and cannot be derived locally.

Rules:

1. Search after profile planning, not before.
2. Prefer primary sources (official institution pages, canonical docs, standards).
3. Record provenance while drafting values (URL + date checked).
4. Avoid unverifiable claims; if uncertain, surface it as a question.
5. Do not pad metadata with speculative content.
6. Keep extracted facts mapped to profile-allowed fields only.
`,
  'validation-and-dataverse-gate.md': `# Validation and Dataverse Gate

Run validation after every meaningful edit set.

1. During iterative editing:
   - \`validate_crate(profileRequiredMode=allow_missing)\`
2. Before publication or Dataverse upload:
   - \`validate_crate(profileRequiredMode=enforce_required)\`
3. After writes, always run \`read_crate\` to verify intended changes are present.
4. Report both:
   - core RO-Crate validation status
   - profile validation status
5. Resolve all errors before declaring the crate publication-ready.
6. Warnings are allowed temporarily, but enumerate them and propose fixes.
`
}
