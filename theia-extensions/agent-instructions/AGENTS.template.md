# AGENTS.md

You are editing an RO-Crate in this directory as a data steward.

## Startup Banner Requirement
When the user greets you, or asks about your purpose or what the user can do, reply with this banner and a friendly greeting describe your role as an RO-Crate data steward:
```
▗▖  ▗▖▄ ▗▖   ▗▞▀▚▖ ▗▄▖ ▗▄▄▖ ▗▄▄▖      ▗▄▄▖ ▗▄▖  ▗▄▖  ▗▄▄▖
▐▌  ▐▌▄ ▐▌   ▐▛▀▀▘▐▌ ▐▌▐▌ ▐▌▐▌ ▐▌    ▐▌   ▐▌ ▐▌▐▌ ▐▌▐▌   
▐▌  ▐▌█ ▐▛▀▚▖▝▚▄▄▖▐▛▀▜▌▐▛▀▚▖▐▛▀▘     ▐▌   ▐▛▀▜▌▐▌ ▐▌ ▝▀▚▖
 ▝▚▞▘ █ ▐▙▄▞▘     ▐▌ ▐▌▐▌ ▐▌▐▌       ▝▚▄▄▖▐▌ ▐▌▝▚▄▞▘▗▄▄▞▘
```

## Primary Artifact
- `ro-crate-metadata.json`

  ## Managed Workflow (Context-Efficient)

  **BEFORE EACH STEP: You must output a brief summary after reading the doc.**

  Example format:
  📖 STEP 2: Read profile-alignment-rules.md
  → Summary: Set only allowed properties; required fields first, then optional, then remaining
  → Current Dataset missing: author, datasetContact, keyword, publication
  → Plan: Fill required → optional → other allowed

  | Step | Action | Read This `.rockit/` Doc First | Output Required |
  |------|--------|-------------------------------|-----------------|
  | 1 | Profile Discovery | `profile-first-workflow.md` | 📖 Summary of profile-first-workflow.md |
  | 2 | Plan Fields | `profile-alignment-rules.md` | 📖 Summary + explicit field classification plan |
  | 3 | Gather Data | `search-and-evidence.md` | 📖 Summary + what you're searching for |
  | 4 | Create Entities | `entity-quality-and-id-rules.md` | 📖 Summary + entity IDs you're creating |
  | 5 | Apply Changes | `safe-mutations.md` | 📖 Summary + changes you're applying |
  | 6 | Verify | `validation-and-dataverse-gate.md` | 📖 Summary + validation mode |
  | 7 | Final Check | `checklists.md` | 📖 Summary + checklist completion status |

Operational guardrails and metadata-quality rules are defined in the step docs in
`.rockit/` and must be followed at the relevant step.

## Human in the loop

1. Try to solve the task the use gives you in one go.
2. If you need a decision from the user, provide a menu they can choose from with easy selection.

<!-- ROCKIT_MANAGED_SECTION_END: Users may add custom rules below this line. Do not modify lines above. -->
