import { BaseWidget } from '@theia/core/lib/browser';
import type { Message, StatefulWidget } from '@theia/core/lib/browser';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { MessageService } from '@theia/core/lib/common/message-service';
import { URI } from '@theia/core/lib/common/uri';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { Button, Input, Modal } from 'antd';
import type { Key } from 'antd/es/table/interface';
import { inject, injectable } from 'inversify';
import * as React from 'react';
import type { Root } from 'react-dom/client';

import { CedarTemplateToDescriboProfileConverter } from './cedar-converter';
import { SchemaTable } from './schema-table';
import type { SchemaInfo } from './types';
import '../../src/browser/style/index.css';

export const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager';
export const METADATA_SCHEMA_MANAGER_LABEL = 'Metadata Schema Manager';

export const SCHEMA_FIELD_NAME = 'schema:name';
export const SCHEMA_FIELD_VERSION = 'pav:version';
export const SCHEMA_FIELD_ID = '@id';

function toFileUri(path: string): URI {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.match(/^[a-zA-Z]:/)) {
        return new URI('file:///' + normalized);
    } else {
        return new URI('file://' + normalized);
    }
}

@injectable()
export class MetadataSchemaManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = METADATA_SCHEMA_MANAGER_WIDGET_ID;
    static readonly LABEL = METADATA_SCHEMA_MANAGER_LABEL;

    protected readonly fileService: FileService;
    protected readonly fileDialogService: FileDialogService;
    protected readonly messageService: MessageService;
    protected readonly envVariablesServer: EnvVariablesServer;

    private readonly converter = new CedarTemplateToDescriboProfileConverter();

    protected schemas: SchemaInfo[] = [];
    protected isLoading = true;
    protected selectedSchemaKeys: Key[] = [];
    
    private reactRoot: Root | undefined;

    constructor(
        @inject(FileService) fileService: FileService,
        @inject(FileDialogService) fileDialogService: FileDialogService,
        @inject(MessageService) messageService: MessageService,
        @inject(EnvVariablesServer) envVariablesServer: EnvVariablesServer
    ) {
        super();
        this.fileService = fileService;
        this.fileDialogService = fileDialogService;
        this.messageService = messageService;
        this.envVariablesServer = envVariablesServer;

        this.id = METADATA_SCHEMA_MANAGER_WIDGET_ID;
        this.title.label = METADATA_SCHEMA_MANAGER_LABEL;
        this.title.caption = METADATA_SCHEMA_MANAGER_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-file-code';
    }

    // --- Helpers ---

    protected async getAromaRootUri(): Promise<URI | null> {
        const result = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
        const pathString = result?.value;
        if (!pathString) return null;
        return toFileUri(pathString);
    }

    protected async getCedarDir(type: 'local' | 'remote'): Promise<URI | null> {
        const root = await this.getAromaRootUri();
        if (!root) return null;
        return root.resolve(`metadata-schemas/cedar/${type}`);
    }

    protected async getRoCrateDir(type: 'local' | 'remote'): Promise<URI | null> {
        const root = await this.getAromaRootUri();
        if (!root) return null;
        return root.resolve(`metadata-schemas/ro-crate/${type}`);
    }

    // --- Core Logic ---

    protected async loadSchemas(): Promise<void> {
        this.isLoading = true;
        this.schemas = [];
        this.selectedSchemaKeys = []; // Reset selection on reload
        this.update();

        try {
            for (const source of ['local', 'remote'] as const) {
                const cedarDir = await this.getCedarDir(source);
                if (!cedarDir || !await this.fileService.exists(cedarDir)) continue;

                const stat = await this.fileService.resolve(cedarDir);
                if (!stat?.children) continue;

                for (const file of stat.children) {
                    if (!file.name.endsWith('.json')) continue;

                    try {
                        const content = await this.fileService.read(file.resource);
                        const parsed = JSON.parse(content.value);

                        const schemaName = parsed[SCHEMA_FIELD_NAME];
                        const schemaVersion = parsed[SCHEMA_FIELD_VERSION];
                        const schemaId = parsed[SCHEMA_FIELD_ID];

                        if (!schemaName || !schemaVersion) continue;

                        this.schemas.push({
                            name: schemaName,
                            version: schemaVersion,
                            reference: schemaId || '', 
                            source,
                            path: file.resource.toString()
                        });
                    } catch {
                        console.warn(`Failed to parse JSON: ${file.name}`);
                    }
                }
            }
        } catch (err) {
            this.messageService.error(`Error loading schemas: ${err}`);
        }

        this.isLoading = false;
        this.update();
    }

    protected onSelectionChange = (selectedRowKeys: Key[]): void => {
        this.selectedSchemaKeys = selectedRowKeys;
        this.update();
    };

    protected async deleteSchemas(cedarPaths: string[]): Promise<void> {
        if (cedarPaths.length === 0) return;

        Modal.confirm({
            title: 'Confirm Deletion',
            content: `Delete ${cedarPaths.length} schema? (Deletes both CEDAR and RO-Crate files)`,
            okText: 'Yes',
            cancelText: 'Cancel',
            onOk: async () => {
                this.isLoading = true;
                this.update();
                let successfulDeletes = 0;

                for (const pathStr of cedarPaths) {
                    try {
                        // 1. Delete CEDAR File (Source)
                        const cedarUri = new URI(pathStr);
                        await this.fileService.delete(cedarUri);

                        // 2. Delete RO-Crate File (Converted)
                        const roCratePathStr = pathStr.replace('/metadata-schemas/cedar/', '/metadata-schemas/ro-crate/');
                        const roCrateUri = new URI(roCratePathStr);

                        if (await this.fileService.exists(roCrateUri)) {
                            await this.fileService.delete(roCrateUri);
                        }

                        successfulDeletes++;
                    } catch (err) {
                        this.messageService.error(`Failed to delete: ${err}`);
                    }
                }
                if (successfulDeletes > 0) this.messageService.info(`Deleted ${successfulDeletes} schema(s).`);
                await this.loadSchemas();
            }
        });
    }

    // --- Import Processor ---

    private async processImport(
        fileName: string, 
        rawContent: string, 
        type: 'local' | 'remote',
        progress: any
    ): Promise<boolean> {
        try {
            progress.report({ message: 'Validating Schema...', work: { done: 10, total: 100 } });
            
            let parsedRaw: any;
            try {
                parsedRaw = JSON.parse(rawContent);
            } catch (e) {
                throw new Error('Invalid JSON format');
            }

            const schemaName = parsedRaw[SCHEMA_FIELD_NAME];
            const schemaVersion = parsedRaw[SCHEMA_FIELD_VERSION];

            if (!schemaName || !schemaVersion) {
                throw new Error(`Missing required fields: ${SCHEMA_FIELD_NAME} or ${SCHEMA_FIELD_VERSION}`);
            }

            progress.report({ message: 'Checking Directories...', work: { done: 30, total: 100 } });
            const cedarDir = await this.getCedarDir(type);
            const roCrateDir = await this.getRoCrateDir(type);

            if (!cedarDir || !roCrateDir) {
                throw new Error('Configuration error: Directories not found');
            }

            const cedarUri = cedarDir.resolve(fileName);
            const roCrateUri = roCrateDir.resolve(fileName);

            if (await this.fileService.exists(cedarUri)) {
                console.log(`Overwriting existing schema: ${fileName}`);
            }

            progress.report({ message: 'Converting to RO-Crate Profile...', work: { done: 70, total: 100 } });
            let convertedContent: string;
            try {
                convertedContent = this.converter.processCedarTemplate(rawContent);
            } catch (convErr) {
                throw new Error(`Conversion Failed: ${convErr}`);
            }

            progress.report({ message: 'Saving Files...', work: { done: 90, total: 100 } });
            await this.fileService.write(cedarUri, rawContent);
            await this.fileService.write(roCrateUri, convertedContent);

            return true;

        } catch (error) {
            throw error; 
        }
    }

    protected async importSchemaFromFile(): Promise<void> {
        const fileUriOrUris = await this.fileDialogService.showOpenDialog({
            title: 'Import Schema',
            filters: { 'JSON': ['json'] },
            canSelectFiles: true,
            canSelectMany: true
        });

        if (!fileUriOrUris) return;
        const fileUris: URI[] = Array.isArray(fileUriOrUris) ? fileUriOrUris : [fileUriOrUris];

        this.messageService.showProgress({
            text: 'Importing Schemas...'
        }).then(async progress => {
            let successCount = 0;
            let failCount = 0;
            
            progress.report({ message: 'Reading Files...', work: { done: 0, total: 100 } });

            for (let i = 0; i < fileUris.length; i++) {
                const fileUri = fileUris[i];
                const fileName = fileUri.path.base;
                const percent = Math.floor(((i + 1) / fileUris.length) * 100);

                try {
                    const content = await this.fileService.read(fileUri);
                    await this.processImport(fileName, content.value, 'local', progress);
                    successCount++;
                } catch (error) {
                    failCount++;
                    console.error(error);
                    this.messageService.error(`Error importing ${fileName}: ${error instanceof Error ? error.message : error}`);
                }
                progress.report({ work: { done: percent, total: 100 } });
            }

            progress.report({ message: 'Done', work: { done: 100, total: 100 } });
            
            if (successCount > 0) {
                this.messageService.info(`Successfully imported ${successCount} schema(s).`);
                await this.loadSchemas();
            }
            if (failCount > 0) {
                this.messageService.warn(`Failed to import ${failCount} schema(s).`);
            }
        });
    }

    protected async importSchemaFromUrl(): Promise<void> {
        const envVar = await this.envVariablesServer.getValue('CEDAR_API_KEY');
        const apiKey = envVar?.value;

        if (!apiKey) {
            this.messageService.error('CEDAR_API_KEY missing in environment.');
            return;
        }

        let url = '';
        await new Promise((resolve) => {
            let inputUrl = '';
            Modal.confirm({
                title: 'Import Schema from CEDAR URL (@id)',
                content: (
                    <div style={{ marginTop: 10 }}>
                        <Input 
                            placeholder="Enter CEDAR URL" 
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => inputUrl = e.target.value} 
                        />
                        <div style={{ fontSize: 12, color: '#888', marginTop: 5 }}>Using configured API Key</div>
                    </div>
                ),
                onOk: () => { resolve(inputUrl); },
                onCancel: () => { resolve(null); }
            });
        }).then(res => url = res as string);

        if (!url) return;

        this.messageService.showProgress({
            text: 'Importing from URL...'
        }).then(async progress => {
            try {
                progress.report({ message: 'Downloading...', work: { done: 20, total: 100 } });
                
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `apiKey ${apiKey}` }
                });

                if (!response.ok) {
                    throw new Error(`Download failed with status: ${response.status}`);
                }
                
                const rawString = await response.text();
                const parsed = JSON.parse(rawString);
                const name = parsed[SCHEMA_FIELD_NAME];
                const version = parsed[SCHEMA_FIELD_VERSION];
                
                if (!name || !version) throw new Error('Cannot determine filename from schema content');

                const fileName = `remote_${name.toLowerCase().replace(/\s+/g, '_')}_v${version}.json`;

                await this.processImport(fileName, rawString, 'remote', progress);

                progress.report({ message: 'Finished', work: { done: 100, total: 100 } });
                this.messageService.info(`Successfully imported: ${name}`);
                await this.loadSchemas();

            } catch (error) {
                progress.cancel();
                this.messageService.error(`Import Failed: ${error instanceof Error ? error.message : error}`);
            }
        });
    }

    protected async refreshSchemas(): Promise<void> {
        await this.loadSchemas();
    }

    /* --------------------- Lifecycle --------------------- */
    
    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.node.innerHTML = '';
        this.render();
        this.loadSchemas();
    }

    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        this.render();
    }

    protected render(): void {
        if (!this.isAttached) return;

        const ReactDOM = require('react-dom/client');
        this.node.classList.add('metadata-schema-manager-widget');
        
        if (!this.reactRoot) {
             this.reactRoot = ReactDOM.createRoot(this.node);
        }

        const selectedSchemaPaths = this.schemas
            .filter(schema => this.selectedSchemaKeys.includes(schema.path))
            .map(schema => schema.path);

        this.reactRoot?.render(
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'flex', gap: '8px', padding: '8px' }}>
                    <Button type="primary" onClick={() => this.importSchemaFromFile()}>Import from File</Button>
                    <Button type="primary" onClick={() => this.importSchemaFromUrl()}>Import from URL</Button>
                    <Button type="primary" onClick={() => this.refreshSchemas()}>Refresh</Button>
                    
                    {this.selectedSchemaKeys.length > 0 && (
                        <Button type="primary" danger onClick={() => this.deleteSchemas(selectedSchemaPaths)}>
                            Delete {this.selectedSchemaKeys.length}
                        </Button>
                    )}
                </div>
                <div style={{ flexGrow: 1 }}>
                    <SchemaTable 
                        schemas={this.schemas} 
                        isLoading={this.isLoading}
                        onSelectionChange={this.onSelectionChange}
                        onDelete={this.deleteSchemas.bind(this)}
                    />
                </div>
            </div>
        );
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
        }
        super.onBeforeDetach(msg);
    }

    storeState(): object { return {}; }
    restoreState(): void { }
}