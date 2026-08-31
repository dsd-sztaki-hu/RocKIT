# Repository Metadata Crosswalk

This document explains the structure and intended behavior of the generated
runtime crosswalks in [`../crosswalks/`](../crosswalks/).

The JSON is a draft, declarative description of:

- the metadata schemas supported by ARP plus one target repository;
- the semantic relationships between their fields;
- the transformations needed when exporting metadata;
- fields that intentionally have no equivalent in another repository;
- validation, missing-value, and reporting behavior.

The central design is:

```text
ARP metadata / ARP RO-Crate
              |
              v
     Canonical RO-Crate model
          /             \
         v               v
 Dataverse metadata   Zenodo metadata
```

RO-Crate is the canonical internal model. This avoids maintaining a separate
direct mapping for every pair of repositories.

In one sentence: the crosswalk JSON is a declarative specification describing
how metadata moves between ARP metadata, canonical RO-Crate, Dataverse, and
Zenodo, including transformations, validation, and intentionally unmapped
fields.

## Generated sources

The JSON files in `../crosswalks/` are generated from these source files.
Its versioned inputs are:

- `sources/arp-schema.json`: the ARP/CEDAR-derived schema snapshot;
- `sources/dataverse-schema.json`: the nearly equivalent Dataverse metadata
  block snapshot;
- `sources/zenodo-schema.json`: all represented Zenodo deposition fields;
- `sources/arp-to-canonical.json`: ARP-to-RO-Crate mapping decisions;
- `sources/canonical-to-dataverse.json`: RO-Crate-to-Dataverse decisions;
- `sources/zenodo-mapping-decisions.json`: one explicit decision for every
  Zenodo field;
- `sources/crosswalk-base.json`: format, transformation vocabulary,
  provenance, and reporting policy;
- `linkml/*.yaml`: source and target LinkML schemas plus the declarative
  canonical-to-Zenodo transformation.

Create the Python environment once from the repository root:

```powershell
python -m venv .venv-crosswalk
.\.venv-crosswalk\Scripts\Activate.ps1
python -m pip install -r `
  theia-extensions\data-repository-manager\src\browser\metadata-crosswalks\requirements.txt
```

Activate that environment in each new PowerShell session, then generate and
validate the artifact:

```powershell
.\.venv-crosswalk\Scripts\Activate.ps1
yarn workspace data-repository-manager crosswalk:generate
yarn workspace data-repository-manager crosswalk:check
```

The check fails if a Zenodo schema field is missing, duplicated, targets an
unknown field, disagrees with the LinkML transformation's primary source, or
if the checked-in JSON is stale. It also validates the specification through
the installed LinkML-Map library and executes the example transformation in
`examples/`. A field without a trustworthy ARP/Dataverse equivalent remains
present with `repositorySpecific` (or another explicit unmapped status) and
an explanation. It is never silently discarded.

The LinkML files model the portable, declarative part of the mapping using the
real LinkML-Map `TransformationSpecification`, `class_derivations`, and
`slot_derivations` models. Generation stops unless LinkML-Map reports that
the schemas and transformation are structurally and semantically valid.
Nested RO-Crate reference resolution, controlled vocabularies, conditional
requirements, and lossy conversions remain in the decision source because
they require richer repository-specific operations than a simple slot
derivation. The equivalent direct CLI validation, from the
`metadata-crosswalks` directory, is:

```powershell
linkml-map validate-spec `
  --source-schema linkml/canonical-metadata.schema.yaml `
  --target-schema linkml/zenodo-metadata.schema.yaml `
  linkml/canonical-to-zenodo.transform.yaml
```

The generated runtime files are:

- `../crosswalks/arp-dataverse-crosswalk.json`: ARP / RO-Crate to Dataverse;
- `../crosswalks/arp-zenodo-crosswalk.json`: ARP / RO-Crate to Zenodo.

Each file includes a machine-readable `id`, a display `name`, and a longer
`displayName` for future user-selectable crosswalks.

### Structure tree

