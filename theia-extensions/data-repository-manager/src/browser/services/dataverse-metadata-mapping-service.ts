import { injectable, inject } from 'inversify';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { FileStat } from '@theia/filesystem/lib/common/files';

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

@injectable()
export class DataverseMetadataMappingService {
    protected readonly ignoredFields = new Set([
        'citation.title_hu',
        'citation.dsDescription_hu',
        'citation.dsDescription_hu.dsDescriptionValue_hu',
        'citation.dsDescription_hu.dsDescriptionDate_hu'
    ]);

    constructor(
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer,
        @inject(FileService) protected readonly fileService: FileService
    ) { }

    public async buildMetadataBlocks(
        crate: RoCrate,
        enabledMetadataBlocks?: Set<string>
    ): Promise<Record<string, DataverseMetadataBlockDto>> {
        const schemas = await this.readCachedBlockSchemas();
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
            const fields = this.buildBlockFields(blockName, root, graph, schema);
            if (fields.length) {
                blocks[blockName] = {
                    displayName: schema.displayName ?? blockName,
                    fields
                };
            }
        }
        return blocks;
    }

    protected buildBlockFields(
        blockName: string,
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        schema: DataverseMetadataBlockSchema
    ): DataverseMetadataFieldDto[] {
        return Object.values(schema.fields ?? {})
            .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
            .map(field => this.buildField(blockName, root, graph, field))
            .filter((field): field is DataverseMetadataFieldDto => !!field);
    }

    protected buildField(
        blockName: string,
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        schema: DataverseFieldSchema
    ): DataverseMetadataFieldDto | undefined {
        const typeName = schema.name;
        if (!typeName || this.ignoredFields.has(`${blockName}.${typeName}`)) {
            return undefined;
        }
        const typeClass = this.toDataverseTypeClass(schema);
        if (typeClass === 'compound') {
            const values = this.collectCompoundValues(blockName, root, graph, schema);
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

        const values = this.collectPrimitiveValues(root, graph, typeName, schema);
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
        schema: DataverseFieldSchema
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
                for (const child of Object.values(childFields).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))) {
                    const childName = child.name;
                    if (!childName || this.ignoredFields.has(`${blockName}.${typeName}.${childName}`)) {
                        continue;
                    }
                    const childValues = this.collectEntityPrimitiveValues(entity, childName, child);
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
        if (typeName === 'dsDescription') {
            return this.readStrings(root.description)
                .map(dsDescriptionValue => ({ dsDescriptionValue }));
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
        if (fieldName === 'datasetContactName') {
            return entity.datasetContactName ?? entity.name;
        }
        if (fieldName === 'datasetContactEmail') {
            return entity.datasetContactEmail ?? entity.email;
        }
        if (fieldName === 'dsDescriptionValue') {
            return entity.dsDescriptionValue ?? entity.description ?? entity.name;
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

    protected async readCachedBlockSchemas(): Promise<DataverseMetadataBlockSchema[]> {
        const folder = await this.getDataverseSchemaFolderUri();
        const stat = await this.fileService.resolve(folder);
        const children = stat.children ?? [];
        const schemas: DataverseMetadataBlockSchema[] = [];
        for (const child of this.sortFileStats(children)) {
            if (child.isDirectory || !child.resource.path.base.endsWith('.json')) {
                continue;
            }
            const content = await this.fileService.readFile(child.resource);
            const parsed = JSON.parse(content.value.toString()) as DataverseMetadataBlockSchema;
            if (parsed.name && parsed.fields) {
                schemas.push(parsed);
            }
        }
        return schemas;
    }

    protected sortFileStats(stats: FileStat[]): FileStat[] {
        return [...stats].sort((a, b) => a.resource.path.base.localeCompare(b.resource.path.base));
    }

    protected async getDataverseSchemaFolderUri(): Promise<URI> {
        const rootPath = (await this.envVariablesServer.getValue('ROCKIT_ROOT_PATH'))?.value;
        if (!rootPath) {
            throw new Error('ROCKIT_ROOT_PATH is not configured.');
        }
        const normalizedRoot = rootPath.replace(/\\/g, '/');
        const root = normalizedRoot.match(/^[a-zA-Z]:/)
            ? new URI(`file:///${normalizedRoot}`)
            : new URI(`file://${normalizedRoot}`);
        return root.resolve('metadata-schemas/dataverse');
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
