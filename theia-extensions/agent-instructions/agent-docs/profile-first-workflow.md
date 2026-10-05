# Profile-First Workflow

Always follow this sequence when curating RO-Crate metadata:

0. Use MCP `rocrate` tools for metadata edits and validation. Do not edit JSON directly.
1. If the user requested local crate creation or adding files from a directory
   and `ro-crate-metadata.json` is absent, call `create_default_rocrate` first.
   Do not pause to ask whether to initialize. Then call `get_rocrate_context`.
   For an existing crate, call `get_rocrate_context` before any edit.
2. Identify whether the crate already has active `conformsTo` profile URLs.
   If active `conformsTo` URLs are present, the user has already selected the
   profile context; work with those profiles instead of offering replacement
   profile choices unless the user asks to change them.
3. For RO-Crate metadata authoring, always check and offer metadata profiles because they guide FAIR metadata creation for both users and agents.
4. If no active profile is present:
   - call `list_metadata_profiles` to show locally available metadata profiles,
   - call `list_remote_template_tree` to browse configured remote CEDAR providers
     when local profiles are empty, insufficient, or the user may want a remote
     profile,
   - present every available local profile returned by `list_metadata_profiles` by name, version, and `conformsTo` URL,
   - present remote CEDAR templates separately as a simplified folder tree with
     only selectable leaf templates; do not list templates already imported
     locally,
   - do not collapse the list to only the profile you recommend,
   - if one profile seems best, mark it as recommended while still listing the other available profiles,
   - show the choices in the visible chat message as a clearly formatted Markdown menu, not only in tool output or collapsed details. Use a numbered list with one selectable profile/template per item; do not combine choices into a comma-separated paragraph.
   - group local profiles and remote CEDAR templates under separate short headings. Include each local profile's name, version, and `conformsTo` URL. For each remote leaf template, show its provider/folder path and template name; keep each choice on its own numbered line. Mark a recommendation inline without hiding other choices.
   - offer a numbered menu in this order: all listed local profiles and remote templates first, then "provide another metadata profile URL", then "continue without a profile". End with a direct prompt such as "Reply with the number of your choice." Keep the numbering continuous across groups.
   - stop and wait for the user's choice before planning fields, searching the web, or writing metadata,
   - for an already-downloaded local profile, call `update_profile_conforms_to`
     with its `conformsTo` URL after the user chooses it,
   - for a remote CEDAR leaf template, call `import_remote_template` with
     `templateIdOrUrl=<selected templateId>`, then call
     `update_profile_conforms_to(write=true)` with the returned
     `profile.conformsTo`,
   - if no profiles or templates can be listed because of an error, report the error and still offer the user a chance to provide a metadata profile URL.
5. Do not silently continue without a profile after listing available profiles. Continuing without a profile requires the user's explicit choice.
6. Read active profile constraints from `profileRules.allowedPropertiesByClass`.
7. If constraints are missing or unclear, call `resolve_metadata_profile`.
8. Build a short plan:
   - required fields still missing
   - recommended optional fields
   - custom fields outside the active profile, if relevant
9. Only after planning, run web `search` if needed for missing values.
10. Only then start metadata writes with `apply_changes` (default persists in local mode).
   - Use `dryRun=true` when you want preview-only execution.
11. Do not use destructive mutations unless user explicitly requested them and approved `confirmDestructive=true`.
12. After writes, call `read_crate` to verify.
13. Call `validate_crate`:
   - iterative edits: `profileRequiredMode=allow_missing`
   - final publication gate: `profileRequiredMode=enforce_required`

Do not skip profile discovery and infer fields from class names.
