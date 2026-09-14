// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { injectable } from 'inversify';
import crosswalk = require('../crosswalks/arp-dataverse-crosswalk.json');

type RoCrateEntity = Record<string, unknown>;
type RoCrate = Record<string, unknown>;
type DataverseValue = string | number;

export interface DataverseMetadataFieldDto {
    typeName: string;
    typeClass: 'primitive' | 'compound' | 'controlledVocabulary';
    multiple: boolean;
    value: unknown;
}

export interface DataverseMetadataBlockDto {
    displayName: string;
    fields: DataverseMetadataFieldDto[];
}

export interface DataverseReverseCrosswalkResult {
    crate: RoCrate;
    updatedFields: string[];
}

interface DataverseFieldSchema {
    name?: string;
    displayName?: string;
    type?: string;
    typeClass?: string;
    multiple?: boolean;
    isControlledVocabulary?: boolean;
    controlledVocabularyValues?: string[];
    childFields?: Record<string, DataverseFieldSchema>;
    displayOrder?: number;
}

interface DataverseMetadataBlockSchema {
    name?: string;
    displayName?: string;
    fields?: Record<string, DataverseFieldSchema>;
}

interface DataverseCrosswalkChild {
    sourceCandidates?: Array<{ localName?: string }>;
    target: { field: string };
    mappingStatus: string;
}

interface DataverseCrosswalkMapping {
    source?: { canonicalCandidates?: Array<{ localName?: string }> };
    target: { block: string; field: string; required?: boolean };
    mappingStatus: string;
    children?: DataverseCrosswalkChild[];
}

interface DataverseCrosswalk {
    repositories: {
        dataverse: {
            blocks: Record<string, {
                schema: DataverseMetadataBlockSchema
            }>
        }
    };
    crosswalks: {
        canonicalToDataverse: {
            mappings: DataverseCrosswalkMapping[]
        }
    };
}

const repositoryCrosswalk = crosswalk as DataverseCrosswalk;

@injectable()
export class DataverseMetadataMappingService {
    protected readonly ignoredFields = new Set([
        'citation.title_hu',
        'citation.dsDescription_hu',
        'citation.dsDescription_hu.dsDescriptionValue_hu',
        'citation.dsDescription_hu.dsDescriptionDate_hu'
    ]);

    public async buildMetadataBlocks(
        crate: RoCrate,
        enabledMetadataBlocks?: Set<string>
    ): Promise<Record<string, DataverseMetadataBlockDto>> {
        const schemas = this.readCrosswalkBlockSchemas();
        const mappings = repositoryCrosswalk.crosswalks.canonicalToDataverse.mappings
            .filter(mapping => this.isExecutableMapping(mapping.mappingStatus));
        const graph = this.readGraph(crate);
        const root = graph.find(entity => entity['@id'] === './');
        if (!root) {
            return {};
        }

        const blocks: Record<string, DataverseMetadataBlockDto> = {};
        for (const schema of schemas) {
            const blockName = schema.name;
            if (!blockName || !schema.fields || (enabledMetadataBlocks && !enabledMetadataBlocks.has(blockName))) {
                continue;
            }
            const fields = this.buildBlockFields(
                blockName,
                root,
                graph,
                schema,
                mappings.filter(mapping => mapping.target.block === blockName)
            );
            if (fields.length) {
                blocks[blockName] = {
                    displayName: schema.displayName ?? blockName,
                    fields
                };
            }
        }
        return blocks;
    }

    public requiredFields(blockName: string): Set<string> {
        return new Set(
            repositoryCrosswalk.crosswalks.canonicalToDataverse.mappings
                .filter(mapping =>
                    mapping.target.block === blockName &&
                    this.isExecutableMapping(mapping.mappingStatus) &&
                    (mapping.target as { required?: boolean }).required === true
                )
                .map(mapping => mapping.target.field)
        );
    }

    public controlledVocabularyValues(blockName: string, fieldName: string): string[] {
        const values = this.fieldSchema(blockName, fieldName)?.controlledVocabularyValues;
        return Array.isArray(values) ? values : [];
    }

