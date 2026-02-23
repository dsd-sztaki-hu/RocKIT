// src/browser/metadata-schema-manager-widget.tsx

import { BaseWidget } from '@theia/core/lib/browser';
import type { Message, StatefulWidget } from '@theia/core/lib/browser';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { MessageService } from '@theia/core/lib/common/message-service';
import { URI } from '@theia/core/lib/common/uri';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import type { Key } from 'antd/es/table/interface';
import { inject, injectable } from 'inversify';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { SchemaManagerService } from './services/metadata-schema-manager-service';
import { MetadataSchemaTable } from './components/metadata-schema-table';
import { MetadataSchemaToolbar } from './components/metadata-schema-toolbar';
import { RemoteSchemaProviderListDialog } from './components/remote-schema-provider-list-dialog';
import { RemoteSchemaProviderSelectorDialog } from './components/remote-schema-provider-selector-dialog';
import { MetadataSchemaImportFromUrlDialog } from './components/metadata-schema-import-from-url-dialog';
import { DeleteConfirmationDialog } from './components/delete-confirmation-dialog';
import type { SchemaInfo } from './types';
import './styles/index.css';

export const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager';
export const METADATA_SCHEMA_MANAGER_LABEL = 'Metadata Schema Manager';
const MSG_TIMEOUT = 5000;

@injectable()
export class MetadataSchemaManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = METADATA_SCHEMA_MANAGER_WIDGET_ID;
    static readonly LABEL = METADATA_SCHEMA_MANAGER_LABEL;

    protected schemas: SchemaInfo[] = [];
    protected isLoading = true;
    protected selectedSchemaKeys: Key[] = [];
    
    private reactRoot: Root | undefined;

    constructor(
        @inject(FileDialogService) protected readonly fileDialogService: FileDialogService,
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer,
        @inject(SchemaManagerService) protected readonly schemaManagerService: SchemaManagerService
    ) {
        super();
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
                `Error loading schemas: ${err instanceof Error ? err.message : err}`, 
                { timeout: MSG_TIMEOUT }
            );
        } finally {
            // Guaranteed to unblock the UI even if the service throws
            this.isLoading = false;
            this.update();
        }
    }

    protected onSelectionChange = (selectedRowKeys: Key[]): void => {
        this.selectedSchemaKeys = selectedRowKeys;
        this.update();
    };

    protected async deleteSchemas(paths: string[]): Promise<void> {
        if (paths.length === 0) return;

        const dialog = new DeleteConfirmationDialog(paths.length);
        const confirmed = await dialog.open();

        if (confirmed) {
            this.isLoading = true;
            this.update();
            try {
                const deletedCount = await this.schemaManagerService.deleteSchemas(paths);
                if (deletedCount > 0) {
                    this.messageService.info(
                        `Deleted ${deletedCount} schema(s).`, 
                        { timeout: MSG_TIMEOUT }
                    );
                }
            } catch (err) {
                console.error("Failed to delete schemas:", err);
                this.messageService.error("Failed to delete schemas.", { timeout: MSG_TIMEOUT });
            } finally {
                this.isLoading = false;
                this.update();
            }
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

    protected async importSchemaFromUrl(): Promise<void> {
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

    protected async openProviderList(): Promise<void> {
        const dialog = new RemoteSchemaProviderListDialog(this.schemaManagerService.providerStoreService);
        await dialog.open(); 
    }

    protected async browseRemoteSchemas(): Promise<void> {
        const dialog = new RemoteSchemaProviderSelectorDialog(this.schemaManagerService.providerStoreService);
        const provider = await dialog.open();
        
        if (provider) {
            this.schemaManagerService.browseRemoteSchemas(provider);
        }
    }

    protected async refreshSchemas(): Promise<void> {
        await this.loadSchemas();
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.node.innerHTML = ''; // Clean slate for React
        this.render();
        this.loadSchemas();
    }

    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        this.render();
    }

    protected render(): void {
        if (!this.isAttached) return;

        this.node.classList.add('metadata-schema-manager-widget');
        
        if (!this.reactRoot) {
             this.reactRoot = createRoot(this.node);
        }

        const selectedSchemaPaths = this.schemas
            .filter(schema => this.selectedSchemaKeys.includes(schema.path))
            .map(schema => schema.path);

        this.reactRoot.render(
            <div className="metadata-schema-layout-container">
                <MetadataSchemaToolbar 
                    onImportFile={() => this.importSchemaFromFile()}
                    onImportUrl={() => this.importSchemaFromUrl()}
                    onBrowse={() => this.browseRemoteSchemas()} 
                    onRefresh={() => this.refreshSchemas()}
                    onDelete={() => this.deleteSchemas(selectedSchemaPaths)}
                    onConfigureProviders={() => this.openProviderList()}
                    selectedCount={this.selectedSchemaKeys.length}
                />

                <div className="metadata-schema-table-wrapper">
                    <MetadataSchemaTable 
                        schemas={this.schemas} 
                        isLoading={this.isLoading}
                        selectionType="checkbox"
                        selectedKeys={this.selectedSchemaKeys} 
                        onSelectionChange={this.onSelectionChange}
                        onDelete={(paths) => this.deleteSchemas(paths)}
                    />
                </div>
            </div>
        );
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }

    storeState(): object { return {}; }
    restoreState(): void { }
}