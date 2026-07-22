import { URI } from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { nls } from '@theia/core/lib/common/nls';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { inject, injectable } from 'inversify';
import {
    collectRoCrateExportFileReferences,
    localizeExternalRoCrateFileReferences,
    RoCrateExportFileSource
} from 'rockit-common/lib/common/ro-crate-export-file-references';
import { DataRepositoryConfig, DataRepositoryExportTarget, DataverseCollection } from '../types';

type RoCrateEntity = Record<string, unknown>;
type RoCrate = Record<string, unknown>;
type RoCrateEntityIdMapping = Record<string, string>;

interface NativeDataverseUploadCollection {
    files: NativeDataverseUploadFile[];
    metadataCrate: RoCrate;
    uploadEntryPathByEntityId: Map<string, string>;
    originalToUploadIds: Map<string, string>;
}

interface NativeDataverseRemoteFileReference {
    md5: string;
    directoryLabel: string;
    label: string;
    remoteId: string;
}

interface NativeDataverseDraftFileRecord {
    id: string;
    label: string;
    persistentId?: string;
}

interface DataverseMetadataField {
    typeName: string;
    typeClass: 'primitive' | 'compound' | 'controlledVocabulary';
    multiple: boolean;
    value: unknown;
}

interface NativeDataverseResponse {
    status?: string;
    data?: {
        id?: number;
        persistentId?: string;
        [key: string]: unknown;
    };
    message?: string;
    [key: string]: unknown;
}

export interface NativeDataverseDatasetCreationResult {
    datasetId?: number;
    persistentId?: string;
    target?: string;
    uploadedFiles: NativeDataverseFileUploadResult[];
    requestUrl: string;
    response: NativeDataverseResponse;
    mappingFileName: string;
    unmappedEntityIds: string[];
}

export interface NativeDataverseUpdateResult {
    persistentId: string;
    target: string;
    addedFileCount: number;
    replacedFileCount: number;
    removedFileCount: number;
    mappingFileName: string;
}

export interface NativeDataverseDatasetMetadata {
    title: string;
    authorNames: string[];
    contactEmails: string[];
    descriptions: string[];
    subjects: string[];
}

export interface NativeDataverseFileUploadResult {
    entryPath: string;
    directoryLabel?: string;
    fileName: string;
    response: NativeDataverseResponse;
}

interface NativeDataverseUploadFile {
    entryPath: string;
    content: Uint8Array;
}

interface ExportLogEntry {
    target: string;
    repository: string;
    mappingFile: string;
    syncType: 'create' | 'update';
    syncedAt: string;
    collectionId?: string;
}

interface NativeDataverseExportTarget {
    persistentId: string;
    exportLogEntry: ExportLogEntry;
    mapping: RoCrateEntityIdMapping;
}

export interface NativeDataverseExportProgress {
    completedSteps: number;
    totalSteps: number;
    message: string;
}

export type NativeDataverseExportProgressReporter = (progress: NativeDataverseExportProgress) => void;

const EXPORT_LOG_FILE_NAME = 'export-log.json';

const DATAVERSE_MULTIPLE_VALUE_FIELDS = new Set([
    'geographicUnit',
    'unitOfAnalysis',
    'universe',
    'collectionMode'
]);

interface DataverseSemanticMetadataBlockDefinition {
    prefix: string;
    namespace: string;
    displayName: string;
    fields: string[];
    compounds: Record<string, string[]>;
}

const DATAVERSE_SEMANTIC_METADATA_BLOCKS: Record<string, DataverseSemanticMetadataBlockDefinition> = {
    geospatial: {
        prefix: 'geospatial',
        namespace: 'https://dataverse.org/schema/geospatial/',
        displayName: 'Geospatial Metadata',
        fields: ['geographicUnit'],
        compounds: {
            geographicCoverage: ['country', 'state', 'city', 'otherGeographicCoverage'],
            geographicBoundingBox: ['westLongitude', 'eastLongitude', 'northLatitude', 'southLatitude']
        }
    },
    socialscience: {
        prefix: 'socialscience',
        namespace: 'https://dataverse.org/schema/socialscience/',
        displayName: 'Social Science and Humanities Metadata',
        fields: [
            'unitOfAnalysis',
            'universe',
            'timeMethod',
            'dataCollector',
            'collectorTraining',
            'frequencyOfDataCollection',
            'samplingProcedure',
            'deviationsFromSampleDesign',
            'collectionMode',
            'researchInstrument',
            'dataCollectionSituation',
            'actionsToMinimizeLoss',
            'controlOperations',
            'weighting',
            'cleaningOperations',
            'datasetLevelErrorNotes',
            'responseRate',
            'samplingErrorEstimates',
            'otherDataAppraisal'
        ],
        compounds: {
            targetSampleSize: ['targetSampleActualSize', 'targetSampleSizeFormula'],
            socialScienceNotes: ['socialScienceNotesType', 'socialScienceNotesSubject', 'socialScienceNotesText']
        }
    },
    astrophysics: {
        prefix: 'astrophysics',
        namespace: 'https://dataverse.org/schema/astrophysics/',
        displayName: 'Astronomy and Astrophysics Metadata',
        fields: [
            'astroType',
            'astroFacility',
            'astroInstrument',
            'astroObject',
            'resolution.Spatial',
            'resolution.Spectral',
            'resolution.Temporal',
            'coverage.Spectral.Bandpass',
            'coverage.Spectral.CentralWavelength',
            'coverage.Spatial',
            'coverage.Depth',
            'coverage.ObjectDensity',
            'coverage.ObjectCount',
            'coverage.SkyFraction',
            'coverage.Polarization',
            'redshiftType',
            'resolution.Redshift'
        ],
        compounds: {
            'coverage.Spectral.Wavelength': ['coverage.Spectral.MinimumWavelength', 'coverage.Spectral.MaximumWavelength'],
            'coverage.Temporal': ['coverage.Temporal.StartTime', 'coverage.Temporal.StopTime'],
            'coverage.RedshiftValue': ['coverage.Redshift.MinimumValue', 'coverage.Redshift.MaximumValue']
        }
    },
    biomedical: {
        prefix: 'biomedical',
        namespace: 'https://dataverse.org/schema/biomedical/',
        displayName: 'Life Sciences Metadata',
        fields: [
            'studyDesignType',
            'studyOtherDesignType',
            'studyFactorType',
            'studyOtherFactorType',
            'studyAssayOrganism',
            'studyAssayOtherOrganism',
            'studyAssayMeasurementType',
            'studyAssayOtherMeasurmentType',
            'studyAssayTechnologyType',
            'studyAssayOtherTechnologyType',
            'studyAssayPlatform',
            'studyAssayOtherPlatform',
            'studyAssayCellType'
        ],
        compounds: {}
    },
    journal: {
        prefix: 'journal',
        namespace: 'https://dataverse.org/schema/journal/',
        displayName: 'Journal Metadata',
        fields: ['journalArticleType'],
        compounds: {
            journalVolumeIssue: ['journalVolume', 'journalIssue', 'journalPubDate']
        }
    }
};

@injectable()
export class NativeDataverseExportService {

    constructor(
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
        @inject(FileService) protected readonly fileService: FileService
    ) { }

