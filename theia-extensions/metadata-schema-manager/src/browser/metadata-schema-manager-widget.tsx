import { BaseWidget } from '@theia/core/lib/browser';
import type { Message, StatefulWidget } from '@theia/core/lib/browser';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { MessageService } from '@theia/core/lib/common/message-service';
import { URI } from '@theia/core/lib/common/uri';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { Button, Input, Modal } from 'antd';
import type { Key } from 'antd/es/table/interface';
import { inject, injectable } from 'inversify';
import * as React from 'react';
import type { Root } from 'react-dom/client';

import { SchemaManagerService } from './metadata-schema-manager-service';
import { SchemaTable } from './schema-table';
import type { SchemaInfo } from './types';
import '../../src/browser/style/index.css';

export const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager';
export const METADATA_SCHEMA_MANAGER_LABEL = 'Metadata Schema Manager';

@injectable()
export class MetadataSchemaManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = METADATA_SCHEMA_MANAGER_WIDGET_ID;
    static readonly LABEL = METADATA_SCHEMA_MANAGER_LABEL;

    protected readonly fileDialogService: FileDialogService;
    protected readonly messageService: MessageService;
    protected readonly envVariablesServer: EnvVariablesServer;
    
    // Injected Service (Handles all logic)
    protected readonly schemaManagerService: SchemaManagerService;

    protected schemas: SchemaInfo[] = [];
    protected isLoading = true;
    protected selectedSchemaKeys: Key[] = [];
    
    private reactRoot: Root | undefined;

    constructor(
        @inject(FileDialogService) fileDialogService: FileDialogService,
        @inject(MessageService) messageService: MessageService,
        @inject(EnvVariablesServer) envVariablesServer: EnvVariablesServer,
        @inject(SchemaManagerService) schemaManagerService: SchemaManagerService
    ) {
        super();
        this.fileDialogService = fileDialogService;
        this.messageService = messageService;
        this.envVariablesServer = envVariablesServer;
        this.schemaManagerService = schemaManagerService;

        this.id = METADATA_SCHEMA_MANAGER_WIDGET_ID;
        this.title.label = METADATA_SCHEMA_MANAGER_LABEL;
        this.title.caption = METADATA_SCHEMA_MANAGER_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-file-code';
    }

    protected async loadSchemas(): Promise<void> {
        this.isLoading = true;
        this.selectedSchemaKeys = [];
        this.update();

        try {
            this.schemas = await this.schemaManagerService.loadAllSchemas();
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

    protected async deleteSchemas(paths: string[]): Promise<void> {
        if (paths.length === 0) return;

        Modal.confirm({
            title: 'Confirm Deletion',
            content: `Delete ${paths.length} schema(s)? (Deletes both CEDAR and RO-Crate files)`,
            okText: 'Yes',
            cancelText: 'Cancel',
            onOk: async () => {
                this.isLoading = true;
                this.update();

                const deletedCount = await this.schemaManagerService.deleteSchemas(paths);

                if (deletedCount > 0) {
                    this.messageService.info(`Deleted ${deletedCount} schema(s).`);
                }
                
                await this.loadSchemas();
            }
        });
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
            
            const results = await this.schemaManagerService.importFiles(fileUris, progress);
            
            if (results.success > 0) {
                this.messageService.info(`Successfully imported ${results.success} schema(s).`);
                await this.loadSchemas();
            }
            if (results.fail > 0) {
                this.messageService.warn(`Failed to import ${results.fail} schema(s).`);
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
                const schemaName = await this.schemaManagerService.importFromUrl(url, apiKey, progress);
                
                this.messageService.info(`Successfully imported: ${schemaName}`);
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