```text
../crosswalks/arp-dataverse-crosswalk.json
|
|-- id, name, displayName
|   Crosswalk identity and user-facing label
|
|-- crosswalkFormat
|   Document name, version, date, and review status
|
|-- canonicalModel
|   How RO-Crate entities, IDs, types, and missing values are interpreted
|
|-- provenance
|   Sources and versions of the ARP, Dataverse, and Zenodo schemas
|
|-- documentModel
|   Mapping statuses such as mapped, needsReview, and unmapped
|
|-- transformationLibrary
|   Reusable operations: trim, normalizeDate, resolveReferences,
|   mapVocabulary, buildCompound, validateUrl, etc.
|
|-- repositories
|   |-- arp
|   |   ARP metadata blocks and fields
|   |-- dataverse
|   |   Metadata blocks, compound fields, and vocabularies
|
|-- crosswalks
|   |-- arpRoCrateToCanonical
|   |-- canonicalToDataverse
```

```text
../crosswalks/arp-zenodo-crosswalk.json
|
|-- id, name, displayName
|   Crosswalk identity and user-facing label
|
|-- crosswalkFormat / canonicalModel / provenance / documentModel
|   Shared crosswalk metadata and vocabulary
|
|-- repositories
|   |-- arp
|   |   ARP metadata blocks and fields
|   |-- zenodo
|   |   Zenodo deposition schema, requirements, and vocabularies
|
|-- crosswalks
|   |-- arpRoCrateToCanonical
|   |-- canonicalToZenodo
|
|-- validationAndReporting
|   Processing order and expected diagnostics
|
`-- coverage
    Counts of mapped, unmapped, and review-needed fields