    public fieldDisplayName(blockName: string, fieldName: string): string {
        return this.fieldSchema(blockName, fieldName)?.displayName ?? fieldName;
    }

    /**
     * Applies Dataverse dataset-version metadata back to an RO-Crate by walking
     * the same executable mappings used for export in the opposite direction.
     *
     * The Dataverse API envelope and file placement stay outside this mapper;
     * this method only updates fields whose source and target relationship is
     * declared by the crosswalk. Primitive fields overwrite root Dataset
     * properties, while compound fields create or update referenced RO-Crate
     * entities such as authors and dataset descriptions.
     */
    public applyMetadataBlocksToRoCrate(
        crate: RoCrate,
        datasetVersionData: Record<string, unknown>
    ): DataverseReverseCrosswalkResult {
        const nextCrate = JSON.parse(JSON.stringify(crate)) as RoCrate;
        const graph = this.readMutableGraph(nextCrate);
        const root = graph.find(entity => entity['@id'] === './');
        if (!root) {
            throw new Error('The RO-Crate does not contain a root Dataset with @id "./".');
        }

        const updatedFields: string[] = [];
        const schemasByName = new Map(
            this.readCrosswalkBlockSchemas()
                .filter(schema => !!schema.name)
                .map(schema => [schema.name as string, schema])
        );
        const mappings = repositoryCrosswalk.crosswalks.canonicalToDataverse.mappings
            .filter(mapping => this.isExecutableMapping(mapping.mappingStatus));

        for (const mapping of mappings) {
            const block = this.readDataverseMetadataBlock(datasetVersionData, mapping.target.block);
            const schema = schemasByName.get(mapping.target.block);
            const fieldSchema = schema?.fields?.[mapping.target.field];
            const field = block
                ? this.findDataverseField(block.fields, mapping.target.field)
                : undefined;
            if (!field || !fieldSchema || this.ignoredFields.has(`${mapping.target.block}.${mapping.target.field}`)) {
                continue;
            }
            const updated = this.toDataverseTypeClass(fieldSchema) === 'compound'
                ? this.applyCompoundField(root, graph, field, fieldSchema, mapping)
                : this.applyRootField(root, field, fieldSchema, mapping);
            if (updated) {
                updatedFields.push(mapping.target.field);
            }
        }

        return { crate: nextCrate, updatedFields: this.uniqueStrings(updatedFields) };
    }

    protected fieldSchema(blockName: string, fieldName: string): DataverseFieldSchema | undefined {
        return repositoryCrosswalk.repositories.dataverse.blocks[blockName]?.schema.fields?.[fieldName];
    }

    protected applyRootField(
        root: RoCrateEntity,
        field: DataverseMetadataFieldDto,
        schema: DataverseFieldSchema,
        mapping: DataverseCrosswalkMapping
    ): boolean {
        const sourceName = mapping.source?.canonicalCandidates?.[0]?.localName ?? field.typeName;
        const value = this.reverseDataverseFieldValue(field, schema);
        if (!this.hasMeaningfulValue(value)) {
            return false;
        }
        root[sourceName] = value;
        return true;
    }

