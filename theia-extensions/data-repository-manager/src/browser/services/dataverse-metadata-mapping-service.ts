import { injectable } from 'inversify';
import crosswalk = require('../metadata-crosswalks/ro-crate-repository-crosswalk.json');

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

    protected fieldSchema(blockName: string, fieldName: string): DataverseFieldSchema | undefined {
        return repositoryCrosswalk.repositories.dataverse.blocks[blockName]?.schema.fields?.[fieldName];
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

    protected isExecutableMapping(status: string): boolean {
        return status === 'exactNameAndProfileMatch' || status === 'needsReview';
    }

    protected readGraph(crate: RoCrate): RoCrateEntity[] {
        const graph = crate['@graph'];
        return Array.isArray(graph)
            ? graph.filter((entity): entity is RoCrateEntity => !!entity && typeof entity === 'object' && !Array.isArray(entity))
            : [];
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
}
