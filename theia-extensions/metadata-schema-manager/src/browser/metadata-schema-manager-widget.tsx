import { BaseWidget } from '@theia/core/lib/browser';
import type { Message, StatefulWidget } from '@theia/core/lib/browser';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { MessageService } from '@theia/core/lib/common/message-service';
import { URI } from '@theia/core/lib/common/uri';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { Modal } from 'antd';
import type { Key } from 'antd/es/table/interface';
import { inject, injectable } from 'inversify';
import * as React from 'react';
import type { Root } from 'react-dom/client';

import { SchemaManagerService } from './services/metadata-schema-manager-service';
import { MetadataSchemaTable } from './components/metadata-schema-table';
import { MetadataSchemaToolbar } from './components/metadata-schema-toolbar';
import { RemoteSchemaProviderListDialog } from './components/remote-schema-provider-list-dialog';
import { RemoteSchemaProviderConfigDialog } from './components/remote-schema-provider-config-dialog';
import { RemoteSchemaProviderSelectorDialog } from './components/remote-schema-provider-selector-dialog';
import { MetadataSchemaImportFromUrlDialog } from './components/metadata-schema-import-from-url-dialog';
import type { SchemaInfo, RemoteSchemaProviderConfig } from './types';

import './style/index.css';

export const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager';
export const METADATA_SCHEMA_MANAGER_LABEL = 'Metadata Schema Manager';

const MSG_TIMEOUT = 5000;

