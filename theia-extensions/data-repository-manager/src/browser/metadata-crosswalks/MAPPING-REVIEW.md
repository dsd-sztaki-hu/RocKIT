# Crosswalk Mapping Review Worksheet

This worksheet contains every crosswalk pairing currently marked `needsReview`.
None of these 25 pairings should be treated as approved until its decision is
recorded here and then applied to the crosswalk JSON.

## How to answer

For every entry, replace `TODO` after **Decision** with one of:

- `ACCEPT` -- the proposed source, target, direction, and transformations are correct;
- `REJECT` -- no automatic mapping should exist;
- `CHANGE` -- a mapping should exist, but something shown must be changed.

When choosing `CHANGE`, describe the correct source field, target field, direction,
or transformation under **Your notes**. You can edit this Markdown file directly
and tell me when it is complete.

## Summary

| # | Mapping | Proposed source | Target | Decision   |
| ---: | --- | --- | --- |------------|
| 1 | `zenodo.access_conditions` | `accessToSources` (citation, root) | `metadata.access_conditions` | ACCEPT (?) |
| 2 | `zenodo.access_right` | `conditionsOfAccess` (canonical, root)<br>`accessToSources` (citation, root) | `metadata.access_right` | TODO       |
| 3 | `zenodo.conference_acronym` | `conferenceAcronym` (canonical, publication) | `metadata.conference_acronym` | TODO       |
| 4 | `zenodo.conference_dates` | `timePeriodCoveredStart` (citation, timePeriodCovered)<br>`timePeriodCoveredEnd` (citation, timePeriodCovered) | `metadata.conference_dates` | TODO       |
| 5 | `zenodo.conference_place` | `productionPlace` (citation, root) | `metadata.conference_place` | TODO       |
| 6 | `zenodo.conference_title` | `publicationCitation` (citation, publication) | `metadata.conference_title` | TODO       |
| 7 | `zenodo.conference_url` | `publicationURL` (citation, publication) | `metadata.conference_url` | TODO       |
| 8 | `zenodo.doi` | `otherId` (citation, root)<br>`identifier` (canonical, root) | `metadata.doi` | TODO       |
| 9 | `zenodo.embargo_date` | `distributionDate` (citation, root) | `metadata.embargo_date` | TODO       |
| 10 | `zenodo.image_type` | `additionalType` (canonical, root) | `metadata.image_type` | TODO       |
| 11 | `zenodo.imprint_isbn` | `otherId` (citation, root) | `metadata.imprint_isbn` | TODO       |
| 12 | `zenodo.imprint_place` | `productionPlace` (citation, root) | `metadata.imprint_place` | TODO       |
| 13 | `zenodo.imprint_publisher` | `producer` (citation, root) | `metadata.imprint_publisher` | TODO       |
| 14 | `zenodo.journal_title` | `publicationCitation` (citation, publication)<br>`journalTitle` (canonical, publication) | `metadata.journal_title` | TODO       |
| 15 | `zenodo.partof_title` | `seriesName` (citation, series)<br>`isPartOf` (canonical, root) | `metadata.partof_title` | TODO       |
| 16 | `zenodo.publication_type` | `publicationType` (canonical, root)<br>`publicationRelationType` (citation, publication) | `metadata.publication_type` | TODO       |
| 17 | `zenodo.subjects` | `topicClassification` (citation, root)<br>`keyword` (citation, root)<br>`subject` (citation, root) | `metadata.subjects` | TODO       |
| 18 | `zenodo.thesis_supervisors` | `contributor` (citation, root) | `metadata.thesis_supervisors` | TODO       |
| 19 | `zenodo.thesis_university` | `producer` (citation, root) | `metadata.thesis_university` | TODO       |
| 20 | `zenodo.version` | `softwareVersion` (citation, software)<br>`version` (canonical, root) | `metadata.version` | TODO       |
| 21 | `zenodo.locations` | `geographicCoverage` (geospatial, root)<br>`geographicBoundingBox` (geospatial, root) | `metadata.locations` | TODO       |
| 22 | `zenodo.method` | `measurementTechnique` (canonical, root)<br>`samplingProcedure` (socialscience, root)<br>`collectionMode` (socialscience, root)<br>`researchInstrument` (socialscience, root) | `metadata.method` | TODO       |
| 23 | `dataverse.astrophysics.coverage.Spectral.Bandpass` | `coverage.Spectral:Bandpass` (astrophysics, root) | `astrophysics.coverage.Spectral.Bandpass` | TODO       |
| 24 | `dataverse.astrophysics.coverage.Spectral.CentralWavelength` | `coverage.Spectral:CentralWavelength` (astrophysics, root) | `astrophysics.coverage.Spectral.CentralWavelength` | TODO       |
| 25 | `dataverse.astrophysics.coverage.Spectral.Wavelength` | `coverage.Spectral:Wavelength` (astrophysics, root) | `astrophysics.coverage.Spectral.Wavelength` | TODO       |

