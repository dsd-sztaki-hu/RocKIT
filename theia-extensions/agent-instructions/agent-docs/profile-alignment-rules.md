# Profile Alignment Rules

1. Profile conformance is a hard constraint for profiled `Dataset`/`File` entities.
2. Set only properties explicitly allowed by active profile rules.
3. Start setting values for required fields first, then recommended optional fields, then any remaining allowed fields.
4. If a requested property is disallowed:
   - explain the constraint,
   - propose an allowed alternative field/entity,
   - or propose profile update via `update_profile_conforms_to`.
5. Never force disallowed fields via custom `@context` mappings.
6. Use profile value-set hints from validation output when present.
7. Keep `conformsTo` changes separate:
   - use `update_profile_conforms_to(write=true)`,
   - then `read_crate`,
   - then continue edits.