    public async createDataset(
        repository: DataRepositoryConfig,
        collection: DataverseCollection,
        datasetMetadata: NativeDataverseDatasetMetadata,
        reportProgress?: NativeDataverseExportProgressReporter
    ): Promise<NativeDataverseDatasetCreationResult> {
        const baseUrl = this.normalizeBaseUrl(repository.baseUrl);
        const collectionId = collection.alias || collection.id;
        const rootUri = this.getWorkspaceRoot();
        const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'));
        const enabledMetadataBlocks = await this.fetchCollectionMetadataBlockAliases(
            baseUrl,
            repository.apiKey,
            collectionId
        );
        const payload = this.buildDatasetCreationPayload(datasetMetadata, crate, enabledMetadataBlocks);
        const uploadCollection = await this.collectRoCrateUploadFiles(crate, rootUri);
        const uploadFiles = uploadCollection.files;
        const totalSteps = uploadFiles.length + 2;
        reportProgress?.({
            completedSteps: 0,
            totalSteps,
            message: nls.localize(
                'rockit/dataRepository/creatingDatasetInCollection',
                'Creating Dataverse dataset in {0}...',
                collection.name
            )
        });
        const requestUrl = `${baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/datasets`;
        const headers: Record<string, string> = {
            accept: 'application/json',
            'content-type': 'application/json'
        };
        if (repository.apiKey) {
            headers['x-dataverse-key'] = repository.apiKey;
        }

        const response = await fetch(requestUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        const responsePayload = await this.readResponsePayload(response);
        if (!response.ok || responsePayload.status === 'ERROR') {
            throw new Error(nls.localize(
                'rockit/dataRepository/nativeDatasetCreationRequestFailed',
                'Dataverse dataset creation failed ({0}): {1}',
                response.status,
                this.payloadSummary(responsePayload)
            ));
        }
        const persistentId = responsePayload.data?.persistentId;
        if (!persistentId) {
            throw new Error(nls.localize(
                'rockit/dataRepository/datasetCreatedWithoutPersistentId',
                'Dataverse created the dataset but did not return a persistentId. File upload cannot continue.'
            ));
        }
        await this.addDatasetSemanticMetadata(
            baseUrl,
            repository.apiKey,
            persistentId,
            crate,
            true,
            enabledMetadataBlocks
        );
        reportProgress?.({
            completedSteps: 1,
            totalSteps,
            message: nls.localize('rockit/dataRepository/datasetMetadataSynchronized', 'Dataverse dataset created and metadata synchronized.')
        });
        const uploadedDataFiles = await this.uploadRoCrateFiles(baseUrl, repository.apiKey, persistentId, uploadFiles, reportProgress, 1, totalSteps);
        const entityIdMapping = this.buildEntityIdMapping(crate, uploadedDataFiles, uploadCollection.uploadEntryPathByEntityId);
        const metadataUpload = this.buildRewrittenMetadataUploadFile(uploadCollection.metadataCrate, uploadedDataFiles);
        reportProgress?.({
            completedSteps: uploadFiles.length + 1,
            totalSteps,
            message: nls.localize('rockit/dataRepository/uploadingRewrittenMetadata', 'Uploading rewritten ro-crate-metadata.json...')
        });
        const uploadedMetadata = await this.uploadFile(baseUrl, repository.apiKey, persistentId, metadataUpload);
        const uploadedFiles = [...uploadedDataFiles, uploadedMetadata];
        const metadataFileId = this.extractDataFileId(uploadedMetadata.response);
        if (!metadataFileId) {
            throw new Error(nls.localize(
                'rockit/dataRepository/metadataUploadMissingId',
                'Dataverse uploaded ro-crate-metadata.json but did not return its database ID.'
            ));
        }
        entityIdMapping['ro-crate-metadata.json'] = metadataFileId;
        const mappingFileName = await this.createUniqueMappingFileName(rootUri);
        await this.saveEntityIdMapping(rootUri, mappingFileName, entityIdMapping);
        reportProgress?.({
            completedSteps: totalSteps,
            totalSteps,
            message: nls.localize('rockit/dataRepository/uploadedRewrittenMetadata', 'Uploaded rewritten ro-crate-metadata.json.')
        });
        const target = this.buildPidTarget(persistentId) || persistentId;
        await this.appendExportLog(rootUri, {
            target,
            repository: baseUrl,
            mappingFile: mappingFileName,
            syncType: 'create',
            syncedAt: new Date().toISOString(),
            collectionId
        });
        const unmappedEntityIds = Object.entries(entityIdMapping)
            .filter(([, remoteId]) => !remoteId)
            .map(([entityId]) => entityId);

        return {
            datasetId: responsePayload.data?.id,
            persistentId,
            target,
            uploadedFiles,
            requestUrl,
            response: responsePayload,
            mappingFileName,
            unmappedEntityIds
        };
    }

    public async updateDataset(
        repository: DataRepositoryConfig,
        exportTargetSelection?: DataRepositoryExportTarget,
        reportProgress?: NativeDataverseExportProgressReporter
    ): Promise<NativeDataverseUpdateResult | undefined> {
        const baseUrl = this.normalizeBaseUrl(repository.baseUrl);
        const rootUri = this.getWorkspaceRoot();
        const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'));
        const exportTarget = await this.resolveExistingExportTarget(rootUri, repository, exportTargetSelection);
        if (!exportTarget) {
            return undefined;
        }

        reportProgress?.({
            completedSteps: 0,
            totalSteps: 1,
            message: nls.localize('rockit/dataRepository/checkingChanges', 'Checking for changes...')
        });

        const uploadCollection = await this.collectRoCrateUploadFiles(crate, rootUri);
        const draftFiles = await this.fetchDraftFileRecords(
            baseUrl,
            repository.apiKey,
            exportTarget.persistentId
        );
        this.normalizeMappingToDatabaseIds(exportTarget.mapping, draftFiles);
        this.normalizeLocalizedMappingKeys(
            exportTarget.mapping,
            uploadCollection.originalToUploadIds
        );
        const metadataFileId = exportTarget.mapping['ro-crate-metadata.json']
            ?? draftFiles.find(file => file.label === 'ro-crate-metadata.json')?.id;
        if (!metadataFileId) {
            throw new Error(nls.localize(
                'rockit/dataRepository/existingExportMissingMetadataMapping',
                'The existing Dataverse export does not contain a mapped ro-crate-metadata.json file.'
            ));
        }
        exportTarget.mapping['ro-crate-metadata.json'] = metadataFileId;
        const remoteMetadataCrate = await this.downloadRemoteMetadataFile(baseUrl, repository.apiKey, metadataFileId);
        const localReachableIds = this.collectReachableEntityIds(crate);
        const localFilesById = new Map(
            this.readGraph(crate)
                .filter(entity => this.entityTypes(entity).includes('File'))
                .filter(entity => localReachableIds.has(this.requireEntityId(entity)))
                .map(entity => [this.requireEntityId(entity), entity])
        );
        const remoteEntitiesById = new Map(
            this.readGraph(remoteMetadataCrate).map(entity => [this.requireEntityId(entity), entity])
        );
        const uploadFilesByPath = new Map(uploadCollection.files.map(file => [file.entryPath, file]));
        const newFileIds: string[] = [];
        const changedFileIds: string[] = [];
        const matchedRemoteFileIds = new Set<string>();
        for (const [localId, localEntity] of localFilesById) {
            const remoteId = exportTarget.mapping[localId];
            const remoteEntity = remoteId ? remoteEntitiesById.get(remoteId) : undefined;
            if (!remoteId || !remoteEntity) {
                newFileIds.push(localId);
                continue;
            }
            matchedRemoteFileIds.add(remoteId);
            if ((this.fileEntityHash(localEntity) ?? '') !== (this.fileEntityHash(remoteEntity) ?? '')) {
                changedFileIds.push(localId);
            }
        }
        const removedRemoteFileIds = this.readGraph(remoteMetadataCrate)
            .filter(entity => this.entityTypes(entity).includes('File'))
            .map(entity => this.requireEntityId(entity))
            .filter(remoteId => remoteId !== 'ro-crate-metadata.json')
            .filter(remoteId => !matchedRemoteFileIds.has(remoteId));
        const totalSteps = newFileIds.length + changedFileIds.length + removedRemoteFileIds.length + 2;
        let completedSteps = 1;
        reportProgress?.({
            completedSteps,
            totalSteps,
            message: nls.localize(
                'rockit/dataRepository/checkingComplete',
                'Checking complete: {0} file(s) to upload, {1} file(s) to replace, and {2} file(s) to remove.',
                newFileIds.length,
                changedFileIds.length,
                removedRemoteFileIds.length
            )
        });

        for (const localId of newFileIds) {
            reportProgress?.({
                completedSteps,
                totalSteps,
                message: nls.localize('rockit/dataRepository/uploadingFile', 'Uploading {0}...', localId)
            });
            const uploadFile = this.requireUploadFile(localId, uploadCollection, uploadFilesByPath);
            const result = await this.uploadFile(baseUrl, repository.apiKey, exportTarget.persistentId, uploadFile);
            const remoteId = this.extractDataFileId(result.response);
            if (!remoteId) {
                throw new Error(nls.localize(
                    'rockit/dataRepository/fileUploadMissingDatabaseId',
                    "Dataverse uploaded '{0}' but did not return its database ID.",
                    localId
                ));
            }
            exportTarget.mapping[localId] = remoteId;
            completedSteps += 1;
        }

        for (const localId of changedFileIds) {
            reportProgress?.({
                completedSteps,
                totalSteps,
                message: nls.localize('rockit/dataRepository/replacingFile', 'Replacing {0}...', localId)
            });
            const previousRemoteId = exportTarget.mapping[localId];
            const uploadFile = this.requireUploadFile(localId, uploadCollection, uploadFilesByPath);
            const result = await this.replaceFile(baseUrl, repository.apiKey, previousRemoteId, uploadFile);
            exportTarget.mapping[localId] = this.extractDataFileId(result.response) ?? previousRemoteId;
            completedSteps += 1;
        }

        for (const remoteId of removedRemoteFileIds) {
            reportProgress?.({
                completedSteps,
                totalSteps,
                message: nls.localize('rockit/dataRepository/removingFile', 'Removing {0}...', remoteId)
            });
            await this.deleteFile(baseUrl, repository.apiKey, remoteId);
            this.removeMappedRemoteFileId(exportTarget.mapping, remoteId);
            completedSteps += 1;
        }

        reportProgress?.({
            completedSteps,
            totalSteps,
            message: nls.localize('rockit/dataRepository/synchronizingMetadataFile', 'Synchronizing ro-crate-metadata.json...')
        });
        const rewrittenMetadata = this.buildMappedMetadataUploadFile(
            uploadCollection.metadataCrate,
            exportTarget.mapping,
            uploadCollection.originalToUploadIds
        );
        const metadataReplacement = await this.replaceFile(
            baseUrl,
            repository.apiKey,
            metadataFileId,
            rewrittenMetadata
        );
        exportTarget.mapping['ro-crate-metadata.json'] =
            this.extractDataFileId(metadataReplacement.response) ?? metadataFileId;
        await this.saveEntityIdMapping(
            rootUri,
            exportTarget.exportLogEntry.mappingFile,
            exportTarget.mapping
        );
        await this.appendExportLog(rootUri, {
            target: this.buildPidTarget(exportTarget.persistentId) || exportTarget.persistentId,
            repository: baseUrl,
            mappingFile: exportTarget.exportLogEntry.mappingFile,
            syncType: 'update',
            syncedAt: new Date().toISOString(),
            collectionId: exportTarget.exportLogEntry.collectionId
        });
        const enabledMetadataBlocks = exportTarget.exportLogEntry.collectionId
            ? await this.fetchCollectionMetadataBlockAliases(
                baseUrl,
                repository.apiKey,
                exportTarget.exportLogEntry.collectionId
            )
            : undefined;
        await this.updateDatasetNativeMetadata(
            baseUrl,
            repository.apiKey,
            exportTarget.persistentId,
            crate,
            enabledMetadataBlocks
        );
        await this.addDatasetSemanticMetadata(
            baseUrl,
            repository.apiKey,
            exportTarget.persistentId,
            crate,
            true,
            enabledMetadataBlocks
        );
        reportProgress?.({
            completedSteps: totalSteps,
            totalSteps,
            message: nls.localize('rockit/dataRepository/synchronizationCompleteWithMetadata', 'Synchronization complete, including dataset metadata.')
        });

        return {
            persistentId: exportTarget.persistentId,
            target: this.buildPidTarget(exportTarget.persistentId) || exportTarget.persistentId,
            addedFileCount: newFileIds.length,
            replacedFileCount: changedFileIds.length,
            removedFileCount: removedRemoteFileIds.length,
            mappingFileName: exportTarget.exportLogEntry.mappingFile
        };
    }

    public async getDatasetCreationMetadataDefaults(): Promise<NativeDataverseDatasetMetadata> {
        const rootUri = this.getWorkspaceRoot();
        const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'));
        const graph = this.readGraph(crate);
        const root = graph.find(entity => entity['@id'] === './');
        if (!root) {
            return {
                title: '',
                authorNames: [],
                contactEmails: [],
                descriptions: [],
                subjects: []
            };
        }
        return {
            title: this.firstMeaningfulString(root.title, root.name) ?? '',
            authorNames: this.uniqueStrings(this.extractAuthors(root, graph)),
            contactEmails: this.uniqueStrings(this.extractContactEmails(root, graph)),
            descriptions: this.uniqueStrings(this.extractDescriptions(root, graph)),
            subjects: this.uniqueStrings(this.readStrings(root.subject))
        };
    }

    protected getWorkspaceRoot(): URI {
        const roots = this.workspaceService.tryGetRoots();
        const rootUri = roots?.[0]?.resource;
        if (!rootUri) {
            throw new Error(nls.localize('rockit/dataRepository/noWorkspace', 'No workspace is open.'));
        }
        return rootUri;
    }

    protected async readRoCrate(metadataUri: URI): Promise<RoCrate> {
        if (!(await this.fileService.exists(metadataUri))) {
            throw new Error(nls.localize(
                'rockit/dataRepository/metadataFileNotFound',
                'ro-crate-metadata.json was not found in the workspace root.'
            ));
        }
        const content = await this.fileService.readFile(metadataUri);
        try {
            return JSON.parse(content.value.toString()) as RoCrate;
        } catch (error) {
            throw new Error(nls.localize(
                'rockit/dataRepository/parseMetadataFailed',
                'Failed to parse ro-crate-metadata.json: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    protected buildDatasetCreationPayload(
        datasetMetadata: NativeDataverseDatasetMetadata,
        crate?: RoCrate,
        enabledMetadataBlocks?: Set<string>
    ): Record<string, unknown> {
        const title = datasetMetadata.title.trim();
        const authors = this.uniqueStrings(datasetMetadata.authorNames.map(value => value.trim()));
        const contactEmails = this.uniqueStrings(datasetMetadata.contactEmails.map(value => value.trim()));
        const descriptions = this.uniqueStrings(datasetMetadata.descriptions.map(value => value.trim()));
        const subjects = this.uniqueStrings(datasetMetadata.subjects.map(value => value.trim()));
        const missing: string[] = [];

        if (!title) missing.push(nls.localize('rockit/dataRepository/metadataTitle', 'Title'));
        if (!authors.length) missing.push(nls.localize('rockit/dataRepository/authorName', 'Author Name'));
        if (!contactEmails.length) missing.push(nls.localize('rockit/dataRepository/contactEmail', 'Point of Contact Email'));
        if (!descriptions.length) missing.push(nls.localize('rockit/dataRepository/descriptionText', 'Description Text'));
        if (!subjects.length) missing.push(nls.localize('rockit/dataRepository/subject', 'Subject'));

        if (missing.length) {
            throw new Error(nls.localize(
                'rockit/dataRepository/missingRequiredMetadata',
                'Cannot create Dataverse dataset. Missing required metadata: {0}.',
                missing.join(', ')
            ));
        }

        const fields: DataverseMetadataField[] = [
            this.primitiveField('title', false, title),
            this.compoundField('author', authors.map(authorName => ({
                authorName: this.primitiveField('authorName', false, authorName)
            }))),
            this.compoundField('datasetContact', contactEmails.map(datasetContactEmail => ({
                datasetContactEmail: this.primitiveField('datasetContactEmail', false, datasetContactEmail)
            }))),
            this.compoundField('dsDescription', descriptions.map(dsDescriptionValue => ({
                dsDescriptionValue: this.primitiveField('dsDescriptionValue', false, dsDescriptionValue)
            }))),
            {
                typeName: 'subject',
                typeClass: 'controlledVocabulary',
                multiple: true,
                value: subjects
            }
        ];

        const metadataBlocks: Record<string, { displayName: string; fields: DataverseMetadataField[] }> = {
            citation: {
                displayName: 'Citation Metadata',
                fields
            }
        };
        if (crate) {
            Object.assign(metadataBlocks, this.buildNativeDataverseMetadataBlocks(crate, enabledMetadataBlocks));
        }

        return {
            datasetVersion: {
                metadataBlocks
            }
        };
    }

    public async listExportTargets(
        repositories: DataRepositoryConfig[]
    ): Promise<Record<string, DataRepositoryExportTarget[]>> {
        const rootUri = this.getWorkspaceRoot();
        const currentDatasetName = await this.tryReadCurrentRootDatasetName(rootUri);
        const entries = await this.readExportLogEntries(rootUri.resolve('.rockit').resolve(EXPORT_LOG_FILE_NAME));
        const targetsByRepositoryId: Record<string, DataRepositoryExportTarget[]> = {};

        for (const repository of repositories) {
            const baseUrl = this.normalizeBaseUrl(repository.baseUrl);
            const latestByMappingFile = new Map<string, DataRepositoryExportTarget>();
            for (const entry of entries) {
                if (this.normalizeBaseUrl(entry.repository) !== baseUrl) {
                    continue;
                }
                const pid = this.extractPidFromTarget(entry.target);
                if (!pid || !entry.mappingFile) {
                    continue;
                }
                latestByMappingFile.set(entry.mappingFile, {
                    pid,
                    target: this.buildDataverseDatasetUrl(baseUrl, pid) ?? entry.target,
                    repository: entry.repository,
                    mappingFile: entry.mappingFile,
                    syncedAt: entry.syncedAt,
                    syncType: entry.syncType,
                    datasetName: currentDatasetName
                });
            }
            targetsByRepositoryId[repository.id] = Array.from(latestByMappingFile.values())
                .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt));
        }

        return targetsByRepositoryId;
    }

    protected buildNativeDataverseMetadataBlocks(
        crate: RoCrate,
        enabledMetadataBlocks?: Set<string>
    ): Record<string, { displayName: string; fields: DataverseMetadataField[] }> {
        const graph = this.readGraph(crate);
        const root = graph.find(entity => entity['@id'] === './');
        if (!root) {
            return {};
        }

        const blocks: Record<string, { displayName: string; fields: DataverseMetadataField[] }> = {};
        for (const [blockAlias, definition] of Object.entries(DATAVERSE_SEMANTIC_METADATA_BLOCKS)) {
            if (enabledMetadataBlocks && !enabledMetadataBlocks.has(blockAlias)) {
                continue;
            }
            const fields: DataverseMetadataField[] = [];
            for (const field of definition.fields) {
                const values = this.collectSemanticFieldValues(root, graph, field)
                    .map(value => this.normalizeDataverseSemanticValue(field, value))
                    .filter((value): value is string => !!value);
                const nativeField = this.nativePrimitiveField(field, values);
                if (nativeField) {
                    fields.push(nativeField);
                }
            }
            for (const [compoundField, childFields] of Object.entries(definition.compounds)) {
                const values = this.collectNativeCompoundValues(root, graph, compoundField, childFields);
                if (values.length) {
                    fields.push(this.compoundField(compoundField, values));
                }
            }
            if (fields.length) {
                blocks[blockAlias] = {
                    displayName: definition.displayName,
                    fields
                };
            }
        }
        return blocks;
    }

    protected buildNativeCitationMetadataFields(crate: RoCrate): DataverseMetadataField[] {
        const graph = this.readGraph(crate);
        const root = graph.find(entity => entity['@id'] === './');
        if (!root) {
            return [];
        }

        const fields: DataverseMetadataField[] = [];
        const title = this.firstMeaningfulString(root.title, root.name);
        if (title) {
            fields.push(this.primitiveField('title', false, title));
        }
        const authors = this.uniqueStrings(this.extractAuthors(root, graph));
        if (authors.length) {
            fields.push(this.compoundField('author', authors.map(authorName => ({
                authorName: this.primitiveField('authorName', false, authorName)
            }))));
        }
        const contactEmails = this.uniqueStrings(this.extractContactEmails(root, graph));
        if (contactEmails.length) {
            fields.push(this.compoundField('datasetContact', contactEmails.map(datasetContactEmail => ({
                datasetContactEmail: this.primitiveField('datasetContactEmail', false, datasetContactEmail)
            }))));
        }
        const descriptions = this.uniqueStrings(this.extractDescriptions(root, graph));
        if (descriptions.length) {
            fields.push(this.compoundField('dsDescription', descriptions.map(dsDescriptionValue => ({
                dsDescriptionValue: this.primitiveField('dsDescriptionValue', false, dsDescriptionValue)
            }))));
        }
        const subjects = this.uniqueStrings(this.readStrings(root.subject));
        if (subjects.length) {
            fields.push({
                typeName: 'subject',
                typeClass: 'controlledVocabulary',
                multiple: true,
                value: subjects
            });
        }
        return fields;
    }

    protected async addDatasetSemanticMetadata(
        baseUrl: string,
        apiKey: string | undefined,
        persistentId: string,
        crate: RoCrate,
        replace: boolean,
        enabledMetadataBlocks?: Set<string>
    ): Promise<void> {
        const payload = this.buildDatasetSemanticMetadataPayload(crate, enabledMetadataBlocks);
        if (!payload) {
            return;
        }

        const requestUrl = new URL('/api/datasets/:persistentId/metadata', `${baseUrl}/`);
        requestUrl.searchParams.set('persistentId', persistentId);
        if (replace) {
            requestUrl.searchParams.set('replace', 'true');
        }

        const headers: Record<string, string> = {
            accept: 'application/json',
            'content-type': 'application/ld+json'
        };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }

        const response = await fetch(requestUrl.toString(), {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload)
        });
        const responsePayload = await this.readResponsePayload(response);
        if (!response.ok || responsePayload.status === 'ERROR') {
            throw new Error(nls.localize(
                'rockit/dataRepository/semanticMetadataUpdateFailed',
                'Dataverse semantic metadata update failed ({0}): {1}',
                response.status,
                this.payloadSummary(responsePayload)
            ));
        }
    }

