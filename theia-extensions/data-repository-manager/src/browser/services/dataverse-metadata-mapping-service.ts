// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { injectable } from 'inversify';
import crosswalk = require('../crosswalks/arp-dataverse-crosswalk.json');

type RoCrateEntity = Record<string, unknown>;
type RoCrate = Record<string, unknown>;
type DataverseValue = string | number;
type EntityWrites = Map<RoCrateEntity, Map<string, unknown>>;

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

interface DataverseSourceCandidate {
    property?: string;
    localName?: string;
    valueProperty?: string;
    valueEntityType?: string;
    acquisitionActionType?: string;
    acquisitionResultType?: string;
    acquisitionLocation?: boolean;
    expandedOnly?: boolean;
    linkedEntityType?: string;
    literalField?: string;
    textOnly?: boolean;
}

interface DataverseCrosswalkChild {
    sourceCandidates?: DataverseSourceCandidate[];
    target: { field: string };
    mappingStatus: string;
}

interface DataverseCrosswalkMapping {
    direction?: string;
    requiredExportChild?: string;
    source?: { canonicalCandidates?: DataverseSourceCandidate[] };
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
        enabledMetadataBlocks?: Set<string>,
        crosswalkDocument?: unknown
    ): Promise<Record<string, DataverseMetadataBlockDto>> {
        const activeCrosswalk = this.resolveCrosswalk(crosswalkDocument);
        const schemas = this.readCrosswalkBlockSchemas(activeCrosswalk);
        const mappings = activeCrosswalk.crosswalks.canonicalToDataverse.mappings
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

    public requiredFields(blockName: string, crosswalkDocument?: unknown): Set<string> {
        const activeCrosswalk = this.resolveCrosswalk(crosswalkDocument);
        return new Set(
            activeCrosswalk.crosswalks.canonicalToDataverse.mappings
                .filter(mapping =>
                    mapping.target.block === blockName &&
                    this.isExecutableMapping(mapping.mappingStatus) &&
                    (mapping.target as { required?: boolean }).required === true
                )
                .map(mapping => mapping.target.field)
        );
    }

    public controlledVocabularyValues(
        blockName: string,
        fieldName: string,
        crosswalkDocument?: unknown
    ): string[] {
        const values = this.fieldSchema(
            blockName,
            fieldName,
            this.resolveCrosswalk(crosswalkDocument)
        )?.controlledVocabularyValues;
        return Array.isArray(values) ? values : [];
    }

    public fieldDisplayName(blockName: string, fieldName: string, crosswalkDocument?: unknown): string {
        return this.fieldSchema(
            blockName,
            fieldName,
            this.resolveCrosswalk(crosswalkDocument)
        )?.displayName ?? fieldName;
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
        datasetVersionData: Record<string, unknown>,
        crosswalkDocument?: unknown
    ): DataverseReverseCrosswalkResult {
        const activeCrosswalk = this.resolveCrosswalk(crosswalkDocument);
        const nextCrate = JSON.parse(JSON.stringify(crate)) as RoCrate;
        const graph = this.readMutableGraph(nextCrate);
        const root = graph.find(entity => entity['@id'] === './');
        if (!root) {
            throw new Error('The RO-Crate does not contain a root Dataset with @id "./".');
        }

        const updatedFields: string[] = [];
        const writes: EntityWrites = new Map();
        const schemasByName = new Map(
            this.readCrosswalkBlockSchemas(activeCrosswalk)
                .filter(schema => !!schema.name)
                .map(schema => [schema.name as string, schema])
        );
        const mappings = activeCrosswalk.crosswalks.canonicalToDataverse.mappings
            .filter(mapping => this.isExecutableMapping(mapping.mappingStatus));

        for (const mapping of mappings) {
            if (mapping.direction === 'exportOnly') continue;
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
                ? this.applyCompoundField(root, graph, field, fieldSchema, mapping, writes)
                : this.applyRootField(root, graph, field, fieldSchema, mapping, writes);
            if (updated) {
                updatedFields.push(mapping.target.field);
            }
        }

        return { crate: nextCrate, updatedFields: this.uniqueStrings(updatedFields) };
    }

    protected fieldSchema(
        blockName: string,
        fieldName: string,
        activeCrosswalk: DataverseCrosswalk = repositoryCrosswalk
    ): DataverseFieldSchema | undefined {
        return activeCrosswalk.repositories.dataverse.blocks[blockName]?.schema.fields?.[fieldName];
    }

    protected applyRootField(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        field: DataverseMetadataFieldDto,
        schema: DataverseFieldSchema,
        mapping: DataverseCrosswalkMapping,
        writes: EntityWrites
    ): boolean {
        const value = this.reverseDataverseFieldValue(field, schema);
        if (!this.hasMeaningfulValue(value)) {
            return false;
        }
        const candidates = this.sourceCandidates(mapping.source?.canonicalCandidates, field.typeName);
        const source = this.existingSource(root, graph, candidates);
        if (source.acquisitionActionType) {
            const owners = this.acquisitionValueOwners(root, graph, source);
            const values = this.readStrings(value);
            if (owners.length !== 1 || values.length !== 1) return false;
            const key = this.expandedSchemaKey(owners[0], 'https://schema.org/name');
            this.assignSourceValue(owners[0], key, values[0], writes);
            return true;
        }
        if (source.valueEntityType) {
            const owner = this.typedValueOwner(root, graph, source);
            if (!owner || !source.valueProperty) return false;
            const key = this.expandedSchemaKey(owner, source.valueProperty);
            this.assignSourceValue(owner, key, value, writes);
            return true;
        }
        // Preserve a structured link when its owner or value could not be resolved.
        const hasStructuredLink = candidates.some(candidate => {
            if (!candidate.valueEntityType || !candidate.property) return false;
            const link = root[candidate.property];
            return (Array.isArray(link) ? link : [link]).some(item => item && typeof item === 'object');
        });
        if (hasStructuredLink) return false;
        this.writeSourceValue(root, graph, source, value, writes);
        return true;
    }

    protected applyCompoundField(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        field: DataverseMetadataFieldDto,
        schema: DataverseFieldSchema,
        mapping: DataverseCrosswalkMapping,
        writes: EntityWrites
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

        const candidates = this.sourceCandidates(mapping.source?.canonicalCandidates, typeName);
        const source = candidates.find(candidate =>
            this.hasMeaningfulValue(this.readSourceValue(root, graph, candidate, false)) ||
            this.reverseLinkedEntities(root, graph, candidate).length) ?? candidates[0];
        const sourceValue = this.readSourceValue(root, graph, source);
        const sourceItems = Array.isArray(sourceValue) ? sourceValue : [sourceValue];
        if (source.literalField && sourceItems.length &&
            sourceItems.every(value => (typeof value === 'string' || typeof value === 'number') &&
                !this.resolveEntities(value, graph).length)) {
            const values = rows.flatMap((row, index) => {
                const childName = source.literalField!;
                const child = this.findDataverseField([row[childName]], childName);
                return child ? this.readScalarValues(child.value) : [];
            });
            if (!values.length) return false;
            this.writeSourceValue(root, graph, source, Array.isArray(sourceValue) ? values : values[0], writes);
            return true;
        }
        const existingEntities = this.reverseLinkedEntities(root, graph, source);
        const childMappings = new Map(
            (mapping.children ?? [])
                .filter(child => this.isExecutableMapping(child.mappingStatus))
                .map(child => [child.target.field, child])
        );
        const refs: unknown[] = [];

        rows.forEach((row, index) => {
            const original = sourceItems[index];
            if (source.literalField && (typeof original === 'string' || typeof original === 'number') &&
                !this.resolveEntities(original, graph).length) {
                const childName = source.literalField!;
                const child = this.findDataverseField([row[childName]], childName);
                const value = this.readScalarValues(child?.value)[0];
                if (value !== undefined) refs.push(value);
                return;
            }
            let entity = this.resolveEntities(original, graph)[0] ?? existingEntities[index];
            if (!entity) {
                const baseId = this.generatedEntityId(root, typeName, index);
                let id = baseId;
                let suffix = 1;
                while (graph.some(candidate => candidate['@id'] === id)) {
                    id = `${baseId}-${++suffix}`;
                }
                entity = {
                    '@id': id,
                    '@type': typeName,
                    '@reverse': { [typeName]: { '@id': './' } }
                };
                graph.push(entity);
            }
            if (entity['@id'] && !graph.some(item => item['@id'] === entity!['@id'])) {
                graph.push(entity);
            }

            let displayName: string | undefined;
            for (const [childName, childMapping] of childMappings) {
                const childSchema = childFields[childName];
                const childField = this.findDataverseField([row[childName]], childName);
                if (!childSchema || !childField || this.ignoredFields.has(`${mapping.target.block}.${typeName}.${childName}`)) {
                    continue;
                }
                const value = this.reverseDataverseFieldValue(childField, childSchema);
                if (!this.hasMeaningfulValue(value)) {
                    continue;
                }
                const childSource = this.existingSource(entity, graph,
                    this.sourceCandidates(childMapping.sourceCandidates, childName));
                const sourceName = childSource.localName ?? childName;
                const mirrorName = !this.hasMeaningfulValue(
                    entity[this.propertyKey(entity, 'https://schema.org/name')]);
                this.writeSourceValue(entity, graph, childSource, value, writes);
                if (mirrorName && typeof value === 'string' && (
                    sourceName === `${typeName}Name` ||
                    sourceName === `${typeName}Value`
                )) {
                    displayName = value;
                }
            }
            if (displayName) {
                this.assignSourceValue(entity, 'name', displayName, writes);
            }
            refs.push(entity['@id'] ? { '@id': entity['@id'] } : entity);
        });

        this.writeSourceValue(root, graph, source, refs.length === 1 ? refs[0] : refs, writes);
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

        const values = this.collectSourceValues(root, graph,
            this.sourceCandidates(mapping.source?.canonicalCandidates, typeName), schema, true);
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

        const entities = this.collectMappedCompoundEntities(root, graph, typeName, mapping);
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
                    const childValues = this.collectSourceValues(entity, graph,
                        this.sourceCandidates(childMapping.sourceCandidates, childName), child, false,
                        this.isPrimaryCompoundName(typeName, childName) &&
                            (typeName !== 'keyword' || this.entityTypes(entity).includes(typeName)));
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
            .filter(value => mapping.requiredExportChild
                ? Object.prototype.hasOwnProperty.call(value, mapping.requiredExportChild)
                : Object.keys(value).length > 0);
    }

    protected sourceCandidates(
        candidates: DataverseSourceCandidate[] | undefined,
        localName: string
    ): DataverseSourceCandidate[] {
        return candidates?.length ? candidates : [{ localName }];
    }

    protected propertyKey(entity: RoCrateEntity, property: string, localName?: string): string {
        const schemaTerm = property.match(/^https?:\/\/schema\.org\/(.+)$/)?.[1];
        const keys = [property, ...(schemaTerm
            ? [`http://schema.org/${schemaTerm}`, `https://schema.org/${schemaTerm}`, `schema:${schemaTerm}`, schemaTerm]
            : []), localName].filter((key): key is string => !!key);
        if (localName === 'datasetContact') keys.push('contactPoint');
        return keys.find(key => Object.prototype.hasOwnProperty.call(entity, key)) ??
            localName ?? (schemaTerm || property);
    }

    protected expandedSchemaKey(entity: RoCrateEntity, property: string): string {
        const legacy = property.replace(/^https:\/\/schema\.org\//, 'http://schema.org/');
        return Object.prototype.hasOwnProperty.call(entity, property) ? property : legacy;
    }

    protected acquisitionValueOwners(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        source: DataverseSourceCandidate
    ): RoCrateEntity[] {
        if (!source.acquisitionActionType || !source.property) return [];
        const actionType = source.acquisitionActionType;
        const property = source.property;
        const resultType = source.acquisitionResultType;
        const resultIds = resultType
            ? this.resolveEntities(root[this.expandedSchemaKey(root, 'https://schema.org/hasPart')], graph)
                .filter(part => this.hasExpandedSchemaType(part, resultType))
                .flatMap(part => this.readStrings(part['@id']))
            : [String(root['@id'])];
        const owners = graph.filter(action =>
            this.hasExpandedSchemaType(action, actionType) &&
            this.readReferenceIds(action[this.expandedSchemaKey(action, 'https://schema.org/result')])
                .some(id => resultIds.includes(id))
        ).flatMap(action => {
            const value = action[this.expandedSchemaKey(action, property)];
            const links = Array.isArray(value) ? value : [value];
            return links.filter(link => link && typeof link === 'object')
                .flatMap(link => this.resolveEntities(link, graph));
        });
        return [...new Set(owners)].filter(owner =>
            (!source.acquisitionLocation || this.hasExpandedSchemaType(owner, 'https://schema.org/Place')) &&
            this.readAcquisitionName(owner) !== undefined
        );
    }

    protected hasExpandedSchemaType(entity: RoCrateEntity, type: string): boolean {
        const legacyType = type.replace(/^https:\/\/schema\.org\//, 'http://schema.org/');
        return this.entityTypes(entity).some(entityType => entityType === type || entityType === legacyType);
    }

    protected readAcquisitionName(entity: RoCrateEntity): string | undefined {
        const name = entity[this.expandedSchemaKey(entity, 'https://schema.org/name')];
        return typeof name === 'string' && name.trim() ? name : undefined;
    }

    protected typedValueOwner(
        entity: RoCrateEntity,
        graph: RoCrateEntity[],
        source: DataverseSourceCandidate
    ): RoCrateEntity | undefined {
        if (!source.property || !source.valueEntityType) return undefined;
        const link = entity[source.property];
        if (!link || typeof link !== 'object') return undefined;
        if (Array.isArray(link) && link.length !== 1) return undefined;
        const owners = this.resolveEntities(link, graph);
        if (owners.length !== 1) return undefined;
        const legacyType = source.valueEntityType.replace(/^https:\/\/schema\.org\//, 'http://schema.org/');
        return this.entityTypes(owners[0]).some(type => type === source.valueEntityType || type === legacyType)
            ? owners[0] : undefined;
    }

    protected readSourceValue(
        entity: RoCrateEntity,
        graph: RoCrateEntity[],
        source: DataverseSourceCandidate,
        legacyFallback = true,
        fallbackToEntityName = false
    ): unknown {
        if (source.acquisitionActionType) {
            return this.acquisitionValueOwners(entity, graph, source).map(owner => this.readAcquisitionName(owner));
        }
        if (source.valueEntityType) {
            const owner = this.typedValueOwner(entity, graph, source);
            if (!owner || !source.valueProperty) return undefined;
            const value = owner[this.expandedSchemaKey(owner, source.valueProperty)];
            return typeof value === 'string' ? value : undefined;
        }
        if (source.expandedOnly && source.property) {
            return entity[this.expandedSchemaKey(entity, source.property)];
        }
        const key = this.propertyKey(entity, source.property ?? source.localName ?? '', source.localName);
        let value = entity[key] ?? (legacyFallback && source.localName
            ? this.readPrimitiveValue(entity, source.localName, fallbackToEntityName)
            : undefined);
        if (source.valueProperty) {
            const multiple = Array.isArray(value);
            const values = Array.isArray(value) ? value : [value];
            const labels = values.flatMap(item => {
                const resolved = this.resolveEntities(item, graph);
                if (resolved.length) return resolved.flatMap(entity =>
                    this.readScalarValues(entity[this.propertyKey(entity, source.valueProperty!)]));
                if (typeof item !== 'string' && typeof item !== 'number') return [];
                return typeof item === 'string' && this.looksLikeEntityId(item) ? [] : [item];
            });
            value = multiple || labels.length > 1 ? labels : labels[0];
        }
        const items = Array.isArray(value) ? value : [value];
        if (source.textOnly && !items.every(item => typeof item === 'string' && !this.looksLikeEntityId(item))) {
            return undefined;
        }
        return value;
    }

    protected existingSource(
        entity: RoCrateEntity,
        graph: RoCrateEntity[],
        candidates: DataverseSourceCandidate[]
    ): DataverseSourceCandidate {
        return candidates.find(source => {
            const key = this.propertyKey(entity, source.property ?? source.localName ?? '', source.localName);
            const value = entity[key];
            const primitive = value == null || typeof value === 'string' || typeof value === 'number' ||
                (Array.isArray(value) && value.every(item => typeof item === 'string' || typeof item === 'number'));
            return (!source.textOnly && !source.valueProperty &&
                Object.prototype.hasOwnProperty.call(entity, key) && primitive) ||
                this.readScalarValues(this.readSourceValue(entity, graph, source, false)).length > 0;
        }) ?? candidates[0];
    }

    protected writeSourceValue(
        entity: RoCrateEntity,
        graph: RoCrateEntity[],
        source: DataverseSourceCandidate,
        value: unknown,
        writes?: EntityWrites
    ): void {
        const key = this.propertyKey(entity, source.property ?? source.localName ?? '', source.localName);
        const nested = source.valueProperty ? this.resolveEntities(entity[key], graph) : [];
        const values = Array.isArray(value) ? value : [value];
        if (source.valueProperty && nested.length && values.length === nested.length) {
            nested.forEach((item, index) => {
                this.assignSourceValue(item, this.propertyKey(item, source.valueProperty!), values[index], writes);
            });
        } else {
            this.assignSourceValue(entity, key, value, writes);
        }
    }

    protected assignSourceValue(
        entity: RoCrateEntity,
        key: string,
        value: unknown,
        writes?: EntityWrites
    ): void {
        const previous = writes?.get(entity);
        if (previous?.has(key) && JSON.stringify(previous.get(key)) !== JSON.stringify(value)) {
            throw new Error(`Conflicting Dataverse values for entity '${String(entity['@id'] ?? '(inline)')}' property '${key}'.`);
        }
        if (writes) {
            const fields = previous ?? new Map<string, unknown>();
            fields.set(key, value);
            writes.set(entity, fields);
        }
        entity[key] = value;
    }

    protected reverseLinkedEntities(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        source: DataverseSourceCandidate
    ): RoCrateEntity[] {
        return graph.filter(entity => {
            const reverse = entity['@reverse'];
            if (!reverse || typeof reverse !== 'object' || Array.isArray(reverse)) return false;
            const links = reverse as RoCrateEntity;
            const key = this.propertyKey(links, source.property ?? source.localName ?? '', source.localName);
            return this.readReferenceIds(links[key]).includes(String(root['@id']));
        });
    }

    protected collectSourceValues(
        entity: RoCrateEntity,
        graph: RoCrateEntity[],
        candidates: DataverseSourceCandidate[],
        schema: DataverseFieldSchema,
        includeTypeMatches = false,
        fallbackToEntityName = false
    ): DataverseValue[] {
        for (const source of candidates) {
            const fieldName = source.localName ?? schema.name ?? '';
            const raw = this.readSourceValue(entity, graph, source, true, fallbackToEntityName);
            const values = this.readScalarValues(raw)
                .map(value => this.normalizeValue(fieldName, value, schema))
                .filter((value): value is DataverseValue => value !== undefined);
            if (source.acquisitionActionType && !schema.multiple && this.uniqueValues(values).length > 1) continue;
            // Preserve support for the legacy entity-per-field representation.
            if (includeTypeMatches && source.localName) {
                values.push(...graph.filter(item => this.entityTypes(item).includes(source.localName!))
                    .flatMap(item => this.collectEntityPrimitiveValues(item, fieldName, schema)));
            }
            if (values.length) return this.uniqueValues(values);
        }
        return [];
    }

    protected collectMappedCompoundEntities(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        typeName: string,
        mapping: DataverseCrosswalkMapping
    ): RoCrateEntity[] {
        const candidates = this.sourceCandidates(mapping.source?.canonicalCandidates, typeName);
        for (const source of candidates) {
            const raw = this.readSourceValue(root, graph, source);
            if (source.linkedEntityType) {
                const type = source.linkedEntityType;
                const entities = this.uniqueEntitiesById(this.resolveEntities(raw, graph)
                    .filter(entity => this.hasExpandedSchemaType(entity, type)));
                if (entities.length) return entities;
                continue;
            }
            const values = Array.isArray(raw) ? raw : [raw];
            const entities = values.flatMap(value => {
                if (source.literalField && (typeof value === 'string' || typeof value === 'number')) {
                    const referenced = this.resolveEntities(value, graph);
                    if (referenced.length) return referenced;
                    return [{ [source.literalField]: value }];
                }
                return this.resolveEntities(value, graph);
            });
            const legacy = source === candidates[0] ? this.collectCompoundEntities(root, graph, typeName) : [];
            entities.push(...this.reverseLinkedEntities(root, graph, source));
            const combined = this.uniqueEntitiesById([...entities, ...legacy]);
            if (combined.length) return combined;
        }
        return [];
    }

    protected collectCompoundEntities(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        typeName: string
    ): RoCrateEntity[] {
        const references = this.resolveEntities(this.readCompoundRootValue(root, typeName), graph);
        const typeMatches = this.reverseLinkedEntities(root, graph, { localName: typeName });
        const literalFallbacks = this.collectCompoundLiteralFallbacks(root, typeName);
        return this.uniqueEntitiesById([...references, ...typeMatches, ...literalFallbacks]);
    }

    protected collectEntityPrimitiveValues(
        entity: RoCrateEntity,
        fieldName: string,
        schema: DataverseFieldSchema,
        fallbackToEntityName = false
    ): DataverseValue[] {
        const values = this.readScalarValues(
            this.readPrimitiveValue(entity, fieldName, fallbackToEntityName));
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

    protected readPrimitiveValue(
        entity: RoCrateEntity,
        fieldName: string,
        fallbackToEntityName = false
    ): unknown {
        if (fieldName === 'title') {
            return entity.title;
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
        return entity[fieldName] ?? (fallbackToEntityName ? entity.value ?? entity.name : undefined);
    }

    protected isPrimaryCompoundName(typeName: string, fieldName: string): boolean {
        return fieldName === 'name' ||
            fieldName === `${typeName}Name` ||
            fieldName === `${typeName}Value`;
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

    protected readCrosswalkBlockSchemas(
        activeCrosswalk: DataverseCrosswalk = repositoryCrosswalk
    ): DataverseMetadataBlockSchema[] {
        return Object.values(activeCrosswalk.repositories.dataverse.blocks)
            .map(block => block.schema)
            .filter(schema => !!schema.name && !!schema.fields)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    protected resolveCrosswalk(value?: unknown): DataverseCrosswalk {
        if (value === undefined) {
            return repositoryCrosswalk;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('The selected crosswalk is not a valid Dataverse crosswalk.');
        }
        const candidate = value as Partial<DataverseCrosswalk>;
        const blocks = candidate.repositories?.dataverse?.blocks;
        const mappings = candidate.crosswalks?.canonicalToDataverse?.mappings;
        if (!blocks || typeof blocks !== 'object' || !Array.isArray(mappings)) {
            throw new Error(
                'The selected crosswalk does not contain Dataverse schemas and canonicalToDataverse mappings.'
            );
        }
        return candidate as DataverseCrosswalk;
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
