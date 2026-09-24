// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: workflow-docs/*.md

export const DEFAULT_WORKFLOW_DOC = 'rocrate_workflow.md'

export const WORKFLOW_DOCS_BUNDLE: Record<string, string> = {
  'rocrate_workflow.md': `# RO-Crate Agent Workflow

You are editing an RO-Crate as a data steward.

## Primary Artifact

- \`ro-crate-metadata.json\`

## Mandatory Startup

Before advising on or editing RO-Crate metadata, read this top-level workflow doc
with \`read_agent_workflow_doc\`. Then read the step-specific workflow doc before
each step.

Use MCP \`rocrate\` tools for metadata edits and validation. Do not edit
\`ro-crate-metadata.json\` directly unless the user explicitly asks for raw JSON
editing and accepts the risk.

If the user starts work in a local directory and \`ro-crate-metadata.json\` is not
present, offer to initialize the directory with \`create_default_rocrate\` before
other metadata work. Explain that it scans the directory, writes
\`ro-crate-metadata.json\`, and bootstraps \`.rockit/ignored.txt\`. Do not overwrite
an existing metadata file unless the user explicitly asks and the tool call uses
\`overwrite=true\`.

## Managed Workflow

Before each step, output a brief summary after reading the referenced workflow
doc.

Example format:

\`\`\`text
STEP 2: Read profile-alignment-rules.md
Summary: Set only allowed properties; required fields first, then optional, then remaining.
Current Dataset missing: author, datasetContact, keyword, publication.
Plan: Fill required, then optional, then other allowed fields.
\`\`\`

| Step | Action | Read This MCP Workflow Doc First | Output Required |
|------|--------|----------------------------------|-----------------|
| 1 | Profile Discovery | \`profile-first-workflow.md\` | Summary of profile-first-workflow.md |
| 2 | Plan Fields | \`profile-alignment-rules.md\` | Summary and explicit field classification plan |
| 3 | Gather Data | \`search-and-evidence.md\` | Summary and what you are searching for |
| 4 | Create Entities | \`entity-quality-and-id-rules.md\` | Summary and entity IDs you are creating |
| 5 | Apply Changes | \`safe-mutations.md\` | Summary and changes you are applying |
| 6 | Verify | \`validation-and-dataverse-gate.md\` | Summary and validation mode |
| 7 | Final Check | \`checklists.md\` | Summary and checklist completion status |

Operational guardrails and metadata-quality rules are defined in the step docs
returned by \`read_agent_workflow_doc\` and must be followed at the relevant step.

## Online AROMA Review

For a direct request to open, view, show, inspect, or launch a local RO-Crate
dataset in AROMA, call \`open_aroma_for_local_file\` with the dataset's
\`ro-crate-metadata.json\` path. If the dataset is the current working directory,
use \`ro-crate-metadata.json\`.

After completing and validating edits to \`ro-crate-metadata.json\`, call
\`open_aroma_for_local_file\` with the local \`ro-crate-metadata.json\` path and
include the returned \`aromaUrl\` in the final response as a plain URL. This lets
the user open the crate in the online AROMA SPA for visual inspection and manual
refinement.

Exception: if this workflow doc includes a "Current Session Context" section
stating that a RO-Crate editor is already open for this session, do not suggest
opening AROMA and do not call \`open_aroma_for_local_file\` unless the user
explicitly asks. Standalone agents outside RocKIT can still open the crate in
AROMA after edits.

When generating the review URL:

1. Call \`open_aroma_for_local_file\` with the local path to \`ro-crate-metadata.json\`.
2. Put the returned \`aromaUrl\` in the final response as a plain URL.
3. Do not automatically open the browser unless the user asks.
4. Do not generate another URL after later metadata edits in the same session
   unless the user asks. The opened AROMA tab listens for local file changes and
   refreshes automatically.

## Human in the Loop

1. Try to solve the user's task in one coherent pass.
2. If you need a decision from the user, provide a short menu they can choose from.
3. For RO-Crate metadata authoring, always check and offer schemas/profiles
   because they guide FAIR metadata creation for both users and agents.
4. If the crate already contains active \`conformsTo\` profile URLs, resolve and
   download those profiles before proceeding with planning or edits. In local
   mode, call a profile-aware MCP tool such as \`get_rocrate_context\` or
   \`validate_crate\` and verify that the active profile URLs are no longer
   unresolved. If resolution fails, report that failure and pause normal
   metadata work until it is addressed.
5. When no active \`conformsTo\` profile exists, offer available local metadata
   profiles first, then browse configured remote CEDAR providers with
   \`list_remote_schema_tree\` and offer unimported leaf templates in a simplified
   folder tree. After the user selects a remote template, import it with
   \`import_well_known_schema\` using \`templateIdOrUrl=<selected templateId>\`,
   then associate the returned \`profile.conformsTo\` with the crate using
   \`update_profile_conforms_to(write=true)\`.
`,
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
7. If publication-ready and the user asked for Dataverse upload, run \`upload_rocrate_to_dataverse(write=true)\` using MCP defaults; do not ask for Dataverse URL/API key first.
8. After successful Dataverse upload, show the returned \`dataverseUrl\` as the dataset link and retain the returned RO-Crate representation for follow-up file links.
9. Give a final summary of data added or updated; use table format when possible.
10. If AROMA is not already open for this session, call \`open_aroma_for_local_file\` with the local \`ro-crate-metadata.json\` path.
11. Include the returned \`aromaUrl\` in the final response as a plain URL so the user can open the crate in online AROMA for visual inspection.
12. Once AROMA is open, assume it will auto-refresh when the local JSON changes; do not generate another URL unless the user asks.
`,
  'entity-quality-and-id-rules.md': `# Entity Quality and ID Rules

These rules are mandatory for RO-Crate metadata quality.

1. Every entity in \`@graph\` must have a human-friendly \`name\`.
2. Do not leave \`name\` empty.
3. Do not use \`@id\` as \`name\` when a clearer human label is available.
   - Avoid ID-derived labels such as \`author-hun-ren-arp-team\` or \`source-service-map\`.
   - Prefer labels such as \`HUN-REN ARP team\` or \`Source: ARP service map\`.
4. For \`File\` entities, use the final filename segment from \`@id\` as \`name\`.
   - Example: \`file://./dir1/img_excel_chart_intro_1.svg\` -> \`img_excel_chart_intro_1.svg\`.
   - Do not invent descriptive file names such as \`Excel chart introduction SVG\`.
5. For role entities (for example \`author\`), keep role-specific fields (for example \`authorName\`) and also provide \`name\`.
6. For new entities, generate descriptive \`@id\` values.
   - Example: \`#author-laszlo-kovacs\`
   - Avoid generic IDs like \`#author1\`, \`#entity123\`, \`#item\`.
7. Ensure every new \`@id\` is unique within the crate and does not collide with existing IDs.
8. Use only profile-allowed fields plus RO-Crate built-ins.
9. Do not invent factual metadata unless user explicitly requests examples.
10. If data is missing, report missing fields clearly; do not inject dummy placeholders unless explicitly requested.
`,
  'profile-alignment-rules.md': `# Profile Alignment Rules

1. Profile conformance is a hard constraint for required fields, value sets, and entity types on profiled \`Dataset\`/\`File\` entities.
2. Prefer properties explicitly allowed by active profile rules for curated metadata.
3. Start setting values for required fields first, then recommended optional fields, then any remaining allowed fields.
4. Custom properties outside the active profile/schema are allowed when they have JSON-LD context mappings.
   - Treat validation messages about custom properties as advisory notes.
   - Do not delete, rename, or migrate custom properties unless the user explicitly asks.
   - If useful, mention an allowed alternative field or profile update, but keep the user's custom metadata intact.
5. Every custom property must be defined by \`@context\`, either through a referenced context URL or an inline mapping.
   - Example: \`@context\`: [\`https://w3id.org/ro/crate/1.1/context\`, { \`directoryLabel\`: \`https://dataverse.org/schema/file/directoryLabel\` }].
   - If the correct IRI is unknown, ask the user for the mapping instead of inventing one or deleting the property.
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
   In local mode this must be treated as a profile-resolution step as well as a context read.
   If the crate already contains \`conformsTo\` URLs, do not proceed until the corresponding
   schemas/profiles have been downloaded into the local profile store or the resolution failure
   has been reported clearly to the user.
2. Identify whether the crate already has active \`conformsTo\` profile URLs.
   If active \`conformsTo\` URLs are present, the user has already selected the
   profile context; work with those profiles instead of offering replacement
   profile choices unless the user asks to change them.
   If \`get_rocrate_context\`, \`validate_crate\`, or another profile-aware MCP call reports
   unresolved profile URLs, stop normal metadata work and resolve/download those profiles first.
3. For RO-Crate metadata authoring, always check and offer schemas/profiles because they guide FAIR metadata creation for both users and agents.
4. If no active profile is present:
   - call \`list_metadata_profiles\` to show locally available metadata profiles,
   - call \`list_remote_schema_tree\` to browse configured remote CEDAR providers
     when local profiles are empty, insufficient, or the user may want a remote
     profile,
   - present every available local profile returned by \`list_metadata_profiles\` by name, version, and \`conformsTo\` URL,
   - present remote CEDAR schemas separately as a simplified folder tree with
     only selectable leaf templates; do not list templates already imported
     locally,
   - do not collapse the list to only the profile you recommend,
   - if one profile seems best, mark it as recommended while still listing the other available profiles,
   - offer a numbered menu in this order: all listed profiles/schemas first, then "provide another schema/profile URL", then "continue without a profile",
   - stop and wait for the user's choice before planning fields, searching the web, or writing metadata,
   - for an already-downloaded local profile, call \`update_profile_conforms_to\`
     with its \`conformsTo\` URL after the user chooses it,
   - for a remote CEDAR leaf template, call \`import_well_known_schema\` with
     \`templateIdOrUrl=<selected templateId>\`, then call
     \`update_profile_conforms_to(write=true)\` with the returned
     \`profile.conformsTo\`,
   - if no profiles/schemas can be listed because of an error, report the error and still offer the user a chance to provide a schema URL.
5. Do not silently continue without a profile after listing available profiles. Continuing without a profile requires the user's explicit choice.
6. Read active profile constraints from \`profileRules.allowedPropertiesByClass\`.
7. If constraints are missing or unclear, call \`resolve_profile_schema\`.
   Do not continue to field planning or metadata edits while active \`conformsTo\` URLs remain unresolved.
8. Build a short plan:
   - required fields still missing
   - recommended optional fields
   - custom fields outside the active profile/schema, if relevant
9. Only after planning, run web \`search\` if needed for missing values.
10. Only then start metadata writes with \`apply_changes\` (default persists in local mode).
   - Use \`dryRun=true\` when you want preview-only execution.
11. Do not use destructive mutations unless user explicitly requested them and approved \`confirmDestructive=true\`.
12. After writes, call \`read_crate\` to verify.
13. Call \`validate_crate\`:
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

Always use the rocrate MCP \`search\` tool when searching the web and the rocrate
MCP \`download_url\` tool when downloading files.

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

## Optional Dataverse upload

Uploading the RO-Crate ZIP to Dataverse is optional.

1. Offer upload at most once after the crate is necessarily filled with data and passes the final publication gate.
2. Do not present upload as required; make clear that the user can stop after validation/export.
3. Assume the rocrate MCP is already configured for the default Dataverse instance via environment variables or other local configuration, including authentication.
4. Do not inspect, verify, print, summarize, or otherwise reveal Dataverse environment variables or API tokens before uploading.
5. If the user directly asks to upload to Dataverse, that is confirmation; do not ask which Dataverse to use.
6. For the default configured instance, call \`upload_rocrate_to_dataverse(write=true)\` immediately after final validation passes.
7. Do not pass \`baseUrl\`, \`apiKey\`, or \`ownerId\` for the default configured instance; let the MCP use its existing configuration and defaults.
8. Do not offer local/custom Dataverse choices before the first upload attempt.
9. If the default upload fails because configuration, authentication, or connectivity is missing or wrong, then ask for the missing Dataverse base URL and/or API token.
10. After a successful upload, read the returned payload from \`upload_rocrate_to_dataverse\`.
11. Report the returned \`dataverseUrl\` to the user as the newly created dataset link.
12. If the returned payload includes \`pendingDataverseCrate\`, Dataverse has produced an updated RO-Crate with assigned dataset/file IDs and the MCP has saved it as a pending version.
13. Ask the user whether they want to replace the local \`ro-crate-metadata.json\` with this Dataverse-updated version for future edit/sync workflows.
14. In terminal chat, if the user agrees, call \`adopt_pending_dataverse_rocrate(pendingId=<pendingDataverseCrate.id>, write=true)\`. In native AROMA chat, the UI may show this confirmation popup and apply the pending version itself.
15. If the user asks for uploaded file links, derive them from returned \`fileLinks\` when present.
16. If the user asks to upload to another Dataverse installation, ask for:
   - the Dataverse base URL
   - the Dataverse API token
17. Never reveal API tokens or other secrets unless the user explicitly asks to display them.
`
}
