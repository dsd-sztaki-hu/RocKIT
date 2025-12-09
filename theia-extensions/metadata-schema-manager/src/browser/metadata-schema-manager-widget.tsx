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

import { SchemaTable } from './schema-table';
import type { SchemaInfo } from './types';
import '../../src/browser/style/index.css';

export const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager';
export const METADATA_SCHEMA_MANAGER_LABEL = 'Metadata Schema Manager';

// --- CONFIGURATION CONSTANTS ---
// Change these values here to update which JSON fields are read across the entire widget
export const SCHEMA_FIELD_NAME = 'schema:name';
export const SCHEMA_FIELD_VERSION = 'pav:version';

/* --------------------- Windows-safe URI Helper --------------------- */
function toFileUri(path: string): URI {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.match(/^[a-zA-Z]:/)) {
        return new URI('file:///' + normalized);
    } else {
        return new URI('file://' + normalized);
    }
}

/* --------------------- Main Widget Class --------------------- */
@injectable()
export class MetadataSchemaManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = METADATA_SCHEMA_MANAGER_WIDGET_ID;
    static readonly LABEL = METADATA_SCHEMA_MANAGER_LABEL;

    protected readonly fileService: FileService;
    protected readonly fileDialogService: FileDialogService;
    protected readonly messageService: MessageService;
    protected readonly envVariablesServer: EnvVariablesServer;

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

    // --- Helpers & Setup ---

    protected async getAromaRootUri(): Promise<URI | null> {
        try {
            const result = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
            const pathString = result?.value;
            
            if (!pathString) {
                console.error('AROMA_ROOT_PATH not found in environment variables.');
                return null;
            }
            return toFileUri(pathString);
        } catch (error) {
            console.error('Error retrieving AROMA_ROOT_PATH:', error);
            return null;
        }
    }

    protected async loadSchemas(): Promise<void> {
        this.isLoading = true;
        this.schemas = [];
        this.selectedSchemaKeys = [];

        try {
            const aromaRoot = await this.getAromaRootUri();
            
            if (!aromaRoot) {
                this.messageService.error('Configuration Error: Root directory not found.');
                this.isLoading = false;
                this.update();
                return;
            }

            const schemasDir = aromaRoot.resolve('metadata-schemas');

            for (const source of ['local', 'remote'] as const) {
                const dir = schemasDir.resolve(source);
                if (!await this.fileService.exists(dir)) continue;

                const stat = await this.fileService.resolve(dir);
                if (!stat?.children) continue;

                for (const file of stat.children) {
                    if (!file.name.endsWith('.json')) continue;

                    try {
                        const content = await this.fileService.read(file.resource);
                        const parsed = JSON.parse(content.value);

                        // USE CONSTANTS HERE
                        const schemaName = parsed[SCHEMA_FIELD_NAME];
                        const schemaVersion = parsed[SCHEMA_FIELD_VERSION];

                        if (!schemaName || !schemaVersion) continue;

                        this.schemas.push({
                            name: schemaName,
                            version: schemaVersion,
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

    // --- Actions (Handlers) ---

    protected onSelectionChange = (selectedRowKeys: Key[]): void => {
        this.selectedSchemaKeys = selectedRowKeys;
        this.update();
    };

    protected async deleteSchemas(schemaPaths: string[]): Promise<void> {
        if (schemaPaths.length === 0) return;

        Modal.confirm({
            title: 'Confirm Deletion',
            content: `Delete ${schemaPaths.length} item(s)?`,
            okText: 'Yes',
            cancelText: 'Cancel',
            onOk: async () => {
                this.isLoading = true;
                this.update();
                let successfulDeletes = 0;

                for (const path of schemaPaths) {
                    try {
                        await this.fileService.delete(new URI(path));
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

    protected async importSchemaFromFile(): Promise<void> {
        const aromaRoot = await this.getAromaRootUri();
        if (!aromaRoot) return;
        const localDir = aromaRoot.resolve('metadata-schemas/local');

        const fileUriOrUris = await this.fileDialogService.showOpenDialog({
            title: 'Import Schema',
            filters: { 'JSON': ['json'] },
            canSelectFiles: true,
            canSelectMany: true
        });

        if (!fileUriOrUris) return;
        const fileUris: URI[] = Array.isArray(fileUriOrUris) ? fileUriOrUris : [fileUriOrUris];

        for (const fileUri of fileUris) {
            if (!fileUri) continue;
            const fileName = fileUri.path.base;
            const targetUri = localDir.resolve(fileName);
            try {
                const content = await this.fileService.read(fileUri);
                if (await this.fileService.exists(targetUri)) {
                    if (!confirm(`Overwrite ${fileName}?`)) continue;
                }
                await this.fileService.write(targetUri, content.value);
            } catch (error) {
                this.messageService.error(`Failed to import ${fileName}: ${error}`);
            }
        }
        await this.loadSchemas();
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
                title: 'Import Schema from URL',
                content: (
                    <div style={{ marginTop: 10 }}>
                        <Input 
                            placeholder="Enter URL" 
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

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `apiKey ${apiKey}` }
            });
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            
            const jsonData = await response.json();

            // USE CONSTANTS HERE
            const schemaName = jsonData[SCHEMA_FIELD_NAME];
            const schemaVersion = jsonData[SCHEMA_FIELD_VERSION];

            if (!schemaName || !schemaVersion) {
                throw new Error(`Invalid schema: missing ${SCHEMA_FIELD_NAME} or ${SCHEMA_FIELD_VERSION} fields`);
            }

            const fileName = `remote_${schemaName.toLowerCase().replace(/\s+/g, '_')}_v${schemaVersion}.json`;
            const aromaRoot = await this.getAromaRootUri();
            if(!aromaRoot) return;

            const targetUri = aromaRoot.resolve('metadata-schemas/remote').resolve(fileName);

            if (await this.fileService.exists(targetUri)) {
                if (!confirm(`Overwrite ${fileName}?`)) return;
            }
            
            await this.fileService.write(targetUri, JSON.stringify(jsonData, null, 2));
            this.messageService.info(`Imported: ${schemaName}`);
            await this.loadSchemas();
        } catch (error) {
            this.messageService.error(`Import failed: ${error}`);
        }
    }

    protected async refreshSchemas(): Promise<void> {
        await this.loadSchemas();
    }

    /* --------------------- Widget Lifecycle --------------------- */
    
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
                    <Button type="primary" onClick={() => this.importSchemaFromFile()}>Import File</Button>
                    <Button type="primary" onClick={() => this.importSchemaFromUrl()}>Import URL</Button>
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