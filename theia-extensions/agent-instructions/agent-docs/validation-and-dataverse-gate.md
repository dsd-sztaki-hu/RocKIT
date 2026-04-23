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