## Detailed decisions

### 1. `zenodo.access_conditions`

**Question:** Should the proposed source metadata populate Zenodo `metadata.access_conditions`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `accessToSources`
  - Declared property: `https://dataverse.org/schema/citation/accessToSources`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `TextArea`
  - Multiple: `false`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.access_conditions`
- Type: `string`
- Required: `false`
- Conditionally required: `{"when": {"field": "access_right", "equals": "restricted"}}`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "errorWhenConditionMatches", "condition": {"field": "access_right", "equals": "restricted"}}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 2. `zenodo.access_right`

**Question:** Should the proposed source metadata populate Zenodo `metadata.access_right`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `conditionsOfAccess`
  - Declared property: `https://schema.org/conditionsOfAccess`
  - Block/model: `canonical`
  - Entity: `root`
#### Candidate 2

- Field/property: `accessToSources`
  - Declared property: `https://dataverse.org/schema/citation/accessToSources`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `TextArea`
  - Multiple: `false`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.access_right`
- Type: `string`
- Required: `true`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `deriveAccessRight` with `{"default": "open", "onAmbiguous": "reportForReview"}`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "error", "message": "Zenodo requires metadata.access_right."}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 3. `zenodo.conference_acronym`

**Question:** Should the proposed source metadata populate Zenodo `metadata.conference_acronym`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `conferenceAcronym`
  - Declared property: `https://schema.org/alternateName`
  - Block/model: `canonical`
  - Entity: `publication`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.conference_acronym`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 4. `zenodo.conference_dates`

**Question:** Should the proposed source metadata populate Zenodo `metadata.conference_dates`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `timePeriodCoveredStart`
  - Declared property: `https://dataverse.org/schema/citation/timePeriodCoveredStart`
  - Block/model: `citation`
  - Entity: `timePeriodCovered`
  - Entity class: `timePeriodCovered`
  - Value types: `Date`
  - Multiple: `false`
#### Candidate 2

- Field/property: `timePeriodCoveredEnd`
  - Declared property: `https://dataverse.org/schema/citation/timePeriodCoveredEnd`
  - Block/model: `citation`
  - Entity: `timePeriodCovered`
  - Entity class: `timePeriodCovered`
  - Value types: `Date`
  - Multiple: `false`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.conference_dates`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `flattenText` with `{"separator": " - "}`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 5. `zenodo.conference_place`

**Question:** Should the proposed source metadata populate Zenodo `metadata.conference_place`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `productionPlace`
  - Declared property: `https://dataverse.org/schema/citation/productionPlace`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `Text`
  - Multiple: `true`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.conference_place`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 6. `zenodo.conference_title`

**Question:** Should the proposed source metadata populate Zenodo `metadata.conference_title`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `publicationCitation`
  - Declared property: `http://purl.org/dc/terms/bibliographicCitation`
  - Block/model: `citation`
  - Entity: `publication`
  - Entity class: `publication`
  - Value types: `TextArea`
  - Multiple: `false`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.conference_title`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 7. `zenodo.conference_url`

**Question:** Should the proposed source metadata populate Zenodo `metadata.conference_url`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `publicationURL`
  - Declared property: `https://schema.org/distribution`
  - Block/model: `citation`
  - Entity: `publication`
  - Entity class: `publication`
  - Value types: `URL`
  - Multiple: `false`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.conference_url`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `validateUrl` with `{"schemes": ["http", "https"], "onInvalid": "reportForReview"}`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 8. `zenodo.doi`

**Question:** Should the proposed source metadata populate Zenodo `metadata.doi`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `otherId`
  - Declared property: `https://dataverse.org/schema/citation/otherId`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `otherId`
  - Multiple: `true`
