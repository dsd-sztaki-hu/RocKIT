# Dataverse Metadata Mapping

This note documents the ARP/RO-Crate to Dataverse native metadata mapping used for dataset metadata updates.

## Source and Target

- Source metadata: `ro-crate-metadata.json`
- Source schema family: `metadata-schemas/ro-crate/*.json`
- Target schema cache: `metadata-schemas/dataverse/*.json`
- Target upload shape: Dataverse native dataset version JSON, specifically `metadataBlocks.{blockName}.fields`.

The Dataverse schemas are downloaded from the selected Dataverse repository before import/export with:

```text
/api/metadatablocks?returnDatasetFieldTypes=true
```

The mapper does not perform an expensive schema diff during upload. The cached Dataverse metadata blocks are treated as the target contract. This naturally excludes ARP-only fields because the mapper only emits fields that exist in Dataverse.

## Covered Blocks

The cache/download step targets the seven ARP metadata profiles currently used by RocKIT:

```text
3D Objects Metadata
Journal Metadata
Social Science and Humanities Metadata
Geospatial Metadata
Life Sciences Metadata
Citation Metadata
Astronomy and Astrophysics Metadata
```

The mapper loads every cached JSON block under:

```text
metadata-schemas/dataverse/
```

Each generated block is keyed by the actual Dataverse block `name`, so server-specific aliases are preserved.

## Mapping Rules

Primitive fields are read from the root Dataset entity, or from RO-Crate entities whose `@type` matches the Dataverse field name.

Compound fields are read from:

- root Dataset references using the compound field name
- RO-Crate entities whose `@type` matches the compound field name
- citation-specific literal fallbacks for `author`, `datasetContact`, and `dsDescription`

The generated native Dataverse field shape is:

```json
{
  "typeName": "title",
  "multiple": false,
  "typeClass": "primitive",
  "value": "Dataset title"
}
```

Compound fields are generated as:

```json
{
  "typeName": "author",
  "multiple": true,
  "typeClass": "compound",
  "value": [
    {
      "authorName": {
        "typeName": "authorName",
        "multiple": false,
        "typeClass": "primitive",
        "value": "Spruce, Sabrina"
      }
    }
  ]
}
```

## Transformations

- Dataverse `controlledVocabulary` fields are emitted only when the value exists in the cached Dataverse vocabulary.
- Dataverse `DATE` fields are normalized to `YYYY-MM-DD` where possible.
- Dataverse `EMAIL` fields are emitted only when the value looks like a valid email address.
- Dataverse `FLOAT` and `INT` fields are converted from numeric-looking strings to numbers.
- `multiple: true` fields emit arrays; `multiple: false` fields emit a scalar.

If the native metadata update endpoint rejects a field with an `incorrect multiple for field ...` parser error, the client retries the update after adjusting that field's `multiple` flag and value shape. This handles Dataverse installations where the metadata block description and native update parser disagree about a field's multiplicity.

## Known Exclusions

The citation comparison found these ARP-only Hungarian fields. They are intentionally not exported:

```text
citation.title_hu
citation.dsDescription_hu
citation.dsDescription_hu.dsDescriptionValue_hu
citation.dsDescription_hu.dsDescriptionDate_hu
```

Other ARP-only fields in non-citation profiles are also not emitted unless the selected Dataverse server exposes a matching field in its cached metadata block schema.

## Fallbacks

The mapper preserves existing practical citation fallbacks:

- `title` can fall back to root Dataset `name`.
- `author.authorName` can fall back to author entity `name`.
- `datasetContact` can use `contactPoint`.
- `datasetContact.datasetContactEmail` can fall back to `email`.
- `dsDescription.dsDescriptionValue` can fall back to `description` or `name`.

If the cached Dataverse schemas cannot be read, native Dataverse update falls back to the older hardcoded mapper.