    protected applyCompoundField(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        field: DataverseMetadataFieldDto,
        schema: DataverseFieldSchema,
        mapping: DataverseCrosswalkMapping
    ): boolean {
        const typeName = schema.name ?? field.typeName;
        const childFields = schema.childFields;
        if (!typeName || !childFields) {
            return false;
        }
        const rows = this.dataverseCompoundRows(field.value);
        if (!rows.length) {
            return false;
        }

        const referencedIds = this.readReferenceIds(this.readCompoundRootValue(root, typeName));
        const existingEntities = graph.filter(entity => this.entityTypes(entity).includes(typeName));
        const childMappings = new Map(
            (mapping.children ?? [])
                .filter(child => this.isExecutableMapping(child.mappingStatus))
                .map(child => [child.target.field, child])
        );
        const refs: RoCrateEntity[] = [];

        rows.forEach((row, index) => {
            const id =
                referencedIds[index] ??
                this.readStrings(existingEntities[index]?.['@id'])[0] ??
                this.generatedEntityId(root, typeName, index);
            let entity = graph.find(candidate => candidate['@id'] === id);
            if (!entity) {
                entity = {
                    '@id': id,
                    '@type': typeName,
                    '@reverse': { [typeName]: { '@id': './' } }
                };
                graph.push(entity);
            }

            let primaryName: string | undefined;
            for (const [childName, childMapping] of childMappings) {
                const childSchema = childFields[childName];
                const childField = this.findDataverseField([row[childName]], childName);
                if (!childSchema || !childField || this.ignoredFields.has(`${mapping.target.block}.${typeName}.${childName}`)) {
                    continue;
                }
                const sourceName = childMapping.sourceCandidates?.[0]?.localName ?? childName;
                const value = this.reverseDataverseFieldValue(childField, childSchema);
                if (!this.hasMeaningfulValue(value)) {
                    continue;
                }
                entity[sourceName] = value;
                if (typeof value === 'string' && (
                    sourceName === 'name' ||
                    sourceName === `${typeName}Name` ||
                    sourceName === `${typeName}Value`
                )) {
                    primaryName = value;
                }
            }
            if (primaryName) {
                entity.name = primaryName;
            }
            refs.push({ '@id': id });
        });

        root[typeName] = refs.length === 1 ? refs[0] : refs;
        return refs.length > 0;
    }

    protected buildBlockFields(
        blockName: string,
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        schema: DataverseMetadataBlockSchema,
        mappings: DataverseCrosswalkMapping[]
    ): DataverseMetadataFieldDto[] {
        return mappings
            .map(mapping => ({
                mapping,
                field: schema.fields?.[mapping.target.field]
            }))
            .filter((entry): entry is { mapping: DataverseCrosswalkMapping; field: DataverseFieldSchema } => !!entry.field)
            .sort((a, b) => (a.field.displayOrder ?? 0) - (b.field.displayOrder ?? 0))
            .map(({ field, mapping }) => this.buildField(blockName, root, graph, field, mapping))
            .filter((field): field is DataverseMetadataFieldDto => !!field);
    }

    protected buildField(
        blockName: string,
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        schema: DataverseFieldSchema,
        mapping: DataverseCrosswalkMapping
    ): DataverseMetadataFieldDto | undefined {
        const typeName = schema.name;
        if (!typeName || this.ignoredFields.has(`${blockName}.${typeName}`)) {
            return undefined;
        }
        const typeClass = this.toDataverseTypeClass(schema);
        if (typeClass === 'compound') {
            const values = this.collectCompoundValues(blockName, root, graph, schema, mapping);
            if (!values.length) {
                return undefined;
            }
            return {
                typeName,
                typeClass,
                multiple: schema.multiple !== false,
                value: schema.multiple === false ? values[0] : values
            };
        }

        const sourceName = mapping.source?.canonicalCandidates?.[0]?.localName ?? typeName;
        const values = this.collectPrimitiveValues(root, graph, sourceName, schema);
        const value = this.buildPrimitiveValue(values, schema);
        if (value === undefined) {
            return undefined;
        }
        return {
            typeName,
            typeClass,
            multiple: schema.multiple === true,
            value
        };
    }