#### Candidate 2

- Field/property: `identifier`
  - Declared property: `https://schema.org/identifier`
  - Block/model: `canonical`
  - Entity: `root`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.doi`
- Type: `not specified`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `resolveReferences`
- `filterByValue` with `{"property": "otherIdAgency", "equals": "doi", "caseInsensitive": true}`
- `first`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 9. `zenodo.embargo_date`

**Question:** Should the proposed source metadata populate Zenodo `metadata.embargo_date`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `distributionDate`
  - Declared property: `https://dataverse.org/schema/citation/distributionDate`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `Date`
  - Multiple: `false`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.embargo_date`
- Type: `string`
- Required: `false`
- Conditionally required: `{"when": {"field": "access_right", "equals": "embargoed"}}`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `normalizeDate` with `{"onInvalid": "reportForReview"}`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "errorWhenConditionMatches", "condition": {"field": "access_right", "equals": "embargoed"}}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 10. `zenodo.image_type`

**Question:** Should the proposed source metadata populate Zenodo `metadata.image_type`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `additionalType`
  - Declared property: `https://schema.org/additionalType`
  - Block/model: `canonical`
  - Entity: `root`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.image_type`
- Type: `string`
- Required: `false`
- Conditionally required: `{"when": {"field": "upload_type", "equals": "image"}}`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `inferResourceType` with `{"vocabularyPath": "/repositories/zenodo/schema/properties/image_type/enum", "onUnknown": "reportForReview"}`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "errorWhenConditionMatches", "condition": {"field": "upload_type", "equals": "image"}}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 11. `zenodo.imprint_isbn`

**Question:** Should the proposed source metadata populate Zenodo `metadata.imprint_isbn`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `otherId`
  - Declared property: `https://dataverse.org/schema/citation/otherId`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `otherId`
  - Multiple: `true`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.imprint_isbn`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `resolveReferences`
- `filterByValue` with `{"property": "otherIdAgency", "equals": "isbn", "caseInsensitive": true}`
- `first`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 12. `zenodo.imprint_place`

**Question:** Should the proposed source metadata populate Zenodo `metadata.imprint_place`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `productionPlace`
  - Declared property: `https://dataverse.org/schema/citation/productionPlace`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `Text`
  - Multiple: `true`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.imprint_place`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 13. `zenodo.imprint_publisher`

**Question:** Should the proposed source metadata populate Zenodo `metadata.imprint_publisher`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `producer`
  - Declared property: `https://dataverse.org/schema/citation/producer`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `producer`
  - Multiple: `true`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.imprint_publisher`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `resolveReferences`
- `firstNonEmpty`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 14. `zenodo.journal_title`

**Question:** Should the proposed source metadata populate Zenodo `metadata.journal_title`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `publicationCitation`
  - Declared property: `http://purl.org/dc/terms/bibliographicCitation`
  - Block/model: `citation`
  - Entity: `publication`
  - Entity class: `publication`
  - Value types: `TextArea`
  - Multiple: `false`
#### Candidate 2

- Field/property: `journalTitle`
  - Declared property: `https://schema.org/isPartOf`
  - Block/model: `canonical`
  - Entity: `publication`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.journal_title`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 15. `zenodo.partof_title`

**Question:** Should the proposed source metadata populate Zenodo `metadata.partof_title`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `seriesName`
  - Declared property: `https://dataverse.org/schema/citation/seriesName`
  - Block/model: `citation`
  - Entity: `series`
  - Entity class: `series`
  - Value types: `Text`
  - Multiple: `false`
#### Candidate 2

- Field/property: `isPartOf`
  - Declared property: `https://schema.org/isPartOf`
  - Block/model: `canonical`
  - Entity: `root`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.partof_title`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 16. `zenodo.publication_type`

**Question:** Should the proposed source metadata populate Zenodo `metadata.publication_type`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `publicationType`
  - Declared property: `https://schema.org/additionalType`
  - Block/model: `canonical`
  - Entity: `root`
#### Candidate 2

