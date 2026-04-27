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
5. For the default configured instance, use `upload_rocrate_to_dataverse(write=true)` only after the user confirms they want the upload.
6. Do not pass `baseUrl` or `apiKey` for the default configured instance; let the MCP use its existing configuration.
7. If the default upload fails because configuration or authentication is missing, then ask for the missing Dataverse base URL and/or API token.
8. If the user asks to upload to another Dataverse installation, ask for:
   - the Dataverse base URL
   - the Dataverse API token
9. Never reveal API tokens or other secrets unless the user explicitly asks to display them.