    protected collectCompoundValues(
        blockName: string,
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        schema: DataverseFieldSchema,
        mapping: DataverseCrosswalkMapping
    ): Array<Record<string, DataverseMetadataFieldDto>> {
        const typeName = schema.name;
        const childFields = schema.childFields;
        if (!typeName || !childFields) {
            return [];
        }

        const entities = this.collectCompoundEntities(root, graph, typeName);
        return entities
            .map(entity => {
                const value: Record<string, DataverseMetadataFieldDto> = {};
                const executableChildren = new Map(
                    (mapping.children ?? [])
                        .filter(child => this.isExecutableMapping(child.mappingStatus))
                        .map(child => [child.target.field, child])
                );
                for (const child of Object.values(childFields).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))) {
                    const childName = child.name;
                    const childMapping = childName ? executableChildren.get(childName) : undefined;
                    if (!childName || !childMapping || this.ignoredFields.has(`${blockName}.${typeName}.${childName}`)) {
                        continue;
                    }
                    const sourceName =
                        childMapping.sourceCandidates?.[0]?.localName ?? childName;
                    const childValues = this.collectEntityPrimitiveValues(entity, sourceName, child);
                    const childValue = this.buildPrimitiveValue(childValues, child);
                    if (childValue !== undefined) {
                        value[childName] = {
                            typeName: childName,
                            typeClass: this.toDataverseTypeClass(child),
                            multiple: child.multiple === true,
                            value: childValue
                        };
                    }
                }
                return value;
            })
            .filter(value => Object.keys(value).length > 0);
    }

    protected collectCompoundEntities(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        typeName: string
    ): RoCrateEntity[] {
        const references = this.resolveEntities(this.readCompoundRootValue(root, typeName), graph);
        const typeMatches = graph.filter(entity => this.entityTypes(entity).includes(typeName));
        const literalFallbacks = this.collectCompoundLiteralFallbacks(root, typeName);
        return this.uniqueEntitiesById([...references, ...typeMatches, ...literalFallbacks]);
    }

    protected collectPrimitiveValues(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        fieldName: string,
        schema: DataverseFieldSchema
    ): DataverseValue[] {
        const direct = this.collectEntityPrimitiveValues(root, fieldName, schema);
        const typeValues = graph
            .filter(entity => this.entityTypes(entity).includes(fieldName))
            .flatMap(entity => this.collectEntityPrimitiveValues(entity, fieldName, schema));
        return this.uniqueValues([...direct, ...typeValues]);
    }

    protected collectEntityPrimitiveValues(
        entity: RoCrateEntity,
        fieldName: string,
        schema: DataverseFieldSchema
    ): DataverseValue[] {
        const values = this.readScalarValues(this.readPrimitiveValue(entity, fieldName));
        return this.uniqueValues(
            values
                .map(value => this.normalizeValue(fieldName, value, schema))
                .filter((value): value is DataverseValue => value !== undefined)
        );
    }

    protected collectCompoundLiteralFallbacks(root: RoCrateEntity, typeName: string): RoCrateEntity[] {
        if (typeName === 'author') {
            return this.readStrings(root.author)
                .filter(value => !this.looksLikeEntityId(value))
                .map(authorName => ({ authorName }));
        }
        if (typeName === 'datasetContact') {
            return this.readStrings(root.datasetContactEmail)
                .map(datasetContactEmail => ({ datasetContactEmail }));
        }
        return [];
    }

    protected readCompoundRootValue(root: RoCrateEntity, typeName: string): unknown {
        if (typeName === 'datasetContact') {
            return root.datasetContact ?? root.contactPoint;
        }
        return root[typeName];
    }

    protected readPrimitiveValue(entity: RoCrateEntity, fieldName: string): unknown {
        if (fieldName === 'title') {
            return entity.title ?? entity.name;
        }
        if (fieldName === 'authorName') {
            return entity.authorName ?? entity.name;
        }
        if (fieldName === 'authorAffiliation') {
            return entity.authorAffiliation;
        }
        if (fieldName === 'authorIdentifierScheme') {
            return entity.authorIdentifierScheme;
        }
        if (fieldName === 'authorIdentifier') {
            return entity.authorIdentifier;
        }
        if (fieldName === 'datasetContactName') {
            return entity.datasetContactName ?? entity.name;
        }
        if (fieldName === 'datasetContactAffiliation') {
            return entity.datasetContactAffiliation;
        }
        if (fieldName === 'datasetContactEmail') {
            return entity.datasetContactEmail ?? entity.email;
        }
        if (fieldName === 'dsDescriptionValue') {
            return entity.dsDescriptionValue;
        }
        return entity[fieldName] ?? entity.value ?? entity.name;
    }

    protected buildPrimitiveValue(values: DataverseValue[], schema: DataverseFieldSchema): DataverseValue | DataverseValue[] | undefined {
        if (!values.length) {
            return undefined;
        }
        return schema.multiple === true ? values : values[0];
    }

    protected normalizeValue(fieldName: string, value: DataverseValue, schema: DataverseFieldSchema): DataverseValue | undefined {
        const trimmed = String(value).trim();
        if (!trimmed || trimmed === './') {
            return undefined;
        }
        const schemaType = schema.type?.toUpperCase();
        if (schemaType === 'DATE' || /date$/i.test(fieldName)) {
            const dateOnly = trimmed.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
            return dateOnly?.[0] ?? undefined;
        }
        if (schemaType === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            return undefined;
        }
        if (schemaType === 'URL') {
            try {
                const url = new URL(trimmed);
                return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : undefined;
            } catch {
                return undefined;
            }
        }
        if (schemaType === 'FLOAT' || schemaType === 'INT') {
            const numeric = Number(trimmed);
            return Number.isFinite(numeric) ? numeric : undefined;
        }
        if (this.toDataverseTypeClass(schema) === 'controlledVocabulary') {
            const vocabulary = new Set(schema.controlledVocabularyValues ?? []);
            return vocabulary.size === 0 || vocabulary.has(trimmed) ? trimmed : undefined;
        }
        return trimmed;
    }

    protected toDataverseTypeClass(schema: DataverseFieldSchema): DataverseMetadataFieldDto['typeClass'] {
        if (schema.typeClass === 'compound') {
            return 'compound';
        }
        if (schema.typeClass === 'controlledVocabulary' || schema.isControlledVocabulary === true) {
            return 'controlledVocabulary';
        }
        return 'primitive';
    }

    protected readCrosswalkBlockSchemas(): DataverseMetadataBlockSchema[] {
        return Object.values(repositoryCrosswalk.repositories.dataverse.blocks)
            .map(block => block.schema)
            .filter(schema => !!schema.name && !!schema.fields)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    protected readDataverseMetadataBlock(
        datasetVersionData: Record<string, unknown>,
        blockName: string
    ): DataverseMetadataBlockDto | undefined {
        const blocks = datasetVersionData.metadataBlocks;
        if (!blocks || typeof blocks !== 'object' || Array.isArray(blocks)) {
            return undefined;
        }
        const block = (blocks as Record<string, unknown>)[blockName];
        if (!block || typeof block !== 'object' || Array.isArray(block)) {
            return undefined;
        }
        const fields = (block as Record<string, unknown>).fields;
        if (!Array.isArray(fields)) {
            return undefined;
        }
        return {
            displayName: String((block as Record<string, unknown>).displayName ?? blockName),
            fields: fields.filter(this.isDataverseFieldDto)
        };
    }

    protected findDataverseField(
        fields: unknown[],
        typeName: string
    ): DataverseMetadataFieldDto | undefined {
        return fields
            .filter(this.isDataverseFieldDto)
            .find(field => field.typeName === typeName);
    }

    protected isDataverseFieldDto(value: unknown): value is DataverseMetadataFieldDto {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
        }
        const record = value as Record<string, unknown>;
        return typeof record.typeName === 'string' &&
            typeof record.typeClass === 'string' &&
            typeof record.multiple === 'boolean' &&
            'value' in record;
    }

    protected reverseDataverseFieldValue(
        field: DataverseMetadataFieldDto,
        schema: DataverseFieldSchema
    ): unknown {
        const values = this.readScalarValues(field.value)
            .map(value => this.normalizeValue(field.typeName, value, schema))
            .filter((value): value is DataverseValue => value !== undefined);
        if (!values.length) {
            return undefined;
        }
        return field.multiple || schema.multiple === true ? this.uniqueValues(values) : values[0];
    }

    protected dataverseCompoundRows(value: unknown): Array<Record<string, unknown>> {
        if (Array.isArray(value)) {
            return value.filter((item): item is Record<string, unknown> =>
                !!item && typeof item === 'object' && !Array.isArray(item)
            );
        }
        return value && typeof value === 'object' && !Array.isArray(value)
            ? [value as Record<string, unknown>]
            : [];
    }

    protected isExecutableMapping(status: string): boolean {
        return status === 'exactNameAndProfileMatch' || status === 'needsReview';
    }

    protected readGraph(crate: RoCrate): RoCrateEntity[] {
        const graph = crate['@graph'];
        return Array.isArray(graph)
            ? graph.filter((entity): entity is RoCrateEntity => !!entity && typeof entity === 'object' && !Array.isArray(entity))
            : [];
    }

    protected readMutableGraph(crate: RoCrate): RoCrateEntity[] {
        if (!Array.isArray(crate['@graph'])) {
            crate['@graph'] = [];
        }
        return crate['@graph'] as RoCrateEntity[];
    }

    protected resolveEntities(value: unknown, graph: RoCrateEntity[]): RoCrateEntity[] {
        if (Array.isArray(value)) {
            return value.flatMap(item => this.resolveEntities(item, graph));
        }
        if (value && typeof value === 'object') {
            const entity = value as RoCrateEntity;
            const linkedEntity = this.readStrings(entity['@id'])
                .map(id => graph.find(graphEntity => graphEntity['@id'] === id))
                .find((graphEntity): graphEntity is RoCrateEntity => !!graphEntity);
            return linkedEntity ? [linkedEntity] : [entity];
        }
        return this.readStrings(value)
            .map(id => graph.find(graphEntity => graphEntity['@id'] === id))
            .filter((entity): entity is RoCrateEntity => !!entity);
    }

    protected entityTypes(entity: RoCrateEntity): string[] {
        return this.readStrings(entity['@type']);
    }

    protected readStrings(value: unknown): string[] {
        return this.readScalarValues(value).map(item => String(item));
    }

    protected readScalarValues(value: unknown): DataverseValue[] {
        if (typeof value === 'string') {
            return value.trim() ? [value.trim()] : [];
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? [value] : [];
        }
        if (Array.isArray(value)) {
            return this.uniqueValues(value.flatMap(item => this.readScalarValues(item)));
        }
        return [];
    }

    protected uniqueValues(values: DataverseValue[]): DataverseValue[] {
        const seen = new Set<string>();
        const unique: DataverseValue[] = [];
        for (const value of values) {
            const key = `${typeof value}:${String(value)}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(value);
            }
        }
        return unique;
    }

    protected uniqueStrings(values: string[]): string[] {
        return this.uniqueValues(values) as string[];
    }

    protected uniqueEntitiesById(entities: RoCrateEntity[]): RoCrateEntity[] {
        const seen = new Set<string>();
        const unique: RoCrateEntity[] = [];
        for (const entity of entities) {
            const key = this.readStrings(entity['@id'])[0] ?? JSON.stringify(entity);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            unique.push(entity);
        }
        return unique;
    }

    protected looksLikeEntityId(value: string): boolean {
        return value.startsWith('#') || value.startsWith('./') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
    }

    protected readReferenceIds(value: unknown): string[] {
        if (Array.isArray(value)) {
            return value.flatMap(item => this.readReferenceIds(item));
        }
        if (value && typeof value === 'object') {
            return this.readStrings((value as RoCrateEntity)['@id']);
        }
        return this.readStrings(value);
    }

    protected generatedEntityId(root: RoCrateEntity, typeName: string, index: number): string {
        const arpPid = this.readStrings(root['@arpPid'])[0];
        if (arpPid) {
            return `https://w3id.org/arp/ro-id/${arpPid}/${typeName}/sync-${index + 1}`;
        }
        return `#${typeName}-${index + 1}`;
    }

    protected hasMeaningfulValue(value: unknown): boolean {
        if (Array.isArray(value)) {
            return value.some(item => this.hasMeaningfulValue(item));
        }
        return typeof value === 'string'
            ? value.trim().length > 0
            : value !== undefined && value !== null;
    }
}
