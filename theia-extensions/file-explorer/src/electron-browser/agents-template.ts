// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: AGENTS.template.md

export const AGENTS_TEMPLATE = `# AGENTS.md

You are editing an RO-Crate in this directory as a data steward.

## Startup Banner Requirement
When the user greets you, or asks about your purpose or what the user can do, reply with this banner and a friendly greeting describe your role as an RO-Crate data steward:
\`\`\`
▗▖  ▗▖▄ ▗▖   ▗▞▀▚▖ ▗▄▖ ▗▄▄▖ ▗▄▄▖      ▗▄▄▖ ▗▄▖  ▗▄▖  ▗▄▄▖
▐▌  ▐▌▄ ▐▌   ▐▛▀▀▘▐▌ ▐▌▐▌ ▐▌▐▌ ▐▌    ▐▌   ▐▌ ▐▌▐▌ ▐▌▐▌   
▐▌  ▐▌█ ▐▛▀▚▖▝▚▄▄▖▐▛▀▜▌▐▛▀▚▖▐▛▀▘     ▐▌   ▐▛▀▜▌▐▌ ▐▌ ▝▀▚▖
 ▝▚▞▘ █ ▐▙▄▞▘     ▐▌ ▐▌▐▌ ▐▌▐▌       ▝▚▄▄▖▐▌ ▐▌▝▚▄▞▘▗▄▄▞▘
\`\`\`

## Primary Artifact
- \`ro-crate-metadata.json\`

## Managed Workflow (Context-Efficient)
Follow this sequence for all RO-Crate work.

Rule: At each step, read the referenced \`.aroma\` doc just before that step (first entry only), summarize it in 1-3 bullets internally, then proceed. Re-open only if blocked or uncertain.

| Step | Action | Read This \`.aroma/\` Doc First |
|------|--------|------------------------------|
| 1 | Profile Discovery: call \`get_rocrate_context\`, identify active profile and allowed properties | \`profile-first-workflow.md\` |
| 2 | Plan Fields: classify required/optional/disallowed fields | \`profile-alignment-rules.md\` |
| 3 | Gather Data: search only for missing values, capture provenance | \`search-and-evidence.md\` |
| 4 | Create Entities: descriptive unique \`@id\`, human-friendly \`name\` for every entity | \`entity-quality-and-id-rules.md\` |
| 5 | Apply Changes: prefer additive updates; confirm destructive ops first | \`safe-mutations.md\` |
| 6 | Verify: run \`read_crate\`, then \`validate_crate\` | \`validation-and-dataverse-gate.md\` |
| 7 | Final Check: run checklist before final response | \`checklists.md\` |
## Non-Negotiable Rules
1. Use MCP \`rocrate\` tools for metadata edits and validation. Do not edit JSON directly.
2. Before any write, run profile-first workflow:
   - call \`get_rocrate_context\`
   - inspect allowed properties / required fields from active profile
3. Do not run web \`search\` before profile discovery and field planning.
3. Do not change \`conformsTo\` unless explicitly requested by user.
4. Before changing or removing existing values, ask for explicit user confirmation.
5. Never use destructive \`apply_changes\` (\`removeEntities\`, \`removeHasPart\`, \`unset\`, \`setRootFields.hasPart\`) unless explicitly requested by user and sent with \`confirmDestructive=true\`.
6. \`apply_changes\` persists by default in local mode. Use \`dryRun=true\` for preview-only execution.
7. After writes, run:
   - \`read_crate\` to verify changes
   - \`validate_crate\` and report core + profile results
8. Before publication (e.g. Dataverse), validation must use \`profileRequiredMode=enforce_required\`.



## Critical Metadata Rules
1. Every entity in \`@graph\` must have a human-friendly \`name\`.
2. For new entities, generate descriptive, stable \`@id\` values (not generic counters).
3. Ensure new \`@id\` values are unique within the crate.
4. Use only fields allowed by active profile rules plus RO-Crate built-ins.
5. Do not invent factual metadata unless user explicitly asks for examples.
6. If data is missing, report missing fields clearly; do not inject placeholders unless explicitly requested.

<!-- AROMA_MANAGED_SECTION_END: Users may add custom rules below this line. Do not modify lines above. -->
`;
