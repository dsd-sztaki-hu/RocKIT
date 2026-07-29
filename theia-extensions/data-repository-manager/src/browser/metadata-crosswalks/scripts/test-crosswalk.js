#!/usr/bin/env node

/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
const crosswalk = JSON.parse(fs.readFileSync(
    path.join(root, 'ro-crate-repository-crosswalk.json'),
    'utf8'
));
const transform = YAML.parse(fs.readFileSync(
    path.join(root, 'linkml', 'canonical-to-zenodo.transform.yaml'),
    'utf8'
));

const zenodoProperties = Object.keys(crosswalk.repositories.zenodo.schema.properties);
const zenodoMappings = crosswalk.crosswalks.canonicalToZenodo.mappings;
const dataverseFields = Object.entries(crosswalk.repositories.dataverse.blocks).flatMap(
    ([blockName, block]) => Object.keys(block.schema.fields).map(
        fieldName => `${blockName}.${fieldName}`
    )
);
const dataverseTargets = crosswalk.crosswalks.canonicalToDataverse.mappings.map(
    mapping => `${mapping.target.block}.${mapping.target.field}`
);
const transformSlots =
    transform.class_derivations.ZenodoMetadata.slot_derivations;

assert.strictEqual(
    zenodoMappings.length,
    zenodoProperties.length,
    'Every Zenodo schema field must have one decision.'
);
assert.deepStrictEqual(
    [...zenodoMappings.map(mapping => mapping.target.field)].sort(),
    [...zenodoProperties].sort(),
    'Zenodo mapping decisions must cover the schema exactly.'
);
assert.deepStrictEqual(
    Object.keys(transformSlots).sort(),
    [...zenodoProperties].sort(),
    'The LinkML transformation must cover the Zenodo schema exactly.'
);
assert.ok(
    zenodoMappings.every(mapping => mapping.mappingStatus),
    'Every Zenodo decision must state a mapping status.'
);
assert.ok(
    zenodoMappings.some(mapping => mapping.mappingStatus === 'repositorySpecific'),
    'Repository-specific/unmappable fields must remain explicit.'
);
assert.strictEqual(
    crosswalk.coverage.zenodoMappings,
    zenodoProperties.length,
    'Generated coverage must match the Zenodo schema.'
);
assert.deepStrictEqual(
    [...dataverseTargets].sort(),
    [...dataverseFields].sort(),
    'Dataverse top-level mapping decisions must cover every schema field exactly.'
);

console.log(
    `Crosswalk tests passed: ${dataverseFields.length} Dataverse and `
    + `${zenodoProperties.length} Zenodo fields are explicitly covered.`
);