@injectable()
export class MetadataSchemaManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = METADATA_SCHEMA_MANAGER_WIDGET_ID;
    static readonly LABEL = METADATA_SCHEMA_MANAGER_LABEL;

    protected readonly fileDialogService: FileDialogService;
    protected readonly messageService: MessageService;
    protected readonly envVariablesServer: EnvVariablesServer;
    protected readonly schemaManagerService: SchemaManagerService;

    protected schemas: SchemaInfo[] = [];
    protected isLoading = true;
    protected selectedSchemaKeys: Key[] = [];
    
    // Dialog state
    protected isProviderListOpen = false;
    protected isProviderConfigOpen = false;
    protected isProviderSelectorOpen = false;

    protected selectedProviderToEdit: RemoteSchemaProviderConfig | undefined = undefined;
    protected providersLastUpdated = 0; 
    protected configDialogKey = 0;
    
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

        this.toDispose.push(
            this.schemaManagerService.onDidChangeSchemas(() => this.loadSchemas())
        );
    }

    protected async loadSchemas(): Promise<void> {
        this.isLoading = true;
        this.selectedSchemaKeys = [];
        this.update();

        try {
            this.schemas = await this.schemaManagerService.loadAllSchemas();
        } catch (err) {
            this.messageService.error(
                `Error loading schemas: ${err}`, 
                { timeout: MSG_TIMEOUT }
            );
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
            content: `Delete ${paths.length} schema(s)?`,
            okText: 'Yes',
            cancelText: 'Cancel',
            onOk: async () => {
                this.isLoading = true;
                this.update();
                const deletedCount = await this.schemaManagerService.deleteSchemas(paths);
                if (deletedCount > 0) {
                    this.messageService.info(
                        `Deleted ${deletedCount} schema(s).`, 
                        { timeout: MSG_TIMEOUT }
                    );
                }
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
            try {
                const results = await this.schemaManagerService.importFiles(fileUris, progress);
                
                if (results.success > 0) {
                    this.messageService.info(
                        `Successfully imported ${results.success} schema(s).`, 
                        { timeout: MSG_TIMEOUT }
                    );
                }
                if (results.fail > 0) {
                    this.messageService.warn(
                        `Failed to import ${results.fail} schema(s).`, 
                        { timeout: MSG_TIMEOUT }
                    );
                }
            } catch (err) {
                console.error(err);
                this.messageService.error('Unexpected error during import.', { timeout: MSG_TIMEOUT });
            } finally {
                progress.cancel();
            }
        });
    }

    protected async openImportUrlDialog(): Promise<void> {
        const dialog = new MetadataSchemaImportFromUrlDialog();
        const url = await dialog.open();
        
        if (url) {
            this.handleImportUrl(url);
        }
    }

    protected async handleImportUrl(url: string): Promise<void> {
        this.messageService.showProgress({
            text: 'Importing from URL...'
        }).then(async progress => {
            try {
                const schemaName = await this.schemaManagerService.importFromUrl(url, progress);
                
                this.messageService.info(
                    `Successfully imported: ${schemaName}`, 
                    { timeout: MSG_TIMEOUT }
                );
            } catch (error) {
                this.messageService.error(
                    `Import Failed: ${error instanceof Error ? error.message : error}`, 
                    { timeout: MSG_TIMEOUT }
                );
            } finally {
                progress.cancel();
            }
        });
    }

    protected async importSchemaFromUrl(): Promise<void> {
        await this.openImportUrlDialog();
    }

    protected browseRemoteSchemas(): void {
        this.isProviderSelectorOpen = true;
        this.update();
    }
    
    protected handleProviderSelected(provider: RemoteSchemaProviderConfig): void {
        this.isProviderSelectorOpen = false;
        this.update();
        this.schemaManagerService.browseRemoteSchemas(provider);
    }

    protected async refreshSchemas(): Promise<void> {
        await this.loadSchemas();
    }

    protected openProviderList(): void {
        this.isProviderListOpen = true;
        this.isProviderConfigOpen = false; 
        this.isProviderSelectorOpen = false; 
        this.update();
    }

    protected closeProviderList(): void {
        this.isProviderListOpen = false;
        this.isProviderConfigOpen = false;
        this.update();
    }

    protected openProviderConfig(providerToEdit?: RemoteSchemaProviderConfig): void {
        this.selectedProviderToEdit = providerToEdit;
        this.isProviderListOpen = false;
        this.isProviderConfigOpen = true;
        this.configDialogKey++;
        this.update();
    }

    protected closeProviderConfig(): void {
        this.isProviderConfigOpen = false;
        this.selectedProviderToEdit = undefined;
        this.isProviderListOpen = true;
        this.update();
    }

    protected async handleProviderSave(newConfig: RemoteSchemaProviderConfig): Promise<void> {
        const store = this.schemaManagerService.providerStoreService;
        const currentProviders = await store.loadProviders();
        
        let newList = [...currentProviders];
        
        const existingIndex = newList.findIndex(p => p.id === newConfig.id);
        if (existingIndex !== -1) {
            newList[existingIndex] = newConfig;
        } else {
            newList.push(newConfig);
        }

        await store.saveProviders(newList);
        
        this.providersLastUpdated = Date.now();
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
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
                
                <MetadataSchemaToolbar 
                    onImportFile={() => this.importSchemaFromFile()}
                    onImportUrl={() => this.openImportUrlDialog()}
                    onBrowse={() => this.browseRemoteSchemas()} 
                    onRefresh={() => this.refreshSchemas()}
                    onDelete={() => this.deleteSchemas(selectedSchemaPaths)}
                    onConfigureProviders={() => this.openProviderList()}
                    selectedCount={this.selectedSchemaKeys.length}
                />

                <div style={{ flexGrow: 1 }}>
                    <MetadataSchemaTable 
                        schemas={this.schemas} 
                        isLoading={this.isLoading}
                        onSelectionChange={this.onSelectionChange}
                        onDelete={(paths) => this.deleteSchemas(paths)}
                    />
                </div>
                
                {this.isProviderSelectorOpen && (
                    <RemoteSchemaProviderSelectorDialog
                        open={this.isProviderSelectorOpen}
                        onClose={() => { this.isProviderSelectorOpen = false; this.update(); }}
                        onSelect={(p) => this.handleProviderSelected(p)}
                        onConfigure={() => this.openProviderList()}
                        providerStore={this.schemaManagerService.providerStoreService}
                    />
                )}

                {this.isProviderListOpen && (
                    <RemoteSchemaProviderListDialog 
                        open={this.isProviderListOpen}
                        onClose={() => this.closeProviderList()}
                        onAddProvider={() => this.openProviderConfig(undefined)}
                        onEditProvider={(p) => this.openProviderConfig(p)}
                        providerStore={this.schemaManagerService.providerStoreService}
                        lastUpdated={this.providersLastUpdated}
                    />
                )}

                {this.isProviderConfigOpen && (
                    <RemoteSchemaProviderConfigDialog 
                        key={this.configDialogKey} 
                        open={this.isProviderConfigOpen}
                        providerToEdit={this.selectedProviderToEdit}
                        onClose={() => this.closeProviderConfig()}
                        onSave={async (config) => await this.handleProviderSave(config)}
                        providerStore={this.schemaManagerService.providerStoreService}
                    />
                )}
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