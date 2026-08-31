#!/usr/bin/env node

/* eslint-disable no-console */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const root = path.resolve(__dirname, '..');
const sourcesDirectory = path.join(root, 'sources');
const linkmlDirectory = path.join(root, 'linkml');
const crosswalksDirectory = path.resolve(root, '..', 'crosswalks');
const splitOutputPaths = {
    dataverse: path.join(crosswalksDirectory, 'arp-dataverse-crosswalk.json'),
    zenodo: path.join(crosswalksDirectory, 'arp-zenodo-crosswalk.json')
};

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

function buildSplitCrosswalks(crosswalk) {
    const common = {
        crosswalkFormat: crosswalk.crosswalkFormat,
        canonicalModel: crosswalk.canonicalModel,
        provenance: crosswalk.provenance,
        documentModel: crosswalk.documentModel,
        transformationLibrary: crosswalk.transformationLibrary,
        validationAndReporting: crosswalk.validationAndReporting
    };
    return {
        dataverse: {
            id: 'arp-dataverse',
            name: 'ARP - DV',
            displayName: 'ARP / RO-Crate to Dataverse',
            ...common,
            repositories: {
                arp: crosswalk.repositories.arp,
                dataverse: crosswalk.repositories.dataverse
            },
            crosswalks: {
                arpRoCrateToCanonical: crosswalk.crosswalks.arpRoCrateToCanonical,
                canonicalToDataverse: crosswalk.crosswalks.canonicalToDataverse
            },
            coverage: {
                arpBlocks: crosswalk.coverage.arpBlocks,
                arpCanonicalMappings: crosswalk.coverage.arpCanonicalMappings,
                dataverseBlocks: crosswalk.coverage.dataverseBlocks,
                dataverseTopLevelMappings: crosswalk.coverage.dataverseTopLevelMappings,
                dataverseCompoundChildMappings: crosswalk.coverage.dataverseCompoundChildMappings,
                dataverseMappedTopLevel: crosswalk.coverage.dataverseMappedTopLevel,
                dataverseUnmappedTopLevel: crosswalk.coverage.dataverseUnmappedTopLevel,
                dataverseUnmappedCompoundChildren: crosswalk.coverage.dataverseUnmappedCompoundChildren,
                dataverseNeedsReviewTopLevel: crosswalk.coverage.dataverseNeedsReviewTopLevel
            }
        },
        zenodo: {
            id: 'arp-zenodo',
            name: 'ARP - Zenodo',
            displayName: 'ARP / RO-Crate to Zenodo',
            ...common,
            repositories: {
                arp: crosswalk.repositories.arp,
                zenodo: crosswalk.repositories.zenodo
            },
            crosswalks: {
                arpRoCrateToCanonical: crosswalk.crosswalks.arpRoCrateToCanonical,
                canonicalToZenodo: crosswalk.crosswalks.canonicalToZenodo
            },
            coverage: {
                arpBlocks: crosswalk.coverage.arpBlocks,
                arpCanonicalMappings: crosswalk.coverage.arpCanonicalMappings,
                zenodoFields: crosswalk.coverage.zenodoFields,
                zenodoMappings: crosswalk.coverage.zenodoMappings,
                arpSourceOnlyUnmapped: crosswalk.coverage.arpSourceOnlyUnmapped,
                zenodoSourceLessFields: crosswalk.coverage.zenodoSourceLessFields,
                zenodoMappingsWithoutOpenQuestions: crosswalk.coverage.zenodoMappingsWithoutOpenQuestions,
                zenodoNeedsReview: crosswalk.coverage.zenodoNeedsReview,
                zenodoRepositorySpecific: crosswalk.coverage.zenodoRepositorySpecific
            }
        }
    };
}

function main() {
    const checkRequested = process.argv.includes('--check');

    const crosswalk = buildCrosswalk();
    const splitCrosswalks = buildSplitCrosswalks(crosswalk);
    const renderedOutputs = Object.entries(splitOutputPaths).map(([key, filePath]) => ({
        key,
        filePath,
        rendered: `${JSON.stringify(splitCrosswalks[key], null, 2)}\n`
    }));
    if (checkRequested) {
        for (const output of renderedOutputs) {
            const current = fs.readFileSync(output.filePath, 'utf8');
            if (current !== output.rendered) {
                throw new Error(
                    `Generated ${output.key} crosswalk is stale (current ${sha256(current)}, `
                    + `generated ${sha256(output.rendered)}). Run generate-crosswalk.js.`
                );
            }
        }
        console.log(
            `Crosswalks are current: ${crosswalk.coverage.dataverseTopLevelMappings} `
            + `Dataverse and ${crosswalk.coverage.zenodoMappings} Zenodo fields.`
        );
        return;
    }
    fs.mkdirSync(crosswalksDirectory, { recursive: true });
    for (const output of renderedOutputs) {
        fs.writeFileSync(output.filePath, output.rendered);
    }
    console.log(
        `Generated split crosswalks in ${crosswalksDirectory} with ${crosswalk.coverage.arpCanonicalMappings} ARP, `
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
