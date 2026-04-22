# Entity Quality and ID Rules

These rules are mandatory for RO-Crate metadata quality.

1. Every entity in `@graph` must have a human-friendly `name`.
2. Do not leave `name` empty.
3. Do not use `@id` as `name` when a clearer human label is available.
4. For role entities (for example `author`), keep role-specific fields (for example `authorName`) and also provide `name`.
5. For new entities, generate descriptive `@id` values.
   - Example: `#author-laszlo-kovacs`
   - Avoid generic IDs like `#author1`, `#entity123`, `#item`.
6. Ensure every new `@id` is unique within the crate and does not collide with existing IDs.
7. Use only profile-allowed fields plus RO-Crate built-ins.
8. Do not invent factual metadata unless user explicitly requests examples.
9. If data is missing, report missing fields clearly; do not inject dummy placeholders unless explicitly requested.