- Field/property: `publicationRelationType`
  - Declared property: `http://datacite.org/schema/kernel-4/simpleTypes#relationType`
  - Block/model: `citation`
  - Entity: `publication`
  - Entity class: `publication`
  - Value types: `Select`
  - Multiple: `false`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.publication_type`
- Type: `string`
- Required: `false`
- Conditionally required: `{"when": {"field": "upload_type", "equals": "publication"}}`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `inferResourceType` with `{"vocabularyPath": "/repositories/zenodo/schema/properties/publication_type/enum", "onUnknown": "reportForReview"}`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "errorWhenConditionMatches", "condition": {"field": "upload_type", "equals": "publication"}}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 17. `zenodo.subjects`

**Question:** Should the proposed source metadata populate Zenodo `metadata.subjects`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `topicClassification`
  - Declared property: `https://dataverse.org/schema/citation/topicClassification`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `topicClassification`
  - Multiple: `true`
#### Candidate 2

- Field/property: `keyword`
  - Declared property: `https://dataverse.org/schema/citation/keyword`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `keyword`
  - Multiple: `true`
#### Candidate 3

- Field/property: `subject`
  - Declared property: `http://purl.org/dc/terms/subject`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `Select`
  - Multiple: `true`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.subjects`
- Type: `array`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `resolveReferences`
- `mapEntities` with `{"fields": {"term": ["topicClassValue", "keywordValue", "name"], "identifier": ["keywordTermURI", "identifier"], "scheme": ["keywordVocabulary", "topicClassVocab"]}, "omitEmptyProperties": true}`
- `asArray`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 18. `zenodo.thesis_supervisors`

**Question:** Should the proposed source metadata populate Zenodo `metadata.thesis_supervisors`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `contributor`
  - Declared property: `http://purl.org/dc/terms/contributor`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `contributor`
  - Multiple: `true`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.thesis_supervisors`
- Type: `array`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `resolveReferences`
- `filterByValue` with `{"property": "contributorType", "equals": "Supervisor", "caseInsensitive": true}`
- `mapEntities` with `{"fields": {"name": ["contributorName", "name"], "affiliation": ["affiliation"], "orcid": ["identifier"]}, "omitEmptyProperties": true}`
- `asArray`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 19. `zenodo.thesis_university`

**Question:** Should the proposed source metadata populate Zenodo `metadata.thesis_university`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `producer`
  - Declared property: `https://dataverse.org/schema/citation/producer`
  - Block/model: `citation`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `producer`
  - Multiple: `true`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.thesis_university`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `resolveReferences`
- `firstNonEmpty`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 20. `zenodo.version`

**Question:** Should the proposed source metadata populate Zenodo `metadata.version`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `softwareVersion`
  - Declared property: `https://dataverse.org/schema/citation/softwareVersion`
  - Block/model: `citation`
  - Entity: `software`
  - Entity class: `software`
  - Value types: `Text`
  - Multiple: `false`
#### Candidate 2

- Field/property: `version`
  - Declared property: `https://schema.org/version`
  - Block/model: `canonical`
  - Entity: `root`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.version`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 21. `zenodo.locations`

**Question:** Should the proposed source metadata populate Zenodo `metadata.locations`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `geographicCoverage`
  - Declared property: `https://dataverse.org/schema/geospatial/geographicCoverage`
  - Block/model: `geospatial`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `geographicCoverage`
  - Multiple: `true`
#### Candidate 2

- Field/property: `geographicBoundingBox`
  - Declared property: `https://dataverse.org/schema/geospatial/geographicBoundingBox`
  - Block/model: `geospatial`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `geographicBoundingBox`
  - Multiple: `true`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.locations`
- Type: `array`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `resolveReferences`
- `mapEntities` with `{"fields": {"place": ["city", "state", "country", "otherGeographicCoverage"], "lat": ["northLatitude", "southLatitude"], "lon": ["eastLongitude", "westLongitude"], "description": ["description"]}, "omitEmptyProperties": true}`
- `asArray`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 22. `zenodo.method`

**Question:** Should the proposed source metadata populate Zenodo `metadata.method`?

**Proposed source candidates, in selection order:**

#### Candidate 1

- Field/property: `measurementTechnique`
  - Declared property: `https://schema.org/measurementTechnique`
  - Block/model: `canonical`
  - Entity: `root`
