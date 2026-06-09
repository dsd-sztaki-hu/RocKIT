# Entity Quality and ID Rules

These rules are mandatory for RO-Crate metadata quality.

1. Every entity in `@graph` must have a human-friendly `name`.
2. Do not leave `name` empty.
3. Do not use `@id` as `name` when a clearer human label is available.
   - Avoid ID-derived labels such as `author-hun-ren-arp-team` or `source-service-map`.
   - Prefer labels such as `HUN-REN ARP team` or `Source: ARP service map`.
4. For `File` entities, use the final filename segment from `@id` as `name`.
   - Example: `file://./dir1/img_excel_chart_intro_1.svg` -> `img_excel_chart_intro_1.svg`.
   - Do not invent descriptive file names such as `Excel chart introduction SVG`.
5. For role entities (for example `author`), keep role-specific fields (for example `authorName`) and also provide `name`.
6. For new entities, generate descriptive `@id` values.
   - Example: `#author-laszlo-kovacs`
   - Avoid generic IDs like `#author1`, `#entity123`, `#item`.
7. Ensure every new `@id` is unique within the crate and does not collide with existing IDs.
8. Use only profile-allowed fields plus RO-Crate built-ins.
9. Do not invent factual metadata unless user explicitly requests examples.
10. If data is missing, report missing fields clearly; do not inject dummy placeholders unless explicitly requested.