```

## 1. Top-level structure

Each generated JSON has these main sections:

```json
{
  "crosswalkFormat": {},
  "canonicalModel": {},
  "provenance": {},
  "documentModel": {},
  "transformationLibrary": {},
  "repositories": {},
  "crosswalks": {},
  "validationAndReporting": {},
  "coverage": {}
}
```

Each section has a distinct responsibility:

| Section | Purpose |
| --- | --- |
| `crosswalkFormat` | Identifies and versions the crosswalk document itself. |
| `canonicalModel` | Defines how the canonical RO-Crate graph is interpreted. |
| `provenance` | Records where the embedded schema information came from. |
| `documentModel` | Defines mapping statuses and common terminology. |
| `transformationLibrary` | Defines the named operations mappings are allowed to use. |
| `repositories` | Stores the source and target schema contracts. |
| `crosswalks` | Stores the actual field-to-field mapping rules. |
| `validationAndReporting` | Describes processing and diagnostic output. |
| `coverage` | Summarizes how many fields are mapped or deliberately unmapped. |

## 2. `crosswalkFormat`

This section describes the crosswalk document, rather than repository
metadata.

It currently identifies the format as version `0.2.0-draft`, records its
generation date, and marks it as a draft for review. The crosswalk format
should be versioned independently from RO-Crate, Dataverse, or Zenodo because
the mapping language can evolve even when the repository schemas do not.

## 3. `canonicalModel`

This section defines the common semantic model through which mappings pass.
The current canonical model is RO-Crate 1.1:

- entities are stored in `@graph`;
- the root dataset has `@id: "./"`;
- entities are identified by `@id`;
- entity types are represented by `@type`.

It also defines placeholder values that should normally be treated as absent:

```json
["./", ".", "", null]
```

This is important because values such as `"./"` are meaningful as the
identifier of the RO-Crate root entity, but they are not valid metadata values
for fields such as a URL, author affiliation, or polygon count.

### IRI policy

The canonical model explicitly says not to invent missing property IRIs.

For example, an ARP-only field called `title_hu` must not automatically become:

```text
https://dataverse.org/schema/citation/title_hu
```

unless a source schema actually declares that identifier. A generated-looking
URL does not establish a semantic relationship.

Repository field identifiers may be retained as provenance, but unmatched
fields receive no canonical property and no target mapping. This distinction
prevents a repository-specific field name from being mistaken for a shared
semantic concept.

## 4. `provenance`

The provenance section records the origin of the material used to assemble the
crosswalk, such as:

- ARP/CEDAR schema files;
- cached Dataverse metadata block schemas;
- Zenodo's official API representation documentation;
- schema versions, source locations, and hashes where available.

This makes it possible to answer questions such as:

- Which version of a repository schema was used?
- Was a field copied from an official schema or inferred locally?
- Does the crosswalk need to be regenerated after a schema changes?

Provenance does not itself create mappings. It only records where the evidence
for schemas and mappings came from.

## 5. `documentModel`

The document model defines the statuses used to describe whether a mapping is
accepted, unresolved, repository-specific, or intentionally unmapped.

### Mapping statuses

The current statuses include:

- `mapped`: a usable mapping exists;
- `exactNameAndProfileMatch`: source and target agree by name and profile;
- `normalizedNameProfileMatch`: a match was made after safe normalization;
- `needsReview`: a plausible mapping exists but requires human confirmation;
- `repositorySpecific`: the field is intentionally specific to one system;
- `targetOnlyUnmapped`: the target accepts the field, but no source was found;
- `sourceOnlyUnmapped`: the source field has no appropriate target.

The crosswalk deliberately has no confidence score. A mapping is either
accepted as usable, explicitly awaiting an answer under `needsReview`, or not
mapped. Unresolved mappings must not be treated as approximately correct.

## 6. `transformationLibrary`

The transformation library defines the small, controlled language used to
convert values. It contains operation definitions, not arbitrary executable
JavaScript.

The current operation vocabulary includes:

- `omitEmpty`
- `omitValues`
- `trim`
- `firstNonEmpty`
- `first`
- `asArray`
- `normalizeDate`
- `validateUrl`
- `validateEmail`
- `parseInteger`
- `parseNumber`
- `mapVocabulary`
- `resolveReferences`
- `mapEntities`
- `buildCompound`
- `flattenText`
- `defaultValue`
- `filterByValue`
- `inferResourceType`
- `deriveAccessRight`
- `aggregateIdentifiers`
- `custom`

### Definition versus invocation

An operation's definition explains what the operation means and which
parameters it accepts. A mapping invokes that operation by name and supplies
the parameters needed for that field.

For example, the library may define `validateUrl` as accepting allowed schemes
and an invalid-value policy. A mapping can then invoke it like this:

```json
{
  "operation": "validateUrl",
  "schemes": ["http", "https"],
  "onInvalid": "reportForReview"
}
```

The JSON does not contain the URL-validation algorithm. The application must
implement `validateUrl` once, then every mapping can reuse it consistently.

An engine should reject unknown operations instead of silently ignoring them.
That keeps the crosswalk predictable, testable, and safe to share.

### Transformation order

Transformations are arrays and must be applied in their listed order. For
example:

```json
"transform": [
  { "operation": "omitEmpty" },
  { "operation": "omitValues", "values": ["./", "."] },
  { "operation": "trim" },
  { "operation": "first" }
]
```

This means:

1. remove empty values;
2. remove known placeholders;
3. trim surrounding whitespace;
4. if multiple values remain, select the first.

Changing that order can change the result, so the order is part of the mapping
contract.

## 7. `repositories`

This section describes what each repository or metadata system accepts. These
are target/source schema contracts, not the mappings themselves.

### 7.1 ARP

`repositories.arp.blocks` contains the seven ARP metadata blocks:

1. `3dobjects`
2. `astrophysics`
3. `biomedical`
4. `citation`
5. `geospatial`
6. `journal`
7. `socialscience`

Each block retains information from the original CEDAR schema and the derived
RO-Crate profile. This is where ARP-specific fields are represented, including
fields such as `title_hu` and Hungarian descriptions.

The presence of a field here does not imply that it must be mapped. It only
states that the field exists in ARP.

### 7.2 Dataverse

`repositories.dataverse.blocks` embeds the Dataverse metadata block contracts.
These include:

- top-level fields;
- compound child fields;
- types and cardinalities;
- required flags;
- controlled-vocabulary values;
- schema paths used during validation.

Embedding the target schema allows a mapping rule to refer to an exact target
definition instead of duplicating its type and vocabulary in every rule.

### 7.3 Zenodo

The Zenodo section contains:

- `apiRequest`: how the metadata request is sent;
- `officialRequirements`: required and conditional fields;
- `schemaAugmentations`: details added from official documentation;
- `source`: documentation provenance;
- `schema`: the complete represented Zenodo metadata fields.

For the legacy deposition API, metadata is sent with a request shaped like:

```http
PUT /api/deposit/depositions/{id}
Content-Type: application/json
```

```json
{
  "metadata": {
    "upload_type": "dataset",
    "publication_date": "2026-07-15",
    "title": "Example dataset",
    "creators": [
      { "name": "Example Author" }
    ],
    "description": "Example description",
    "access_right": "open"
  }
}
```

The metadata JSON is the request body. It does not need to exist as a physical
file in the workspace.

The schema contains 44 represented fields, not only the required fields.
Zenodo's base required fields include:

- `upload_type`
- `publication_date`
- `title`
- `creators`
- `description`
- `access_right`

Some fields are conditionally required. Examples include `publication_type`,
`image_type`, `license`, `embargo_date`, and `access_conditions`, depending on
other metadata values.

## 8. `crosswalks`

This is where the actual mapping rules are stored. It has three principal
groups:

```text
arpRoCrateToCanonical
canonicalToDataverse
canonicalToZenodo
```

Each mapping normally describes:

- one or more candidate source properties;
- the target field or canonical property;
- source and target cardinality;
- transformation steps;
- required-field behavior;
- mapping status;
- whether the conversion is lossy;
- a path to the relevant embedded schema definition.

### 8.1 ARP/RO-Crate to canonical RO-Crate

A simplified title mapping looks conceptually like this:

```json
{
  "source": {
    "block": "citation",
    "field": "Dataset title"
  },
  "canonical": {
    "entity": "root",
    "property": "http://purl.org/dc/terms/title"
  },
  "required": true,
  "transform": [
    { "operation": "omitEmpty" },
    { "operation": "omitValues", "values": ["./", "."] },
    { "operation": "trim" },
    { "operation": "first" }
  ],
  "onMissing": {
    "action": "error"
  }
}
```

This says that the ARP dataset title represents the canonical title of the
root dataset. It cleans the value and requires a usable result.

### Intentionally unmapped ARP fields

ARP-only fields such as `title_hu` belong under `unmappedSourceFields`. A rule
for such a field records that it exists but has no trustworthy semantic match:

```json
{
  "source": {
    "block": "citation",
    "field": "title_hu"
  },
  "mappingStatus": "sourceOnlyUnmapped",
  "canonical": null,
  "targets": [],
  "preservation": "arpOnly"
}
```

This is deliberate metadata preservation, not a failure. The value remains
available in ARP, but it is not falsely placed in an unrelated Dataverse or
Zenodo field.

If the ARP schema declares an identifier for `title_hu`, it may be retained in
a provenance property such as `declaredPropertyId`. That still does not mean
the identifier has a matching property in another repository.

### 8.2 Canonical RO-Crate to Dataverse

The Dataverse mappings target a metadata block and field. A simplified
`alternativeURL` rule looks like:

```json
{
  "sourceCandidates": [
    {
      "entity": "root",
      "property": "https://schema.org/distribution"
    }
  ],
  "target": {
    "block": "citation",
    "field": "alternativeURL",
    "type": "URL",
    "cardinality": "scalar"
  },
  "transform": [
    { "operation": "omitEmpty" },
    { "operation": "omitValues", "values": ["./", "."] },
    {
      "operation": "validateUrl",
      "schemes": ["http", "https"],
      "onInvalid": "reportForReview"
    },
    { "operation": "first" }
  ]
}
```

This rule ensures that a placeholder such as `"./"` is not sent as an
alternative URL. Only a usable absolute HTTP or HTTPS URL can reach the target.

The mapping's `schemaPath` points to the embedded Dataverse field definition.
The engine can use that definition to confirm the type, cardinality, required
flag, and controlled vocabulary.

### Dataverse compound fields

Dataverse represents structures such as authors as compound fields. A mapping
therefore needs to build an array of compound values rather than copy a single
string.

A typical author transformation uses:

1. `resolveReferences` to follow RO-Crate `@id` references;
2. `buildCompound` to create Dataverse child fields;
3. child mappings for `authorName`, `authorAffiliation`,
   `authorIdentifierScheme`, and `authorIdentifier`;
4. `asArray` to satisfy Dataverse's multiple-value representation.

The resulting structure is conceptually:

```json
{
  "typeName": "author",
  "typeClass": "compound",
  "multiple": true,
  "value": [
    {
      "authorName": {
        "typeName": "authorName",
        "typeClass": "primitive",
        "multiple": false,
        "value": "Zoltán Tóth"
      },
      "authorAffiliation": {
        "typeName": "authorAffiliation",
        "typeClass": "primitive",
        "multiple": false,
        "value": "SZTAKI"
      }
    }
  ]
}
```

### 8.3 Canonical RO-Crate to Zenodo

Zenodo mappings target paths inside `metadata`.

For creators, a simplified rule can use both Dublin Core Terms and Schema.org
source candidates:

```json
{
  "sourceCandidates": [
    {
      "entity": "root",
      "property": "http://purl.org/dc/terms/creator"
    },
    {
      "entity": "root",
      "property": "https://schema.org/author"
    }
  ],
  "target": {
    "path": "metadata.creators"
  },
  "transform": [
    { "operation": "resolveReferences" },
    {
      "operation": "mapEntities",
      "fields": {
        "name": ["authorName", "name"],
        "affiliation": ["authorAffiliation", "affiliation"],
        "orcid": ["authorIdentifier", "identifier"]
      }
    },
    { "operation": "asArray" }
  ]
}
```

The actual implementation should only send an identifier as `orcid` after
confirming that it uses the ORCID scheme. A generic identifier must not be
silently relabelled as an ORCID.

For publication date, the rule can try multiple source candidates:

```json
{
  "sourceCandidates": [
    {
      "entity": "root",
      "property": "https://schema.org/datePublished"
    },
    {
      "entity": "root",
      "property": "productionDate"
    }
  ],
  "target": {
    "path": "metadata.publication_date"
  },
  "required": true,
  "transform": [
    { "operation": "firstNonEmpty" },
    { "operation": "normalizeDate", "format": "YYYY-MM-DD" }
  ]
}
```

Candidate order matters: the engine tries the most semantically appropriate
source first, then falls back to later candidates.

## 9. Controlled vocabularies

A controlled-vocabulary mapping can refer to the vocabulary in the embedded
repository schema through `vocabularyPath`.

It may also invoke `mapVocabulary`:

```json
{
  "operation": "mapVocabulary",
  "values": {
    "Computer Science": "Computer and Information Science",
    "Life Sciences": "Medicine, Health and Life Sciences"
  },
  "onUnknown": "reportForReview"
}
```

Possible unknown-value policies include:

- `omit`
- `keep`
- `error`
- `useDefault`
- `reportForReview`

`reportForReview` is useful during development because it exposes uncertain
metadata instead of silently losing it or uploading an invalid value.

## 10. Cardinality conversion

Repositories do not always agree on whether a field is singular or repeated.
The crosswalk makes cardinality changes explicit:

- `asArray` converts a scalar to a one-element array when necessary;
- `first` reduces a list to one value;
- `firstNonEmpty` chooses the first usable candidate.

Reducing several source values to one target value is potentially lossy. Such
a mapping should be marked and reported so users can see that information was
discarded.

## 11. Missing-field behavior

Mappings can specify `onMissing` behavior. Typical actions are:

- `error`: stop validation because a required value is unavailable;
- `omit`: leave an optional target field out of the request;
- `errorWhenConditionMatches`: require the field only when another target
  value makes it mandatory.

For example, Zenodo's `embargo_date` is relevant only for embargoed records.
A conditional rule is more accurate than treating it as always required or
always optional.

Placeholders such as `"./"` should not be used to satisfy required metadata.
If a meaningful required value is unavailable, validation should explain the
problem before upload.

## 12. `validationAndReporting`

This section describes the expected processing pipeline:

1. load and index the RO-Crate graph;
2. locate candidate source properties;
3. resolve referenced entities;
4. choose values according to candidate and selection rules;
5. apply transformations in their declared order;
6. apply missing-value behavior;
7. validate the result against the target schema;
8. enforce required and conditional requirements;
9. construct the target request payload;
10. produce a mapping report.

The report is expected to count or list outcomes such as:

- mapped;
- omitted;
- transformed;
- unmapped;
- invalid;
- lossy;
- needs review.

For example, instead of only reporting that Dataverse rejected
`alternativeURL`, the preview could say:

```text
Source: RO-Crate distribution
Value: ./
Target: Dataverse citation.alternativeURL
Result: omitted
Reason: the value is a root identifier, not an absolute HTTP/HTTPS URL
```

## 13. `coverage`

The coverage section is a generated summary of the current crosswalk. It helps
identify gaps without scanning the entire JSON.

The current draft reports:

| Category | Count |
| --- | ---: |
| ARP-to-canonical mappings | 176 |
| ARP source-only unmapped fields | 6 |
| Dataverse top-level mappings | 117 |
| Dataverse mappings without an open question | 101 |
| Dataverse mappings awaiting review | 3 |
| Dataverse compound child mappings | 86 |
| Dataverse target-only unmapped top-level fields | 13 |
| Dataverse target-only unmapped child fields | 14 |
| Zenodo mappings | 44 |
| Zenodo mappings without an open question | 16 |
| Zenodo mappings awaiting review | 22 |
| Zenodo repository-specific fields | 6 |
| Zenodo fields with no source mapping | 3 |

Coverage is not the same as correctness. A field can be counted as mapped but
still be marked `needsReview`. Such a field is an unresolved proposal and must
not be used as an approved mapping until its question has been answered.

## 14. How a generic mapping engine would use the file

For each target field, the engine would:

1. find the relevant mapping rule;
2. read its source candidates in order;
3. retrieve values from the root entity or linked entities;
4. resolve references where requested;
5. apply every transformation in sequence;
6. enforce `onMissing` behavior;
7. validate the result using `schemaPath` and repository requirements;
8. write the result to the target block, field, or JSON path;
9. record the result in a mapping report.

The same engine can process many fields because repository-specific decisions
are represented as data. Hardcoded code is still needed to implement the
finite transformation operations and the final repository HTTP requests, but
field-by-field choices no longer need to live throughout the application.

## 15. What the JSON does not do by itself

The crosswalk is declarative. Merely loading it does not perform a conversion.
Application code must still:

- understand RO-Crate graphs and resolve `@id` references;
- implement each named transformation operation;
- validate values and target structures;
- create Dataverse and Zenodo request bodies;
- upload those request bodies;
- generate the mapping report.

The JSON says *what* should happen. The mapping engine implements *how* the
allowed operations happen.

## 16. Areas that still need review

The crosswalk is intentionally a draft. Important areas for later verification
include:

- ensuring author identifiers are only exported as ORCID when their scheme is
  actually ORCID;
- reviewing repository-specific Zenodo fields;
- completing explicit controlled-vocabulary value maps;
- resolving the open conference, thesis, location, access, identifier, imprint,
  subject, version, and method mappings one by one;
- deciding which `direction: "both"` rules are genuinely reversible;
- defining exactly how the UI handles `reportForReview` results;
- testing mappings against real ARP, Dataverse, and Zenodo payloads.

Most importantly, a source-only field is not automatically a defect. Fields
such as `title_hu` can remain intentionally unmapped when no semantically valid
target exists. Preserving that fact is safer than inventing an IRI or forcing
the value into an unrelated repository field.