    protected async updateDatasetNativeMetadata(
        baseUrl: string,
        apiKey: string | undefined,
        persistentId: string,
        crate: RoCrate,
        enabledMetadataBlocks?: Set<string>
    ): Promise<void> {
        const currentData = await this.fetchDatasetVersionData(baseUrl, apiKey, persistentId, ':draft');
        const payload = this.buildDatasetNativeMetadataUpdatePayload(currentData, crate, enabledMetadataBlocks);
        if (!payload) {
            return;
        }

        const requestUrl = `${baseUrl}/api/datasets/:persistentId/versions/:draft?persistentId=${encodeURIComponent(persistentId)}`;
        const headers: Record<string, string> = {
            accept: 'application/json',
            'content-type': 'application/json'
        };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }

        const response = await fetch(requestUrl, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload)
        });
        const responsePayload = await this.readResponsePayload(response);
        if (!response.ok || responsePayload.status === 'ERROR') {
            throw new Error(nls.localize(
                'rockit/dataRepository/nativeMetadataUpdateFailed',
                'Dataverse native metadata update failed ({0}): {1}',
                response.status,
                this.payloadSummary(responsePayload)
            ));
        }
    }

    protected buildDatasetNativeMetadataUpdatePayload(
        currentData: Record<string, unknown>,
        crate: RoCrate,
        enabledMetadataBlocks?: Set<string>
    ): Record<string, unknown> | undefined {
        const metadataBlocks = currentData.metadataBlocks;
        if (!metadataBlocks || typeof metadataBlocks !== 'object' || Array.isArray(metadataBlocks)) {
            return undefined;
        }

        const updatePayload = { ...currentData };
        delete updatePayload.files;
        const updatedMetadataBlocks: Record<string, unknown> = { ...(metadataBlocks as Record<string, unknown>) };
        const localBlocks = this.buildNativeDataverseMetadataBlocks(crate, enabledMetadataBlocks);
        const localCitationFields = this.buildNativeCitationMetadataFields(crate);
        if (localCitationFields.length) {
            updatedMetadataBlocks.citation = this.mergeNativeMetadataBlockFields(
                updatedMetadataBlocks.citation,
                'Citation Metadata',
                localCitationFields
            );
        }
        for (const [blockAlias, block] of Object.entries(localBlocks)) {
            updatedMetadataBlocks[blockAlias] = block;
        }
        updatePayload.metadataBlocks = updatedMetadataBlocks;
        return updatePayload;
    }

    protected mergeNativeMetadataBlockFields(
        currentBlock: unknown,
        displayName: string,
        replacementFields: DataverseMetadataField[]
    ): { displayName: string; fields: DataverseMetadataField[] } {
        const current = currentBlock && typeof currentBlock === 'object' && !Array.isArray(currentBlock)
            ? currentBlock as Record<string, unknown>
            : {};
        const existingFields = Array.isArray(current.fields)
            ? current.fields.filter((field): field is DataverseMetadataField =>
                !!field
                && typeof field === 'object'
                && !Array.isArray(field)
                && typeof (field as DataverseMetadataField).typeName === 'string'
            )
            : [];
        const replacementFieldNames = new Set(replacementFields.map(field => field.typeName));
        return {
            displayName: this.readOptionalString(current.displayName) ?? displayName,
            fields: [
                ...existingFields.filter(field => !replacementFieldNames.has(field.typeName)),
                ...replacementFields
            ]
        };
    }

    protected async fetchCollectionMetadataBlockAliases(
        baseUrl: string,
        apiKey: string | undefined,
        collectionId: string
    ): Promise<Set<string> | undefined> {
        const requestUrl = `${baseUrl}/api/dataverses/${encodeURIComponent(collectionId)}/metadatablocks`;
        const headers: Record<string, string> = { accept: 'application/json' };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }
        try {
            const response = await fetch(requestUrl, { headers });
            const payload = await this.readResponsePayload(response);
            if (!response.ok || payload.status === 'ERROR') {
                console.warn(`Failed to retrieve Dataverse metadata blocks (${response.status}): ${this.payloadSummary(payload)}`);
                return undefined;
            }
            const aliases = this.collectMetadataBlockAliases(payload);
            aliases.add('citation');
            return aliases;
        } catch (error) {
            console.warn('Failed to retrieve Dataverse metadata blocks:', error);
            return undefined;
        }
    }

    protected collectMetadataBlockAliases(value: unknown): Set<string> {
        const aliases = new Set<string>();
        const visit = (node: unknown) => {
            if (!node || typeof node !== 'object') {
                return;
            }
            if (Array.isArray(node)) {
                node.forEach(visit);
                return;
            }
            const record = node as Record<string, unknown>;
            for (const key of ['name', 'metadataBlockName', 'blockName']) {
                const alias = this.readOptionalString(record[key]);
                if (alias) {
                    aliases.add(alias);
                }
            }
            Object.values(record).forEach(visit);
        };
        visit(value);
        return aliases;
    }

    protected buildDatasetSemanticMetadataPayload(
        crate: RoCrate,
        enabledMetadataBlocks?: Set<string>
    ): Record<string, unknown> | undefined {
        const graph = this.readGraph(crate);
        const root = graph.find(entity => entity['@id'] === './');
        if (!root) {
            return undefined;
        }

        const payload: Record<string, unknown> = {
            '@context': {
                citation: 'https://dataverse.org/schema/citation/',
                dcterms: 'http://purl.org/dc/terms/'
            }
        };

        const title = this.firstMeaningfulString(root.title, root.name);
        if (title) {
            payload['dcterms:title'] = title;
        }

        const subject = this.uniqueStrings(this.readStrings(root.subject));
        if (subject.length) {
            payload['dcterms:subject'] = subject.length === 1 ? subject[0] : subject;
        }

        const depositor = this.firstMeaningfulString(root.depositor);
        if (depositor) {
            payload['citation:depositor'] = depositor;
        }

        const dateOfDeposit = this.firstMeaningfulString(root.dateOfDeposit);
        if (dateOfDeposit) {
            payload['citation:dateOfDeposit'] = dateOfDeposit;
        }

        const authors = this.buildSemanticAuthors(root, graph);
        if (authors.length) {
            payload['citation:author'] = authors.length === 1 ? authors[0] : authors;
        }

        const contacts = this.buildSemanticDatasetContacts(root, graph);
        if (contacts.length) {
            payload['citation:datasetContact'] = contacts.length === 1 ? contacts[0] : contacts;
        }

        const descriptions = this.buildSemanticDescriptions(root, graph);
        if (descriptions.length) {
            payload['citation:dsDescription'] = descriptions.length === 1 ? descriptions[0] : descriptions;
        }

        this.addOptionalDataverseSemanticMetadata(payload, root, graph, enabledMetadataBlocks);

        return Object.keys(payload).length > 1 ? payload : undefined;
    }

    protected addOptionalDataverseSemanticMetadata(
        payload: Record<string, unknown>,
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        enabledMetadataBlocks?: Set<string>
    ): void {
        const context = payload['@context'] as Record<string, string>;
        for (const definition of Object.values(DATAVERSE_SEMANTIC_METADATA_BLOCKS)) {
            let hasBlockValue = false;
            for (const field of definition.fields) {
                const values = this.collectSemanticFieldValues(root, graph, field)
                    .map(value => this.normalizeDataverseSemanticValue(field, value))
                    .filter((value): value is string => !!value);
                if (!values.length) {
                    continue;
                }
                payload[`${definition.prefix}:${field}`] = values.length === 1 ? values[0] : values;
                hasBlockValue = true;
            }
            for (const [compoundField, childFields] of Object.entries(definition.compounds)) {
                const values = this.collectSemanticCompoundValues(root, graph, compoundField, childFields, definition.prefix);
                if (!values.length) {
                    continue;
                }
                payload[`${definition.prefix}:${compoundField}`] = values.length === 1 ? values[0] : values;
                hasBlockValue = true;
            }
            if (hasBlockValue) {
                context[definition.prefix] = definition.namespace;
            }
        }
    }

    protected collectSemanticFieldValues(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        field: string
    ): string[] {
        return this.uniqueStrings([
            ...this.readStrings(root[field]),
            ...graph
                .filter(entity => this.entityTypes(entity).includes(field))
                .flatMap(entity => this.readStrings(entity.value ?? entity.name ?? entity[field]))
        ]);
    }

    protected collectSemanticCompoundValues(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        compoundField: string,
        childFields: string[],
        prefix: string
    ): Array<Record<string, string | string[]>> {
        const references = this.resolveEntities(root[compoundField], graph);
        const typeMatches = graph.filter(entity => this.entityTypes(entity).includes(compoundField));
        const entities = this.uniqueEntitiesById([...references, ...typeMatches]);
        return entities
            .map(entity => {
                const value: Record<string, string | string[]> = {};
                for (const childField of childFields) {
                    const childValues = this.uniqueStrings(
                        this.readStrings(entity[childField])
                            .map(childValue => this.normalizeDataverseSemanticValue(childField, childValue))
                            .filter((childValue): childValue is string => !!childValue)
                    );
                    if (childValues.length) {
                        value[`${prefix}:${childField}`] = childValues.length === 1 ? childValues[0] : childValues;
                    }
                }
                return value;
            })
            .filter(value => Object.keys(value).length > 0);
    }

    protected collectNativeCompoundValues(
        root: RoCrateEntity,
        graph: RoCrateEntity[],
        compoundField: string,
        childFields: string[]
    ): Array<Record<string, DataverseMetadataField>> {
        const references = this.resolveEntities(root[compoundField], graph);
        const typeMatches = graph.filter(entity => this.entityTypes(entity).includes(compoundField));
        const entities = this.uniqueEntitiesById([...references, ...typeMatches]);
        return entities
            .map(entity => {
                const value: Record<string, DataverseMetadataField> = {};
                for (const childField of childFields) {
                    const childValues = this.readStrings(entity[childField])
                        .map(childValue => this.normalizeDataverseSemanticValue(childField, childValue))
                        .filter((childValue): childValue is string => !!childValue);
                    const nativeField = this.nativePrimitiveField(childField, childValues);
                    if (nativeField) {
                        value[childField] = nativeField;
                    }
                }
                return value;
            })
            .filter(value => Object.keys(value).length > 0);
    }

    protected nativePrimitiveField(typeName: string, values: string[]): DataverseMetadataField | undefined {
        const uniqueValues = this.uniqueStrings(values);
        if (!uniqueValues.length) {
            return undefined;
        }
        const multiple = DATAVERSE_MULTIPLE_VALUE_FIELDS.has(typeName);
        return this.primitiveField(
            typeName,
            multiple,
            multiple ? uniqueValues : uniqueValues[0]
        );
    }

    protected normalizeDataverseSemanticValue(fieldName: string, value: string): string | undefined {
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }
        if (/date$/i.test(fieldName)) {
            const dateOnly = trimmed.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
            return dateOnly?.[0] ?? trimmed;
        }
        return trimmed;
    }

    protected buildSemanticAuthors(root: RoCrateEntity, graph: RoCrateEntity[]): Array<Record<string, string>> {
        const linkedAuthors = this.resolveEntities(root.author, graph);
        const authorValues: RoCrateEntity[] = linkedAuthors.length
            ? linkedAuthors
            : this.readStrings(root.author)
                .filter(value => !this.looksLikeEntityId(value))
                .map(name => ({ name }));

        return authorValues
            .map(author => {
                const item: Record<string, string> = {};
                const name = this.firstMeaningfulString(author.authorName, author.name);
                if (name) {
                    item['citation:authorName'] = name;
                }
                const affiliation = this.firstMeaningfulString(author.authorAffiliation);
                if (affiliation) {
                    item['citation:authorAffiliation'] = affiliation;
                }
                const identifierScheme = this.firstMeaningfulString(author.authorIdentifierScheme);
                if (identifierScheme) {
                    item['citation:authorIdentifierScheme'] = identifierScheme;
                }
                const identifier = this.firstMeaningfulString(author.authorIdentifier);
                if (identifier) {
                    item['citation:authorIdentifier'] = identifier;
                }
                return item;
            })
            .filter(author => !!author['citation:authorName']);
    }

    protected buildSemanticDatasetContacts(root: RoCrateEntity, graph: RoCrateEntity[]): Array<Record<string, string>> {
        const linkedContacts = this.resolveEntities(root.datasetContact ?? root.contactPoint, graph);
        const contacts: RoCrateEntity[] = linkedContacts.length
            ? linkedContacts
            : this.readStrings(root.datasetContactEmail).map(email => ({ datasetContactEmail: email }));

        return contacts
            .map(contact => {
                const item: Record<string, string> = {};
                const name = this.firstMeaningfulString(contact.datasetContactName, contact.name);
                if (name) {
                    item['citation:datasetContactName'] = name;
                }
                const affiliation = this.firstMeaningfulString(contact.datasetContactAffiliation);
                if (affiliation) {
                    item['citation:datasetContactAffiliation'] = affiliation;
                }
                const email = this.firstMeaningfulString(contact.datasetContactEmail, contact.email);
                if (email) {
                    item['citation:datasetContactEmail'] = email;
                }
                return item;
            })
            .filter(contact => !!contact['citation:datasetContactEmail']);
    }

    protected buildSemanticDescriptions(root: RoCrateEntity, graph: RoCrateEntity[]): Array<Record<string, string>> {
        const linkedDescriptions = this.resolveEntities(root.dsDescription, graph);
        const descriptions: RoCrateEntity[] = linkedDescriptions.length
            ? linkedDescriptions
            : this.readStrings(root.description).map(description => ({ dsDescriptionValue: description }));

        return descriptions
            .map(description => {
                const item: Record<string, string> = {};
                const value = this.firstMeaningfulString(
                    description.dsDescriptionValue,
                    description.description,
                    description.name
                );
                if (value) {
                    item['citation:dsDescriptionValue'] = value;
                }
                const date = this.firstMeaningfulString(description.dsDescriptionDate);
                if (date) {
                    item['citation:dsDescriptionDate'] = date;
                }
                return item;
            })
            .filter(description => !!description['citation:dsDescriptionValue']);
    }

    protected async uploadRoCrateFiles(
        baseUrl: string,
        apiKey: string | undefined,
        persistentId: string,
        uploadFiles: NativeDataverseUploadFile[],
        reportProgress?: NativeDataverseExportProgressReporter,
        completedOffset = 1,
        totalSteps = uploadFiles.length + completedOffset
    ): Promise<NativeDataverseFileUploadResult[]> {
        const results: NativeDataverseFileUploadResult[] = [];
        for (const [index, file] of uploadFiles.entries()) {
            reportProgress?.({
                completedSteps: completedOffset + index,
                totalSteps,
                message: nls.localize('rockit/dataRepository/uploadingFile', 'Uploading {0}...', file.entryPath)
            });
            results.push(await this.uploadFile(baseUrl, apiKey, persistentId, file));
            reportProgress?.({
                completedSteps: completedOffset + index + 1,
                totalSteps,
                message: nls.localize('rockit/dataRepository/uploadedFile', 'Uploaded {0}.', file.entryPath)
            });
        }
        return results;
    }

    protected async collectRoCrateUploadFiles(
        crate: RoCrate,
        rootUri: URI
    ): Promise<NativeDataverseUploadCollection> {
        const uploadCrate = JSON.parse(JSON.stringify(crate)) as RoCrate;
        this.pruneUnreachableFileEntities(uploadCrate);
        const externalFiles = new Map<string, URI>();
        const uploadEntryPathByEntityId = new Map<string, string>();
        const localizedReferences = await localizeExternalRoCrateFileReferences(uploadCrate, {
            existingEntryPaths: collectRoCrateExportFileReferences(uploadCrate).map(reference => reference.entryPath),
            resolveLocalSource: async sources => {
                const resolved = await this.resolveFirstReadableFileSource(rootUri, sources.filter(source => source.kind === 'local'));
                return resolved ? { source: resolved.source, value: resolved.uri } : undefined;
            }
        });
        for (const reference of localizedReferences) {
            externalFiles.set(reference.importedPath, reference.resolvedSource);
            uploadEntryPathByEntityId.set(reference.reference.entityId, reference.importedPath);
        }

        const uploadFiles = new Map<string, NativeDataverseUploadFile>();

        for (const reference of collectRoCrateExportFileReferences(uploadCrate)) {
            uploadEntryPathByEntityId.set(reference.entityId, reference.entryPath);
            const externalUri = externalFiles.get(reference.entryPath);
            const resolved = externalUri
                ? { uri: externalUri }
                : await this.resolveFirstReadableFileSource(rootUri, reference.sources);
            if (!resolved) {
                console.warn('Skipping unresolved RO-Crate file reference during native Dataverse export:', reference.entityId);
                continue;
            }
            const content = await this.fileService.readFile(resolved.uri);
            uploadFiles.set(reference.entryPath, {
                entryPath: reference.entryPath,
                content: content.value.buffer
            });
        }

        return {
            files: Array.from(uploadFiles.values()).sort((a, b) => a.entryPath.localeCompare(b.entryPath)),
            metadataCrate: uploadCrate,
            uploadEntryPathByEntityId,
            originalToUploadIds: new Map(localizedReferences.map(reference => [
                reference.reference.entityId,
                reference.importedPath
            ]))
        };
    }

    protected async uploadFile(
        baseUrl: string,
        apiKey: string | undefined,
        persistentId: string,
        file: NativeDataverseUploadFile
    ): Promise<NativeDataverseFileUploadResult> {
        const { dir, base } = this.parsePosixPath(file.entryPath);
        const requestUrl = `${baseUrl}/api/v1/datasets/:persistentId/add?persistentId=${encodeURIComponent(persistentId)}`;
        const jsonData = {
            ...(dir ? { directoryLabel: dir } : {})
        };
        const form = new FormData();
        form.append('file', new Blob([file.content]), base);
        form.append('jsonData', JSON.stringify(jsonData));
        const headers: Record<string, string> = { accept: 'application/json' };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }

        const response = await fetch(requestUrl, {
            method: 'POST',
            headers,
            body: form
        });
        const payload = await this.readResponsePayload(response);
        if (!response.ok || payload.status === 'ERROR') {
            throw new Error(nls.localize(
                'rockit/dataRepository/dataverseFileUploadFailed',
                "Dataverse file upload failed for '{0}' ({1}): {2}",
                file.entryPath,
                response.status,
                this.payloadSummary(payload)
            ));
        }
        return {
            entryPath: file.entryPath,
            directoryLabel: dir || undefined,
            fileName: base,
            response: payload
        };
    }

    protected async replaceFile(
        baseUrl: string,
        apiKey: string | undefined,
        fileId: string,
        file: NativeDataverseUploadFile
    ): Promise<NativeDataverseFileUploadResult> {
        const { dir, base } = this.parsePosixPath(file.entryPath);
        const requestUrl = `${baseUrl}/api/files/${encodeURIComponent(fileId)}/replace`;
        const form = new FormData();
        form.append('file', new Blob([file.content]), base);
        form.append('jsonData', JSON.stringify({
            forceReplace: false,
            ...(dir ? { directoryLabel: dir } : {})
        }));
        const headers: Record<string, string> = { accept: 'application/json' };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }
        const response = await fetch(requestUrl, {
            method: 'POST',
            headers,
            body: form
        });
        const payload = await this.readResponsePayload(response);
        if (!response.ok || payload.status === 'ERROR') {
            throw new Error(nls.localize(
                'rockit/dataRepository/dataverseFileReplacementFailed',
                "Dataverse file replacement failed for '{0}' ({1}): {2}",
                file.entryPath,
                response.status,
                this.payloadSummary(payload)
            ));
        }
        return {
            entryPath: file.entryPath,
            directoryLabel: dir || undefined,
            fileName: base,
            response: payload
        };
    }

    protected async deleteFile(
        baseUrl: string,
        apiKey: string | undefined,
        fileId: string
    ): Promise<void> {
        const requestUrl = `${baseUrl}/api/files/${encodeURIComponent(fileId)}`;
        const headers: Record<string, string> = { accept: 'application/json' };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }
        const response = await fetch(requestUrl, {
            method: 'DELETE',
            headers
        });
        const payload = await this.readResponsePayload(response);
        if (!response.ok || payload.status === 'ERROR') {
            throw new Error(nls.localize(
                'rockit/dataRepository/dataverseFileDeletionFailed',
                'Dataverse file deletion failed for file {0} ({1}): {2}',
                fileId,
                response.status,
                this.payloadSummary(payload)
            ));
        }
    }

    protected async downloadRemoteMetadataFile(
        baseUrl: string,
        apiKey: string | undefined,
        fileId: string
    ): Promise<RoCrate> {
        const requestUrl = `${baseUrl}/api/access/datafile/${encodeURIComponent(fileId)}`;
        const headers: Record<string, string> = { accept: 'application/json' };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }
        const response = await fetch(requestUrl, { headers });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(nls.localize(
                'rockit/dataRepository/remoteMetadataDownloadFailed',
                'Failed to download remote ro-crate-metadata.json ({0}): {1}',
                response.status,
                text.slice(0, 500)
            ));
        }
        try {
            const parsed = JSON.parse(text) as RoCrate;
            if (!Array.isArray(parsed['@graph'])) {
                throw new Error(nls.localize(
                    'rockit/dataRepository/downloadedJsonMissingGraph',
                    'Downloaded JSON does not contain an @graph.'
                ));
            }
            return parsed;
        } catch (error) {
            throw new Error(nls.localize(
                'rockit/dataRepository/remoteMetadataInvalid',
                'Remote ro-crate-metadata.json is invalid: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    protected requireUploadFile(
        entityId: string,
        uploadCollection: NativeDataverseUploadCollection,
        uploadFilesByPath: Map<string, NativeDataverseUploadFile>
    ): NativeDataverseUploadFile {
        const entryPath = uploadCollection.uploadEntryPathByEntityId.get(entityId)
            ?? this.localCratePathFromEntityId(entityId);
        const uploadFile = entryPath ? uploadFilesByPath.get(entryPath) : undefined;
        if (!uploadFile) {
            throw new Error(nls.localize(
                'rockit/dataRepository/uploadContentUnavailable',
                "Cannot resolve local upload content for File entity '{0}'.",
                entityId
            ));
        }
        return uploadFile;
    }

    protected buildRewrittenMetadataUploadFile(
        metadataCrate: RoCrate,
        uploadedFiles: NativeDataverseFileUploadResult[]
    ): NativeDataverseUploadFile {
        const rewrittenCrate = JSON.parse(JSON.stringify(metadataCrate)) as RoCrate;
        const remoteFileMapping = this.buildRemoteFileMapping(rewrittenCrate, uploadedFiles);
        for (const entity of this.readGraph(rewrittenCrate)) {
            const oldId = this.readStrings(entity['@id'])[0];
            const remoteFile = oldId ? remoteFileMapping.get(oldId) : undefined;
            if (oldId && remoteFile) {
                if (remoteFile.label) {
                    entity.name = remoteFile.label;
                }
                if (remoteFile.directoryLabel) {
                    entity.directoryLabel = remoteFile.directoryLabel;
                } else {
                    delete entity.directoryLabel;
                }
                this.rewriteEntityIdReferences(rewrittenCrate, oldId, remoteFile.remoteId);
            }
        }
        return {
            entryPath: 'ro-crate-metadata.json',
            content: new TextEncoder().encode(`${JSON.stringify(rewrittenCrate, null, 2)}\n`)
        };
    }

    protected buildMappedMetadataUploadFile(
        metadataCrate: RoCrate,
        mapping: RoCrateEntityIdMapping,
        originalToUploadIds: Map<string, string>
    ): NativeDataverseUploadFile {
        const rewrittenCrate = JSON.parse(JSON.stringify(metadataCrate)) as RoCrate;
        const uploadMapping: RoCrateEntityIdMapping = { ...mapping };
        delete uploadMapping['ro-crate-metadata.json'];
        for (const [originalId, uploadId] of originalToUploadIds) {
            uploadMapping[uploadId] = mapping[originalId] ?? '';
            delete uploadMapping[originalId];
        }
        this.rewriteMappedEntityIdReferences(rewrittenCrate, uploadMapping);
        return {
            entryPath: 'ro-crate-metadata.json',
            content: new TextEncoder().encode(`${JSON.stringify(rewrittenCrate, null, 2)}\n`)
        };
    }

    protected buildEntityIdMapping(
        crate: RoCrate,
        uploadedFiles: NativeDataverseFileUploadResult[],
        uploadEntryPathByEntityId = new Map<string, string>()
    ): RoCrateEntityIdMapping {
        const remoteFileMapping = this.buildRemoteFileMapping(crate, uploadedFiles, uploadEntryPathByEntityId);
        const mapping: RoCrateEntityIdMapping = {};
        for (const entity of this.readGraph(crate)) {
            if (!this.shouldPersistEntityMapping(entity)) {
                continue;
            }
            const entityId = this.requireEntityId(entity);
            mapping[entityId] = remoteFileMapping.get(entityId)?.remoteId ?? '';
        }
        return Object.fromEntries(Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])));
    }

    protected buildRemoteFileMapping(
        crate: RoCrate,
        uploadedFiles: NativeDataverseFileUploadResult[],
        uploadEntryPathByEntityId = new Map<string, string>()
    ): Map<string, NativeDataverseRemoteFileReference> {
        const remoteFilesByHashAndDirectory = this.groupRemoteFilesByHashAndDirectory(uploadedFiles);
        const remoteFilesBySignature = this.groupRemoteFilesBySignature(uploadedFiles);
        const mapping = new Map<string, NativeDataverseRemoteFileReference>();
        for (const entity of this.readGraph(crate)) {
            if (!this.shouldPersistEntityMapping(entity)) {
                continue;
            }
            const entityId = this.requireEntityId(entity);
            const hashAndDirectorySignature = this.fileEntityHashAndDirectorySignature(entity, uploadEntryPathByEntityId);
            const hashDirectoryMatches = hashAndDirectorySignature ? remoteFilesByHashAndDirectory.get(hashAndDirectorySignature) ?? [] : [];
            const sourceSignature = this.fileEntityMappingSignature(entity, uploadEntryPathByEntityId);
            const signatureMatches = sourceSignature ? remoteFilesBySignature.get(sourceSignature) ?? [] : [];
            const matches = hashDirectoryMatches.length > 1 ? signatureMatches : hashDirectoryMatches;
            if (this.entityTypes(entity).includes('File') && matches.length === 1) {
                mapping.set(entityId, matches[0]);
            }
        }
        return mapping;
    }

    protected fileEntityHashAndDirectorySignature(entity: RoCrateEntity, uploadEntryPathByEntityId: Map<string, string>): string | undefined {
        const hash = this.fileEntityHash(entity);
        if (!hash) {
            return undefined;
        }
        return this.fileHashAndDirectorySignature(hash, this.sourceFileDirectoryLabel(entity, uploadEntryPathByEntityId));
    }

    protected fileEntityMappingSignature(entity: RoCrateEntity, uploadEntryPathByEntityId: Map<string, string>): string | undefined {
        const hash = this.fileEntityHash(entity);
        if (!hash) {
            return undefined;
        }
        return this.fileMappingSignature(
            hash,
            this.sourceFileDirectoryLabel(entity, uploadEntryPathByEntityId),
            this.sourceFileLabel(entity, uploadEntryPathByEntityId)
        );
    }

    protected sourceFileDirectoryLabel(entity: RoCrateEntity, uploadEntryPathByEntityId: Map<string, string>): string {
        const uploadEntryPath = uploadEntryPathByEntityId.get(this.requireEntityId(entity));
        if (uploadEntryPath) {
            return this.parsePosixPath(uploadEntryPath).dir;
        }
        const idPath = this.localCratePathFromEntityId(this.requireEntityId(entity));
        if (idPath) {
            return this.parsePosixPath(idPath).dir;
        }
        return this.readOptionalString(entity.directoryLabel) ?? '';
    }

    protected sourceFileLabel(entity: RoCrateEntity, uploadEntryPathByEntityId: Map<string, string>): string {
        const uploadEntryPath = uploadEntryPathByEntityId.get(this.requireEntityId(entity));
        if (uploadEntryPath) {
            return this.parsePosixPath(uploadEntryPath).base;
        }
        const idPath = this.localCratePathFromEntityId(this.requireEntityId(entity));
        if (idPath) {
            return this.parsePosixPath(idPath).base;
        }
        return this.readOptionalString(entity.name) ?? '';
    }

    protected fileEntityHash(entity: RoCrateEntity): string | undefined {
        return this.readOptionalString(entity.hash)?.toLowerCase().replace(/^md5:/, '');
    }

    protected fileHashAndDirectorySignature(md5: string, directoryLabel: string | undefined): string {
        return `${md5.toLowerCase().replace(/^md5:/, '')}\0${this.normalizeDirectoryLabel(directoryLabel ?? '')}`;
    }

    protected fileMappingSignature(md5: string, directoryLabel: string | undefined, label: string | undefined): string {
        return `${this.fileHashAndDirectorySignature(md5, directoryLabel)}\0${label ?? ''}`;
    }

    protected normalizeDirectoryLabel(value: string): string {
        return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    }

    protected groupRemoteFilesByHashAndDirectory(uploadedFiles: NativeDataverseFileUploadResult[]): Map<string, NativeDataverseRemoteFileReference[]> {
        const remoteFilesBySignature = new Map<string, NativeDataverseRemoteFileReference[]>();
        for (const file of uploadedFiles) {
            for (const reference of this.extractRemoteFileReferences(file.response)) {
                const signature = this.fileHashAndDirectorySignature(reference.md5, reference.directoryLabel);
                remoteFilesBySignature.set(signature, [...(remoteFilesBySignature.get(signature) ?? []), reference]);
            }
        }
        return remoteFilesBySignature;
    }

    protected groupRemoteFilesBySignature(uploadedFiles: NativeDataverseFileUploadResult[]): Map<string, NativeDataverseRemoteFileReference[]> {
        const remoteFilesBySignature = new Map<string, NativeDataverseRemoteFileReference[]>();
        for (const file of uploadedFiles) {
            for (const reference of this.extractRemoteFileReferences(file.response)) {
                const signature = this.fileMappingSignature(reference.md5, reference.directoryLabel, reference.label);
                remoteFilesBySignature.set(signature, [...(remoteFilesBySignature.get(signature) ?? []), reference]);
            }
        }
        return remoteFilesBySignature;
    }

    protected extractRemoteFileReferences(value: unknown): NativeDataverseRemoteFileReference[] {
        if (Array.isArray(value)) {
            return value.flatMap(item => this.extractRemoteFileReferences(item));
        }
        if (!value || typeof value !== 'object') {
            return [];
        }
        const record = value as Record<string, unknown>;
        const dataFile = record.dataFile;
        if (dataFile && typeof dataFile === 'object' && !Array.isArray(dataFile)) {
            const dataFileRecord = dataFile as Record<string, unknown>;
            const md5 = this.extractMd5(dataFileRecord);
            const remoteId = this.readOptionalString(dataFileRecord.id)
                ?? this.buildPidTarget(this.extractPersistentId(dataFileRecord));
            const directoryLabel = this.readOptionalString(dataFileRecord.directoryLabel)
                ?? this.readOptionalString(record.directoryLabel)
                ?? '';
            const label = this.readOptionalString(record.label)
                ?? this.readOptionalString(dataFileRecord.filename)
                ?? '';
            if (md5 && remoteId) {
                return [{ md5, directoryLabel: this.normalizeDirectoryLabel(directoryLabel), label, remoteId }];
            }
        }
        return Object.values(record).flatMap(child => this.extractRemoteFileReferences(child));
    }

    protected extractMd5(record: Record<string, unknown>): string | undefined {
        const md5 = this.readOptionalString(record.md5);
        if (md5) {
            return md5.toLowerCase().replace(/^md5:/, '');
        }
        const checksum = record.checksum;
        if (checksum && typeof checksum === 'object' && !Array.isArray(checksum)) {
            const checksumRecord = checksum as Record<string, unknown>;
            const type = this.readOptionalString(checksumRecord.type)?.toLowerCase();
            const value = this.readOptionalString(checksumRecord.value);
            if (type === 'md5' && value) {
                return value.toLowerCase().replace(/^md5:/, '');
            }
        }
        return undefined;
    }

    protected extractDataFileId(value: unknown): string | undefined {
        if (Array.isArray(value)) {
            return value.map(item => this.extractDataFileId(item)).find((item): item is string => !!item);
        }
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        const record = value as Record<string, unknown>;
        const dataFile = record.dataFile;
        if (dataFile && typeof dataFile === 'object' && !Array.isArray(dataFile)) {
            const id = this.readOptionalString((dataFile as Record<string, unknown>).id);
            if (id) {
                return id;
            }
        }
        return Object.values(record)
            .map(child => this.extractDataFileId(child))
            .find((item): item is string => !!item);
    }

    protected shouldPersistEntityMapping(entity: RoCrateEntity): boolean {
        const id = this.requireEntityId(entity);
        const types = this.entityTypes(entity);
        return id !== './' && types.includes('File');
    }

    protected rewriteEntityIdReferences(value: unknown, oldId: string, newId: string): void {
        if (Array.isArray(value)) {
            for (const item of value) {
                this.rewriteEntityIdReferences(item, oldId, newId);
            }
            return;
        }
        if (!value || typeof value !== 'object') {
            return;
        }
        const record = value as Record<string, unknown>;
        for (const [key, child] of Object.entries(record)) {
            if (key === '@id' && child === oldId) {
                record[key] = newId;
                continue;
            }
            this.rewriteEntityIdReferences(child, oldId, newId);
        }
    }

    protected rewriteMappedEntityIdReferences(
        value: unknown,
        mapping: RoCrateEntityIdMapping
    ): void {
        if (Array.isArray(value)) {
            for (const item of value) {
                this.rewriteMappedEntityIdReferences(item, mapping);
            }
            return;
        }
        if (!value || typeof value !== 'object') {
            return;
        }
        const record = value as Record<string, unknown>;
        for (const [key, child] of Object.entries(record)) {
            if (key === '@id' && typeof child === 'string' && mapping[child]) {
                record[key] = mapping[child];
                continue;
            }
            this.rewriteMappedEntityIdReferences(child, mapping);
        }
    }

    protected requireEntityId(entity: RoCrateEntity): string {
        const id = this.readStrings(entity['@id'])[0];
        if (!id) {
            throw new Error(nls.localize(
                'rockit/dataRepository/entityMappingMissingId',
                'Dataverse dataset created, but an entity mapping file could not be created. An RO-Crate entity has no @id.'
            ));
        }
        return id;
    }

    protected readOptionalString(value: unknown): string | undefined {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed ? trimmed : undefined;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
        return undefined;
    }

    protected extractPersistentId(value: unknown): string | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        if (Array.isArray(value)) {
            return value.map(item => this.extractPersistentId(item)).find((item): item is string => !!item);
        }
        const record = value as Record<string, unknown>;
        for (const key of ['persistentId', 'global_id', 'globalId', 'pid']) {
            const raw = record[key];
            if (typeof raw === 'string' && raw.trim()) {
                return raw.trim();
            }
        }
        for (const child of Object.values(record)) {
            const nested = this.extractPersistentId(child);
            if (nested) {
                return nested;
            }
        }
        return undefined;
    }

    protected async createUniqueMappingFileName(rootUri: URI): Promise<string> {
        const rockitUri = rootUri.resolve('.rockit');
        if (!(await this.fileService.exists(rockitUri))) {
            await this.fileService.createFolder(rockitUri);
        }
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const fileName = `${this.randomId(16)}.json`;
            if (!(await this.fileService.exists(rockitUri.resolve(fileName)))) {
                return fileName;
            }
        }
        return `${Date.now()}-${this.randomId(16)}.json`;
    }

    protected async resolveExistingExportTarget(
        rootUri: URI,
        repository: DataRepositoryConfig,
        selectedTarget?: DataRepositoryExportTarget
    ): Promise<NativeDataverseExportTarget | undefined> {
        const entries = await this.readExportLogEntries(rootUri.resolve('.rockit').resolve(EXPORT_LOG_FILE_NAME));
        const baseUrl = this.normalizeBaseUrl(repository.baseUrl);
        const matchingEntries = [...entries]
            .reverse()
            .filter(candidate => this.normalizeBaseUrl(candidate.repository) === baseUrl && !!this.extractPidFromTarget(candidate.target));
        const selectedEntry = selectedTarget
            ? matchingEntries.find(candidate =>
                candidate.mappingFile === selectedTarget.mappingFile
                && this.normalizePid(this.extractPidFromTarget(candidate.target)) === this.normalizePid(selectedTarget.pid)
            )
            : undefined;
        const selectedFallbackEntry: ExportLogEntry | undefined = selectedTarget && !selectedEntry
            ? {
                target: selectedTarget.target,
                repository: selectedTarget.repository,
                mappingFile: selectedTarget.mappingFile,
                syncType: selectedTarget.syncType,
                syncedAt: selectedTarget.syncedAt
            }
            : undefined;
        const entry = selectedEntry ?? selectedFallbackEntry ?? matchingEntries[0];
        if (!entry) {
            return undefined;
        }
        const persistentId = this.extractPidFromTarget(entry.target);
        const mapping = await this.readEntityIdMapping(rootUri.resolve('.rockit').resolve(entry.mappingFile));
        if (!persistentId || !mapping) {
            return undefined;
        }
        return {
            persistentId,
            exportLogEntry: entry,
            mapping
        };
    }

    protected async fetchDraftFileRecords(
        baseUrl: string,
        apiKey: string | undefined,
        persistentId: string
    ): Promise<NativeDataverseDraftFileRecord[]> {
        const requestUrl = `${baseUrl}/api/datasets/:persistentId/versions/:draft?persistentId=${encodeURIComponent(persistentId)}`;
        const headers: Record<string, string> = { accept: 'application/json' };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }
        const response = await fetch(requestUrl, { headers });
        const payload = await this.readResponsePayload(response);
        if (!response.ok || payload.status === 'ERROR') {
            throw new Error(nls.localize(
                'rockit/dataRepository/draftFilesFetchFailed',
                'Failed to retrieve Dataverse draft files ({0}): {1}',
                response.status,
                this.payloadSummary(payload)
            ));
        }
        return this.extractDraftFileRecords(payload);
    }

    protected async fetchDatasetVersionData(
        baseUrl: string,
        apiKey: string | undefined,
        persistentId: string,
        version: ':draft' | ':latest'
    ): Promise<Record<string, unknown>> {
        const requestUrl = `${baseUrl}/api/datasets/:persistentId/versions/${version}?persistentId=${encodeURIComponent(persistentId)}`;
        const headers: Record<string, string> = { accept: 'application/json' };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }
        const response = await fetch(requestUrl, { headers });
        const payload = await this.readResponsePayload(response);
        if (!response.ok || payload.status === 'ERROR') {
            throw new Error(nls.localize(
                'rockit/dataRepository/datasetMetadataFetchFailed',
                'Failed to retrieve Dataverse dataset metadata ({0}): {1}',
                response.status,
                this.payloadSummary(payload)
            ));
        }
        const data = payload.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error(nls.localize(
                'rockit/dataRepository/datasetMetadataMissingData',
                'Dataverse dataset metadata response did not contain a data object.'
            ));
        }
        return data;
    }

    protected extractDraftFileRecords(value: unknown): NativeDataverseDraftFileRecord[] {
        if (Array.isArray(value)) {
            return value.flatMap(item => this.extractDraftFileRecords(item));
        }
        if (!value || typeof value !== 'object') {
            return [];
        }
        const record = value as Record<string, unknown>;
        const dataFile = record.dataFile;
        if (dataFile && typeof dataFile === 'object' && !Array.isArray(dataFile)) {
            const dataFileRecord = dataFile as Record<string, unknown>;
            const id = this.readOptionalString(dataFileRecord.id);
            const label = this.readOptionalString(record.label)
                ?? this.readOptionalString(dataFileRecord.filename);
            if (id && label) {
                return [{
                    id,
                    label,
                    persistentId: this.extractPersistentId(dataFileRecord)
                }];
            }
        }
        return Object.values(record).flatMap(child => this.extractDraftFileRecords(child));
    }

    protected normalizeMappingToDatabaseIds(
        mapping: RoCrateEntityIdMapping,
        files: NativeDataverseDraftFileRecord[]
    ): void {
        for (const [localId, remoteId] of Object.entries(mapping)) {
            if (/^\d+$/.test(remoteId)) {
                continue;
            }
            const match = files.find(file =>
                file.persistentId === remoteId ||
                this.buildPidTarget(file.persistentId) === remoteId
            );
            if (match) {
                mapping[localId] = match.id;
            }
        }
    }

    protected normalizeLocalizedMappingKeys(
        mapping: RoCrateEntityIdMapping,
        originalToUploadIds: Map<string, string>
    ): void {
        for (const [originalId, uploadId] of originalToUploadIds) {
            if (!mapping[originalId] && mapping[uploadId]) {
                mapping[originalId] = mapping[uploadId];
            }
            delete mapping[uploadId];
        }
    }

    protected removeMappedRemoteFileId(mapping: RoCrateEntityIdMapping, remoteFileId: string): void {
        for (const [localId, mappedRemoteId] of Object.entries(mapping)) {
            if (mappedRemoteId === remoteFileId) {
                delete mapping[localId];
            }
        }
    }

    protected async saveEntityIdMapping(rootUri: URI, mappingFileName: string, mapping: RoCrateEntityIdMapping): Promise<void> {
        const rockitUri = rootUri.resolve('.rockit');
        if (!(await this.fileService.exists(rockitUri))) {
            await this.fileService.createFolder(rockitUri);
        }
        await this.fileService.writeFile(
            rockitUri.resolve(mappingFileName),
            BinaryBuffer.fromString(`${JSON.stringify(mapping, null, 2)}\n`)
        );
    }

    protected async readEntityIdMapping(mappingUri: URI): Promise<RoCrateEntityIdMapping | undefined> {
        if (!(await this.fileService.exists(mappingUri))) {
            return undefined;
        }
        try {
            const parsed = JSON.parse((await this.fileService.readFile(mappingUri)).value.toString());
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return undefined;
            }
            return Object.fromEntries(
                Object.entries(parsed)
                    .filter((entry): entry is [string, string] =>
                        typeof entry[0] === 'string' && typeof entry[1] === 'string'
                    )
            );
        } catch (error) {
            console.warn('Failed to parse native Dataverse mapping file.', error);
            return undefined;
        }
    }

    protected async appendExportLog(rootUri: URI, entry: ExportLogEntry): Promise<void> {
        const rockitUri = rootUri.resolve('.rockit');
        if (!(await this.fileService.exists(rockitUri))) {
            await this.fileService.createFolder(rockitUri);
        }
        const logUri = rockitUri.resolve(EXPORT_LOG_FILE_NAME);
        const entries = await this.readExportLogEntries(logUri);
        entries.push(entry);
        await this.fileService.writeFile(logUri, BinaryBuffer.fromString(`${JSON.stringify(entries, null, 2)}\n`));
    }

    protected async readExportLogEntries(logUri: URI): Promise<ExportLogEntry[]> {
        if (!(await this.fileService.exists(logUri))) {
            return [];
        }
        try {
            const parsed = JSON.parse((await this.fileService.readFile(logUri)).value.toString());
            return Array.isArray(parsed) ? parsed.filter((entry): entry is ExportLogEntry => !!entry && typeof entry === 'object' && !Array.isArray(entry)) : [];
        } catch (error) {
            console.warn('Failed to parse .rockit/export-log.json; starting a new export log.', error);
            return [];
        }
    }

    protected buildPidTarget(pid?: string): string | undefined {
        if (!pid) {
            return undefined;
        }
        const trimmed = pid.trim();
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }
        if (/^hdl:/i.test(trimmed)) {
            return `https://hdl.handle.net/${trimmed.slice('hdl:'.length)}`;
        }
        return trimmed;
    }

    protected buildDataverseDatasetUrl(baseUrl: string, pid?: string): string | undefined {
        if (!pid) {
            return undefined;
        }
        const target = this.buildPidTarget(pid);
        if (!target) {
            return undefined;
        }
        if (/^https?:\/\//i.test(target)) {
            return target;
        }
        return `${baseUrl}/dataset.xhtml?persistentId=${encodeURIComponent(target)}`;
    }

    protected extractPidFromTarget(target: string): string | undefined {
        const trimmed = target.trim();
        if (/^(hdl|doi):/i.test(trimmed)) {
            return trimmed;
        }
        try {
            const url = new URL(trimmed);
            const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            if (url.hostname.toLowerCase() === 'hdl.handle.net' && path) {
                return `hdl:${path}`;
            }
            if (url.hostname.toLowerCase() === 'doi.org' && path) {
                return `doi:${path}`;
            }
            const persistentId = url.searchParams.get('persistentId');
            return persistentId?.trim() || undefined;
        } catch {
            return undefined;
        }
    }

    protected normalizePid(value: string | undefined): string | undefined {
        return value?.trim().replace(/^persistentId=/i, '').toLowerCase();
    }

    protected randomId(length: number): string {
        const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const bytes = new Uint8Array(length);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
    }

    protected async resolveFirstReadableFileSource(
        rootUri: URI,
        sources: readonly RoCrateExportFileSource[]
    ): Promise<{ uri: URI; source: RoCrateExportFileSource } | undefined> {
        for (const source of sources) {
            const uri = source.kind === 'local' ? this.toLocalFileUri(source.value) : rootUri.resolve(source.value);
            if (!uri) {
                continue;
            }
            try {
                if (!(await this.fileService.exists(uri))) {
                    continue;
                }
                const stat = await this.fileService.resolve(uri);
                if (!stat.isDirectory) {
                    return { uri, source };
                }
            } catch (error) {
                console.warn('Failed to resolve RO-Crate file reference:', source.value, error);
            }
        }
        return undefined;
    }

    protected toLocalFileUri(value: string): URI | undefined {
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }
        if (/^file:\/\//i.test(trimmed)) {
            return new URI(trimmed);
        }
        if (/^[a-zA-Z]:[\\/]/.test(trimmed) || /^[/\\]{2}[^/\\]/.test(trimmed) || /^\/[^/]/.test(trimmed)) {
            return new URI(FileUri.create(trimmed).toString());
        }
        return undefined;
    }

    protected entityTypes(entity: RoCrateEntity): string[] {
        return this.readStrings(entity['@type']);
    }

    protected localCratePathFromEntityId(id: string): string | undefined {
        if (!id || id === './' || id.startsWith('#')) {
            return undefined;
        }
        let relativePath = id;
        if (id.startsWith('file://./')) {
            relativePath = id.slice('file://./'.length);
        } else if (id.startsWith('./')) {
            relativePath = id.slice(2);
        } else if (id.includes(':')) {
            return undefined;
        }
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        return normalized && !normalized.split('/').includes('..') ? normalized : undefined;
    }

    protected parsePosixPath(value: string): { dir: string; base: string } {
        const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
        const index = normalized.lastIndexOf('/');
        return index === -1
            ? { dir: '', base: normalized }
            : { dir: normalized.slice(0, index), base: normalized.slice(index + 1) };
    }

    protected extractAuthors(root: RoCrateEntity, graph: RoCrateEntity[]): string[] {
        return this.resolveEntities(root.author, graph)
            .flatMap(author => this.readStrings(author.authorName ?? author.name))
            .concat(this.readStrings(root.author).filter(value => !this.looksLikeEntityId(value)));
    }

    protected getRootDatasetName(crate: RoCrate): string | undefined {
        const root = this.readGraph(crate).find(entity => entity['@id'] === './');
        return root ? this.firstMeaningfulString(root.title, root.name) : undefined;
    }

    protected async tryReadCurrentRootDatasetName(rootUri: URI): Promise<string | undefined> {
        try {
            return this.getRootDatasetName(await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json')));
        } catch {
            return undefined;
        }
    }

    protected extractContactEmails(root: RoCrateEntity, graph: RoCrateEntity[]): string[] {
        const linkedContacts = this.resolveEntities(root.datasetContact ?? root.contactPoint, graph);
        return this.uniqueStrings([
            ...linkedContacts.flatMap(contact => this.readStrings(contact.datasetContactEmail ?? contact.email)),
            ...this.readStrings(root.datasetContactEmail)
        ]);
    }

    protected extractDescriptions(root: RoCrateEntity, graph: RoCrateEntity[]): string[] {
        const linkedDescriptions = this.resolveEntities(root.dsDescription, graph);
        return this.uniqueStrings(
            linkedDescriptions.flatMap(description => this.readStrings(description.dsDescriptionValue ?? description.description ?? description.name))
        );
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
        return [];
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

    protected readGraph(crate: RoCrate): RoCrateEntity[] {
        const graph = crate['@graph'];
        return Array.isArray(graph)
            ? graph.filter((entity): entity is RoCrateEntity => !!entity && typeof entity === 'object' && !Array.isArray(entity))
            : [];
    }

    protected pruneUnreachableFileEntities(crate: RoCrate): void {
        const graph = crate['@graph'];
        if (!Array.isArray(graph)) {
            return;
        }
        const reachableIds = this.collectReachableEntityIds(crate);
        crate['@graph'] = graph.filter(entity =>
            !entity
            || typeof entity !== 'object'
            || Array.isArray(entity)
            || !this.entityTypes(entity as RoCrateEntity).includes('File')
            || reachableIds.has(this.requireEntityId(entity as RoCrateEntity))
        );
    }

    protected collectReachableEntityIds(crate: RoCrate): Set<string> {
        const graph = this.readGraph(crate);
        const entitiesById = new Map(graph.map(entity => [this.requireEntityId(entity), entity]));
        const reachableIds = new Set<string>();
        const visit = (id: string) => {
            if (reachableIds.has(id)) {
                return;
            }
            const entity = entitiesById.get(id);
            if (!entity) {
                return;
            }
            reachableIds.add(id);
            for (const childId of this.readEntityReferenceIds(entity.hasPart)) {
                visit(childId);
            }
        };
        visit('./');
        return reachableIds;
    }

    protected readEntityReferenceIds(value: unknown): string[] {
        if (Array.isArray(value)) {
            return this.uniqueStrings(value.flatMap(item => this.readEntityReferenceIds(item)));
        }
        if (value && typeof value === 'object') {
            return this.readStrings((value as RoCrateEntity)['@id']);
        }
        return this.readStrings(value);
    }

    protected primitiveField(typeName: string, multiple: boolean, value: unknown): DataverseMetadataField {
        return { typeName, typeClass: 'primitive', multiple, value };
    }

    protected compoundField(typeName: string, values: Array<Record<string, DataverseMetadataField>>): DataverseMetadataField {
        return {
            typeName,
            typeClass: 'compound',
            multiple: true,
            value: values
        };
    }

    protected firstMeaningfulString(...values: unknown[]): string | undefined {
        return values
            .flatMap(value => this.readStrings(value))
            .find(value => value !== './' && value !== '.');
    }

    protected readStrings(value: unknown): string[] {
        if (typeof value === 'string') {
            return value.trim() ? [value.trim()] : [];
        }
        if (Array.isArray(value)) {
            return this.uniqueStrings(value.flatMap(item => this.readStrings(item)));
        }
        return [];
    }

    protected uniqueStrings(values: string[]): string[] {
        return Array.from(new Set(values.filter(value => value.trim() !== '')));
    }

    protected looksLikeEntityId(value: string): boolean {
        return value.startsWith('#') || value.startsWith('./') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
    }

    protected normalizeBaseUrl(baseUrl: string): string {
        const normalized = baseUrl.trim().replace(/\/+$/, '');
        if (!normalized) {
            throw new Error(nls.localize(
                'rockit/dataRepository/emptyRepositoryBaseUrl',
                'Repository base URL is empty.'
            ));
        }
        return normalized.endsWith('/api/v1') ? normalized.slice(0, -'/api/v1'.length) : normalized;
    }

    protected async readResponsePayload(response: Response): Promise<NativeDataverseResponse> {
        const text = await response.text();
        if (!text) {
            return {};
        }
        try {
            return JSON.parse(text) as NativeDataverseResponse;
        } catch {
            return { message: text };
        }
    }

    protected payloadSummary(payload: NativeDataverseResponse): string {
        return payload.message || JSON.stringify(payload).slice(0, 500);
    }
}
