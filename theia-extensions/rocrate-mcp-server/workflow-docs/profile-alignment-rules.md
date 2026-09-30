# Profile Alignment Rules

1. Profile conformance is a hard constraint for required fields, value sets, and entity types on profiled `Dataset`/`File` entities.
2. Prefer properties explicitly allowed by active profile rules for curated metadata.
3. Start setting values for required fields first, then recommended optional fields, then any remaining allowed fields.
4. Custom properties outside the active profile are allowed when they have JSON-LD context mappings.
   - Treat validation messages about custom properties as advisory notes.
   - Do not delete, rename, or migrate custom properties unless the user explicitly asks.
   - If useful, mention an allowed alternative field or profile update, but keep the user's custom metadata intact.
5. Every custom property must be defined by `@context`, either through a referenced context URL or an inline mapping.
   - Example: `@context`: [`https://w3id.org/ro/crate/1.1/context`, { `directoryLabel`: `https://dataverse.org/schema/file/directoryLabel` }].
   - If the correct IRI is unknown, ask the user for the mapping instead of inventing one or deleting the property.
6. Use profile value-set hints from validation output when present.
7. Keep `conformsTo` changes separate:
   - use `update_profile_conforms_to(write=true)`,
   - then `read_crate`,
   - then continue edits.
