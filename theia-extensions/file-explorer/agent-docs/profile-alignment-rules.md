# Profile Alignment Rules

1. Profile conformance is a hard constraint for profiled `Dataset`/`File` entities.
2. Set only properties explicitly allowed by active profile rules.
3. If a requested property is disallowed:
   - explain the constraint,
   - propose an allowed alternative field/entity,
   - or propose profile update via `update_profile_conforms_to`.
4. Never force disallowed fields via custom `@context` mappings.
5. Use profile value-set hints from validation output when present.
6. Keep `conformsTo` changes separate:
   - use `update_profile_conforms_to(write=true)`,
   - then `read_crate`,
   - then continue edits.
