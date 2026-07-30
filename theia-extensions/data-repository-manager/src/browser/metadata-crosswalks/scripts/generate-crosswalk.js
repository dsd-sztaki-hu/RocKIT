#!/usr/bin/env node

/* eslint-disable no-console */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
const sourcesDirectory = path.join(root, 'sources');
const linkmlDirectory = path.join(root, 'linkml');
const outputPath = path.join(root, 'ro-crate-repository-crosswalk.json');

const sourcePaths = {
    base: path.join(sourcesDirectory, 'crosswalk-base.json'),
    arp: path.join(sourcesDirectory, 'arp-schema.json'),
    dataverse: path.join(sourcesDirectory, 'dataverse-schema.json'),
    zenodo: path.join(sourcesDirectory, 'zenodo-schema.json'),
    arpMappings: path.join(sourcesDirectory, 'arp-to-canonical.json'),
    dataverseMappings: path.join(sourcesDirectory, 'canonical-to-dataverse.json'),
    zenodoDecisions: path.join(sourcesDirectory, 'zenodo-mapping-decisions.json')
};

const linkmlPaths = {
    sourceSchema: path.join(linkmlDirectory, 'canonical-metadata.schema.yaml'),
    targetSchema: path.join(linkmlDirectory, 'zenodo-metadata.schema.yaml'),
    transform: path.join(linkmlDirectory, 'canonical-to-zenodo.transform.yaml')
};

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function objectProperties(object) {
    return Object.keys(object || {});
}

function countDataverseCompoundChildren(dataverse) {
    let count = 0;
    for (const block of Object.values(dataverse.blocks || {})) {
        const fields = block.schema && block.schema.fields || {};
        for (const field of Object.values(fields)) {
            count += objectProperties(field.childFields).length;
        }
    }
    return count;
}

function mappingStatusCount(mappings, status) {
    return mappings.filter(mapping => mapping.mappingStatus === status).length;
}

function calculateCoverage(crosswalk) {
    const arp = crosswalk.repositories.arp;
    const dataverse = crosswalk.repositories.dataverse;
    const zenodo = crosswalk.repositories.zenodo;
    const arpCrosswalk = crosswalk.crosswalks.arpRoCrateToCanonical;
    const dataverseMappings = crosswalk.crosswalks.canonicalToDataverse.mappings;
    const zenodoMappings = crosswalk.crosswalks.canonicalToZenodo.mappings;

    return {
        arpBlocks: objectProperties(arp.blocks).length,
        arpCanonicalMappings: arpCrosswalk.mappings.length,
        dataverseBlocks: objectProperties(dataverse.blocks).length,
        dataverseTopLevelMappings: dataverseMappings.length,
        dataverseCompoundChildMappings: countDataverseCompoundChildren(dataverse),
        dataverseMappedTopLevel:
            mappingStatusCount(dataverseMappings, 'exactNameAndProfileMatch'),
        dataverseUnmappedTopLevel: dataverseMappings.filter(mapping =>
            ['targetOnlyUnmapped', 'repositorySpecific'].includes(mapping.mappingStatus)
        ).length,
        zenodoFields: objectProperties(zenodo.schema && zenodo.schema.properties).length,
        zenodoMappings: zenodoMappings.length,
        arpSourceOnlyUnmapped: (arpCrosswalk.unmappedSourceFields || []).length,
        dataverseUnmappedCompoundChildren:
            crosswalk.coverage && crosswalk.coverage.dataverseUnmappedCompoundChildren || 0,
        zenodoSourceLessFields: zenodoMappings.filter(mapping =>
            !mapping.source
            || !mapping.source.canonicalCandidates
            || mapping.source.canonicalCandidates.length === 0
        ).length,
        zenodoMappingsWithoutOpenQuestions: zenodoMappings.filter(mapping =>
            mapping.mappingStatus === 'mapped'
        ).length,
        zenodoNeedsReview: mappingStatusCount(zenodoMappings, 'needsReview'),
        zenodoRepositorySpecific: mappingStatusCount(zenodoMappings, 'repositorySpecific'),
        dataverseNeedsReviewTopLevel: mappingStatusCount(dataverseMappings, 'needsReview')
    };
}

function validateUniqueIds(label, mappings, errors) {
    const seen = new Set();
    for (const mapping of mappings) {
        if (!mapping.id) {
            errors.push(`${label} contains a mapping without an id.`);
        } else if (seen.has(mapping.id)) {
            errors.push(`${label} contains duplicate id ${mapping.id}.`);
        }
        seen.add(mapping.id);
    }
}

