# Validation and Dataverse Gate

Run validation after every meaningful edit set.

1. During iterative editing:
   - `validate_crate(profileRequiredMode=allow_missing)`
2. Before publication or Dataverse upload:
   - `validate_crate(profileRequiredMode=enforce_required)`
3. After writes, always run `read_crate` to verify intended changes are present.
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
6. For the default configured instance, call `upload_rocrate_to_dataverse(write=true)` immediately after final validation passes.
7. Do not pass `baseUrl`, `apiKey`, or `ownerId` for the default configured instance; let the MCP use its existing configuration and defaults.
8. Do not offer local/custom Dataverse choices before the first upload attempt.
9. If the default upload fails because configuration, authentication, or connectivity is missing or wrong, then ask for the missing Dataverse base URL and/or API token.
10. After a successful upload, read the returned payload from `upload_rocrate_to_dataverse`.
11. Report the returned `dataverseUrl` to the user as the newly created dataset link.
12. If the returned payload includes `pendingDataverseCrate`, Dataverse has produced an updated RO-Crate with assigned dataset/file IDs and the MCP has saved it as a pending version.
13. Ask the user whether they want to replace the local `ro-crate-metadata.json` with this Dataverse-updated version for future edit/sync workflows.
14. In terminal chat, if the user agrees, call `adopt_pending_dataverse_rocrate(pendingId=<pendingDataverseCrate.id>, write=true)`. In native AROMA chat, the UI may show this confirmation popup and apply the pending version itself.
15. If the user asks for uploaded file links, derive them from returned `fileLinks` when present.
16. If the user asks to upload to another Dataverse installation, ask for:
   - the Dataverse base URL
   - the Dataverse API token
17. Never reveal API tokens or other secrets unless the user explicitly asks to display them.
