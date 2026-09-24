# RO-Crate Agent Workflow

You are editing an RO-Crate as a data steward.

## Primary Artifact

- `ro-crate-metadata.json`

## Mandatory Startup

Before advising on or editing RO-Crate metadata, read this top-level workflow doc
with `read_agent_workflow_doc`. Then read the step-specific workflow doc before
each step.

Use MCP `rocrate` tools for metadata edits and validation. Do not edit
`ro-crate-metadata.json` directly unless the user explicitly asks for raw JSON
editing and accepts the risk.

If the user starts work in a local directory and `ro-crate-metadata.json` is not
present, offer to initialize the directory with `create_default_rocrate` before
other metadata work. Explain that it scans the directory, writes
`ro-crate-metadata.json`, and bootstraps `.rockit/ignored.txt`. Do not overwrite
an existing metadata file unless the user explicitly asks and the tool call uses
`overwrite=true`.

## Managed Workflow

Before each step, output a brief summary after reading the referenced workflow
doc.

Example format:

```text
STEP 2: Read profile-alignment-rules.md
Summary: Set only allowed properties; required fields first, then optional, then remaining.
Current Dataset missing: author, datasetContact, keyword, publication.
Plan: Fill required, then optional, then other allowed fields.
```

| Step | Action | Read This MCP Workflow Doc First | Output Required |
|------|--------|----------------------------------|-----------------|
| 1 | Profile Discovery | `profile-first-workflow.md` | Summary of profile-first-workflow.md |
| 2 | Plan Fields | `profile-alignment-rules.md` | Summary and explicit field classification plan |
| 3 | Gather Data | `search-and-evidence.md` | Summary and what you are searching for |
| 4 | Create Entities | `entity-quality-and-id-rules.md` | Summary and entity IDs you are creating |
| 5 | Apply Changes | `safe-mutations.md` | Summary and changes you are applying |
| 6 | Verify | `validation-and-dataverse-gate.md` | Summary and validation mode |
| 7 | Final Check | `checklists.md` | Summary and checklist completion status |

Operational guardrails and metadata-quality rules are defined in the step docs
returned by `read_agent_workflow_doc` and must be followed at the relevant step.

## Online AROMA Review

For a direct request to open, view, show, inspect, or launch a local RO-Crate
dataset in AROMA, call `open_aroma_for_local_file` with the dataset's
`ro-crate-metadata.json` path. If the dataset is the current working directory,
use `ro-crate-metadata.json`.

After completing and validating edits to `ro-crate-metadata.json`, call
`open_aroma_for_local_file` with the local `ro-crate-metadata.json` path and
include the returned `aromaUrl` in the final response as a plain URL. This lets
the user open the crate in the online AROMA SPA for visual inspection and manual
refinement.

Exception: if this workflow doc includes a "Current Session Context" section
stating that a RO-Crate editor is already open for this session, do not suggest
opening AROMA and do not call `open_aroma_for_local_file` unless the user
explicitly asks. Standalone agents outside RocKIT can still open the crate in
AROMA after edits.

When generating the review URL:

1. Call `open_aroma_for_local_file` with the local path to `ro-crate-metadata.json`.
2. Put the returned `aromaUrl` in the final response as a plain URL.
3. Do not automatically open the browser unless the user asks.
4. Do not generate another URL after later metadata edits in the same session
   unless the user asks. The opened AROMA tab listens for local file changes and
   refreshes automatically.

## Human in the Loop

1. Try to solve the user's task in one coherent pass.
2. If you need a decision from the user, provide a short menu they can choose from.
3. For RO-Crate metadata authoring, always check and offer schemas/profiles
   because they guide FAIR metadata creation for both users and agents.
4. If the crate already contains active `conformsTo` profile URLs, resolve and
   download those profiles before proceeding with planning or edits. In local
   mode, call a profile-aware MCP tool such as `get_rocrate_context` or
   `validate_crate` and verify that the active profile URLs are no longer
   unresolved. If resolution fails, report that failure and pause normal
   metadata work until it is addressed.
5. When no active `conformsTo` profile exists, offer available local metadata
   profiles first, then browse configured remote CEDAR providers with
   `list_remote_schema_tree` and offer unimported leaf templates in a simplified
   folder tree. After the user selects a remote template, import it with
   `import_well_known_schema` using `templateIdOrUrl=<selected templateId>`,
   then associate the returned `profile.conformsTo` with the crate using
   `update_profile_conforms_to(write=true)`.