function validateCrosswalk(crosswalk, transform) {
    const errors = [];
    const dataverseMappings = crosswalk.crosswalks.canonicalToDataverse.mappings;
    const dataverseFields = [];
    for (const [blockName, block] of Object.entries(crosswalk.repositories.dataverse.blocks || {})) {
        const fields = block.schema && block.schema.fields || {};
        for (const fieldName of objectProperties(fields)) {
            dataverseFields.push(`${blockName}.${fieldName}`);
        }
    }
    const zenodoProperties = objectProperties(
        crosswalk.repositories.zenodo.schema
        && crosswalk.repositories.zenodo.schema.properties
    );
    const zenodoMappings = crosswalk.crosswalks.canonicalToZenodo.mappings;
    const mappedFields = zenodoMappings.map(mapping => mapping.target && mapping.target.field);
    const slotDerivations =
        transform.class_derivations
        && transform.class_derivations.ZenodoMetadata
        && transform.class_derivations.ZenodoMetadata.slot_derivations || {};

    validateUniqueIds(
        'ARP-to-canonical crosswalk',
        crosswalk.crosswalks.arpRoCrateToCanonical.mappings,
        errors
    );
    validateUniqueIds(
        'canonical-to-Dataverse crosswalk',
        dataverseMappings,
        errors
    );
    validateUniqueIds('canonical-to-Zenodo crosswalk', zenodoMappings, errors);

    const dataverseTargets = dataverseMappings.map(mapping =>
        `${mapping.target && mapping.target.block}.${mapping.target && mapping.target.field}`
    );
    for (const field of dataverseFields) {
        const count = dataverseTargets.filter(target => target === field).length;
        if (count !== 1) {
            errors.push(`Dataverse field ${field} has ${count} mapping decisions; expected exactly one.`);
        }
    }
    for (const target of dataverseTargets) {
        if (!dataverseFields.includes(target)) {
            errors.push(`Mapping targets unknown Dataverse field ${target}.`);
        }
    }

    for (const field of zenodoProperties) {
        const count = mappedFields.filter(mappedField => mappedField === field).length;
        if (count !== 1) {
            errors.push(`Zenodo field ${field} has ${count} mapping decisions; expected exactly one.`);
        }
        if (!slotDerivations[field]) {
            errors.push(`Zenodo field ${field} is absent from the LinkML transformation.`);
        }
    }

    for (const field of mappedFields) {
        if (!zenodoProperties.includes(field)) {
            errors.push(`Mapping targets unknown Zenodo field ${field}.`);
        }
    }

    for (const mapping of zenodoMappings) {
        if (!mapping.mappingStatus) {
            errors.push(`${mapping.id} has no explicit mappingStatus.`);
        }
        if (
            (!mapping.source || !mapping.source.canonicalCandidates
                || mapping.source.canonicalCandidates.length === 0)
            && !mapping.unmappedReason
            && mapping.mappingStatus !== 'repositorySpecific'
        ) {
            errors.push(`${mapping.id} has no source candidates or unmapped reason.`);
        }
        const slot = slotDerivations[mapping.target.field];
        const expectedSource = mapping.source
            && mapping.source.canonicalCandidates
            && mapping.source.canonicalCandidates[0]
            && mapping.source.canonicalCandidates[0].localName;
        if (
            slot
            && expectedSource
            && slot.value === undefined
            && slot.populated_from !== expectedSource
        ) {
            errors.push(
                `${mapping.id} LinkML source is ${slot.populated_from}; expected ${expectedSource}.`
            );
        }
    }

    const transformFields = objectProperties(slotDerivations);
    for (const field of transformFields) {
        if (!zenodoProperties.includes(field)) {
            errors.push(`LinkML transformation targets unknown Zenodo field ${field}.`);
        }
    }

    if (errors.length) {
        throw new Error(`Crosswalk validation failed:\n- ${errors.join('\n- ')}`);
    }
}

function buildCrosswalk() {
    const base = readJson(sourcePaths.base);
    const arp = readJson(sourcePaths.arp);
    const dataverse = readJson(sourcePaths.dataverse);
    const zenodo = readJson(sourcePaths.zenodo);
    const arpMappings = readJson(sourcePaths.arpMappings);
    const dataverseMappings = readJson(sourcePaths.dataverseMappings);
    const zenodoDecisions = readJson(sourcePaths.zenodoDecisions);
    const transform = YAML.parse(fs.readFileSync(linkmlPaths.transform, 'utf8'));

    const crosswalk = {
        crosswalkFormat: base.crosswalkFormat,
        canonicalModel: base.canonicalModel,
        provenance: base.provenance,
        documentModel: base.documentModel,
        transformationLibrary: base.transformationLibrary,
        repositories: { arp, dataverse, zenodo },
        crosswalks: {
            arpRoCrateToCanonical: arpMappings,
            canonicalToDataverse: dataverseMappings,
            canonicalToZenodo: zenodoDecisions
        },
        validationAndReporting: base.validationAndReporting,
        coverage: base.coverage
    };
    crosswalk.coverage = calculateCoverage(crosswalk);
    validateCrosswalk(crosswalk, transform);
    return crosswalk;
}

