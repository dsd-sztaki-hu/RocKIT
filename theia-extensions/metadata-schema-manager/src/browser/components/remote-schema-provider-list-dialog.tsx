// src/browser/components/remote-schema-provider-list-dialog.tsx

import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { IconButton, Tooltip } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { nls } from '@theia/core/lib/common/nls';

import { RemoteSchemaProviderConfigDialog } from './remote-schema-provider-config-dialog';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';
import type { RemoteSchemaProviderConfig } from '../types';
import '../styles/remote-schema-provider-list-dialog.css';

export class RemoteSchemaProviderListDialog extends AbstractDialog<void> {

    private reactRoot: Root | undefined;
    private providers: RemoteSchemaProviderConfig[] = [];
    private isLoading = false;

    constructor(
        protected readonly providerStore: RemoteSchemaProviderStoreService
    ) {
        super({
            title: nls.localize('rockit/schemaManager/manageRemoteProviders', 'Manage Remote Providers')
        });
        
        this.contentNode.style.width = '600px';
        this.contentNode.style.height = '500px'; 
        this.contentNode.style.padding = '0'; 
    }

    get value(): void {
        return;
    }

    protected async loadProviders() {
        this.isLoading = true;
        this.render();
        try {
            this.providers = await this.providerStore.loadProviders();
        } finally {
            this.isLoading = false;
            this.render();
        }
    }

    protected async handleAdd() {
        const dialog = new RemoteSchemaProviderConfigDialog(this.providerStore);
        const newConfig = await dialog.open();
        
        if (newConfig) {
            await this.saveProvider(newConfig);
        }
    }

    protected async handleEdit(provider: RemoteSchemaProviderConfig) {
        const dialog = new RemoteSchemaProviderConfigDialog(this.providerStore, provider);
        const updatedConfig = await dialog.open();
        
        if (updatedConfig) {
            await this.saveProvider(updatedConfig);
        }
    }

    protected async saveProvider(config: RemoteSchemaProviderConfig) {
        const current = await this.providerStore.loadProviders();
        const index = current.findIndex(p => p.id === config.id);
        
        const newList = [...current];
        if (index !== -1) {
            newList[index] = config;
        } else {
            newList.push(config);
        }
        
        await this.providerStore.saveProviders(newList);
        await this.loadProviders(); 
    }