#### Candidate 2

- Field/property: `samplingProcedure`
  - Declared property: `https://dataverse.org/schema/socialscience/samplingProcedure`
  - Block/model: `socialscience`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `TextArea`
  - Multiple: `false`
#### Candidate 3

- Field/property: `collectionMode`
  - Declared property: `https://dataverse.org/schema/socialscience/collectionMode`
  - Block/model: `socialscience`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `TextArea`
  - Multiple: `true`
#### Candidate 4

- Field/property: `researchInstrument`
  - Declared property: `https://dataverse.org/schema/socialscience/researchInstrument`
  - Block/model: `socialscience`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value types: `Text`
  - Multiple: `false`

**Target:**

- Repository: `zenodo`
- JSON path: `metadata.method`
- Type: `string`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `flattenText` with `{"separator": "\n\n"}`
- `first`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: possible; mapping requires review for the active profile

**Decision:** TODO

**Your notes:**

>

---

### 23. `dataverse.astrophysics.coverage.Spectral.Bandpass`

**Question:** Is ARP/RO-Crate `coverage.Spectral:Bandpass` the same field as
Dataverse `coverage.Spectral.Bandpass`, with the colon-to-dot difference being
only a naming difference?

**Proposed source candidate:**

- Field/property: `coverage.Spectral:Bandpass`
  - Declared property: `https://dataverse.org/schema/astrophysics/coverage.Spectral.Bandpass`
  - Block/model: `astrophysics`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value type: `Text`
  - Multiple: `true`

**Target:**

- Repository: `dataverse`
- Block: `astrophysics`
- Field: `coverage.Spectral.Bandpass`
- Type: `TEXT`
- Multiple: `true`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `trim`
- `asArray`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: none expected

**Decision:** TODO

**Your notes:**

>

---

### 24. `dataverse.astrophysics.coverage.Spectral.CentralWavelength`

**Question:** Is ARP/RO-Crate `coverage.Spectral:CentralWavelength` the same
field as Dataverse `coverage.Spectral.CentralWavelength`, with the colon-to-dot
difference being only a naming difference?

**Proposed source candidate:**

- Field/property: `coverage.Spectral:CentralWavelength`
  - Declared property: `https://dataverse.org/schema/astrophysics/coverage.Spectral.CentralWavelength`
  - Block/model: `astrophysics`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value type: `Number`
  - Multiple: `true`

**Target:**

- Repository: `dataverse`
- Block: `astrophysics`
- Field: `coverage.Spectral.CentralWavelength`
- Type: `FLOAT`
- Multiple: `true`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `omitValues` with `{"values": ["./", "."]}`
- `parseNumber` with `{"onInvalid": "reportForReview"}`
- `asArray`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: none expected

**Decision:** TODO

**Your notes:**

>

---

### 25. `dataverse.astrophysics.coverage.Spectral.Wavelength`

**Question:** Is the ARP/RO-Crate compound field
`coverage.Spectral:Wavelength` the same structure as Dataverse
`coverage.Spectral.Wavelength`, with the colon-to-dot differences being only
naming differences?

This decision also covers its children:

- `coverage.Spectral:MinimumWavelength` → `coverage.Spectral.MinimumWavelength`
- `coverage.Spectral:MaximumWavelength` → `coverage.Spectral.MaximumWavelength`

**Proposed source candidate:**

- Field/property: `coverage.Spectral:Wavelength`
  - Declared property: `https://dataverse.org/schema/astrophysics/coverage.Spectral.Wavelength`
  - Block/model: `astrophysics`
  - Entity: `root`
  - Entity class: `Dataset`
  - Value type: compound `coverage.Spectral:Wavelength`
  - Multiple: `true`

**Target:**

- Repository: `dataverse`
- Block: `astrophysics`
- Field: `coverage.Spectral.Wavelength`
- Type: compound
- Multiple: `true`
- Required: `false`

**Proposed transformations:**

- `omitEmpty`
- `resolveReferences`
- `buildCompound` from minimum and maximum wavelength
- `parseNumber` for both child values
- `asArray`

- Proposed direction: `both`
- Missing-value behavior: `{"action": "omit"}`
- Lossiness note: none expected

**Decision:** TODO

**Your notes:**

>

---
