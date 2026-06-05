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

## Human in the Loop

1. Try to solve the user's task in one coherent pass.
2. If you need a decision from the user, provide a short menu they can choose from.