    protected async handleDelete(id: string) {
        const dialog = new ConfirmDialog(
            nls.localize('rockit/schemaManager/confirmDeletion', 'Confirm Deletion'),
            nls.localize(
                'rockit/schemaManager/deleteProviderWarning',
                'Are you sure you want to delete this remote schema provider configuration?',
            )
        );
        
        const confirmed = await dialog.open();

        if (confirmed) {
            const current = await this.providerStore.loadProviders();
            const newList = current.filter(p => p.id !== id);
            await this.providerStore.saveProviders(newList);
            await this.loadProviders();
        }
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div className="remote-provider-list">
                {/* Main Content Area */}
                <div className="remote-provider-list__content">
                    
                    {/* Header Section */}
                    <div className="remote-provider-list__header">
                        <div className="remote-provider-list__header-left">
                            <div className="remote-provider-list__icon-wrapper">
                                <SettingsInputComponentIcon />
                            </div>
                            <div>
                                <div className="remote-provider-list__title">
                                    {nls.localize('rockit/schemaManager/configuredProviders', 'Configured Providers')}
                                </div>
                                <div className="remote-provider-list__description">
                                    {nls.localize(
                                        'rockit/schemaManager/manageConnectionsDescription',
                                        'Manage connections to remote schema repositories.',
                                    )}
                                </div>
                            </div>
                        </div>

                        <button 
                            className="theia-button remote-provider-list__add-button" 
                            onClick={() => this.handleAdd()}
                        >
                            <AddIcon style={{ fontSize: '18px' }} /> {nls.localize('rockit/schemaManager/addProvider', 'Add Provider')}
                        </button>
                    </div>

                    {/* List Container */}
                    <div className="remote-provider-list__container">
                        {this.isLoading ? (
                            <div className="remote-provider-list__loading">
                                <i className="codicon codicon-loading codicon-modifier-spin" /> {nls.localize('rockit/schemaManager/loading', 'Loading...')}
                            </div>
                        ) : this.providers.length === 0 ? (
                            <div className="remote-provider-list__empty-state">
                                <StorageIcon style={{ fontSize: '48px', color: 'var(--theia-descriptionForeground)', opacity: 0.5 }} />
                                <div>{nls.localize('rockit/schemaManager/noProvidersConfigured', 'No remote providers configured.')}</div>
                            </div>
                        ) : (
                            this.providers.map((provider) => (
                                <div key={provider.id} className="remote-provider-list__item">
                                    <div className="remote-provider-list__item-details">
                                        <StorageIcon style={{ color: 'var(--theia-textLink-foreground)', opacity: 0.9 }} />
                                        
                                        <div className="remote-provider-list__item-text">
                                            <div className="remote-provider-list__item-title">
                                                {provider.title}
                                            </div>
                                            <div className="remote-provider-list__item-url">
                                                {provider.baseUrl}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="remote-provider-list__item-actions">
                                        <Tooltip title={nls.localize('rockit/schemaManager/editConfiguration', 'Edit Configuration')} PopperProps={{ style: { zIndex: 99999 } }}>
                                            <IconButton 
                                                size="small"
                                                onClick={() => this.handleEdit(provider)}
                                                style={{ color: 'var(--theia-icon-foreground)' }}
                                            >
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        
                                        <Tooltip title={nls.localize('rockit/schemaManager/deleteProvider', 'Delete Provider')} PopperProps={{ style: { zIndex: 99999 } }}>
                                            <IconButton 
                                                size="small"
                                                onClick={() => this.handleDelete(provider.id)}
                                                style={{ color: 'var(--theia-errorForeground)' }}
                                            >
                                                <DeleteOutlineIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Footer Section */}
                <div className="remote-provider-list__footer">
                    <button 
                        className="theia-button secondary remote-provider-list__close-button"
                        onClick={() => this.close()}
                    >
                        {nls.localize('rockit/schemaManager/close', 'Close')}
                    </button>
                </div>
            </div>
        );
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.loadProviders();
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }
}

// ... ConfirmDialog class ...
class ConfirmDialog extends AbstractDialog<boolean> {
    private reactRoot: Root | undefined;

    constructor(private titleStr: string, private msgStr: string) {
        super({ title: titleStr });
        this.contentNode.style.padding = '0';
        this.contentNode.style.width = '400px';
        this.appendCloseButton(nls.localize('rockit/common/cancel', 'Cancel'));
        const deleteBtn = this.appendAcceptButton(nls.localize('rockit/schemaManager/delete', 'Delete'));
        
        deleteBtn.style.backgroundColor = 'var(--theia-errorForeground)';
        deleteBtn.style.color = 'var(--theia-editor-background)'; 
        deleteBtn.style.border = '1px solid var(--theia-errorForeground)';
    }
    
    get value(): boolean { return true; }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }
        this.reactRoot.render(
            <div className="confirm-dialog">
                <div className="confirm-dialog__icon-wrapper">
                    <WarningAmberIcon style={{ color: 'var(--theia-errorForeground)', fontSize: '28px' }} />
                </div>
                <div className="confirm-dialog__content">
                    <div className="confirm-dialog__title">{this.titleStr}</div>
                    <div className="confirm-dialog__message">{this.msgStr}</div>
                </div>
            </div>
        );
    }
    protected onAfterAttach(msg: Message): void { super.onAfterAttach(msg); this.render(); }
    protected onBeforeDetach(msg: Message): void { 
        if (this.reactRoot) { 
            this.reactRoot.unmount(); 
            this.reactRoot = undefined; 
        } 
        super.onBeforeDetach(msg); 
    }
}