function bootstrap() {
    if (!fs.existsSync(outputPath)) {
        throw new Error(`Cannot bootstrap: ${outputPath} does not exist.`);
    }
    fs.mkdirSync(sourcesDirectory, { recursive: true });
    fs.mkdirSync(linkmlDirectory, { recursive: true });

    const current = readJson(outputPath);
    const { repositories, crosswalks, coverage, ...base } = current;
    writeJson(sourcePaths.base, { ...base, coverage });
    writeJson(sourcePaths.arp, repositories.arp);
    writeJson(sourcePaths.dataverse, repositories.dataverse);
    writeJson(sourcePaths.zenodo, repositories.zenodo);
    writeJson(sourcePaths.arpMappings, crosswalks.arpRoCrateToCanonical);
    writeJson(sourcePaths.dataverseMappings, crosswalks.canonicalToDataverse);
    writeJson(sourcePaths.zenodoDecisions, crosswalks.canonicalToZenodo);

    const zenodoMappings = crosswalks.canonicalToZenodo.mappings;
    const canonicalSlots = {};
    const zenodoSlots = {};
    const slotDerivations = {};

    for (const mapping of zenodoMappings) {
        const candidates = mapping.source && mapping.source.canonicalCandidates || [];
        for (const candidate of candidates) {
            if (candidate.localName) {
                canonicalSlots[candidate.localName] = {
                    description: candidate.property || `Canonical source for ${candidate.localName}`
                };
            }
        }
        const field = mapping.target.field;
        const schemaProperty = repositories.zenodo.schema.properties[field] || {};
        zenodoSlots[field] = {
            description: schemaProperty.description || `Zenodo ${field} metadata field`,
            required: Boolean(mapping.target.required),
            multivalued: schemaProperty.type === 'array'
        };
        const firstCandidate = candidates.find(candidate => candidate.localName);
        slotDerivations[field] = firstCandidate
            ? {
                populated_from: firstCandidate.localName,
                description: `${mapping.mappingStatus}: ${mapping.id}`
            }
            : {
                expr: 'None',
                description:
                    `${mapping.mappingStatus}: ${mapping.unmappedReason || 'no canonical source'}`
            };
    }

    const commonSchema = {
        prefixes: {
            linkml: 'https://w3id.org/linkml/',
            schema: 'https://schema.org/'
        },
        imports: ['linkml:types'],
        default_range: 'string'
    };
    fs.writeFileSync(linkmlPaths.sourceSchema, YAML.stringify({
        id: 'https://w3id.org/arp/linkml/canonical-metadata',
        name: 'canonical-metadata',
        ...commonSchema,
        classes: {
            CanonicalMetadata: {
                description: 'Flattened semantic view of ARP/Dataverse RO-Crate metadata.',
                attributes: canonicalSlots
            }
        }
    }, { lineWidth: 0 }));
    fs.writeFileSync(linkmlPaths.targetSchema, YAML.stringify({
        id: 'https://w3id.org/arp/linkml/zenodo-metadata',
        name: 'zenodo-metadata',
        ...commonSchema,
        classes: {
            ZenodoMetadata: {
                description: 'Zenodo deposition metadata represented by this crosswalk.',
                attributes: zenodoSlots
            }
        }
    }, { lineWidth: 0 }));
    fs.writeFileSync(linkmlPaths.transform, YAML.stringify({
        id: 'https://w3id.org/arp/linkml/canonical-to-zenodo',
        title: 'Canonical ARP/Dataverse RO-Crate to Zenodo metadata',
        class_derivations: {
            ZenodoMetadata: {
                populated_from: 'CanonicalMetadata',
                slot_derivations: slotDerivations
            }
        }
    }, { lineWidth: 0 }));

    console.log('Bootstrapped crosswalk sources and LinkML artifacts.');
}

function main() {
    const bootstrapRequested = process.argv.includes('--bootstrap');
    const checkRequested = process.argv.includes('--check');
    if (bootstrapRequested) {
        bootstrap();
    }

    const crosswalk = buildCrosswalk();
    const rendered = `${JSON.stringify(crosswalk, null, 2)}\n`;
    if (checkRequested) {
        const current = fs.readFileSync(outputPath, 'utf8');
        if (current !== rendered) {
            throw new Error(
                `Generated crosswalk is stale (current ${sha256(current)}, `
                + `generated ${sha256(rendered)}). Run generate-crosswalk.js.`
            );
        }
        console.log(`Crosswalk is current: ${crosswalk.coverage.zenodoMappings} Zenodo fields.`);
        return;
    }
    fs.writeFileSync(outputPath, rendered);
    console.log(
        `Generated ${outputPath} with ${crosswalk.coverage.arpCanonicalMappings} ARP, `
        + `${crosswalk.coverage.dataverseTopLevelMappings} Dataverse, and `
        + `${crosswalk.coverage.zenodoMappings} Zenodo mappings.`
    );
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
