// src/browser/components/remote-schema-provider-selector-dialog.tsx

import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';
import AddLinkIcon from '@mui/icons-material/AddLink';
import ChevronRightIcon from '@mui/icons-material/ChevronRight'; 
import SettingsIcon from '@mui/icons-material/Settings'; 
import { nls } from '@theia/core/lib/common/nls';

import { RemoteSchemaProviderListDialog } from './remote-schema-provider-list-dialog';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';
import type { RemoteSchemaProviderConfig } from '../types';
import '../styles/remote-schema-provider-selector-dialog.css';

export class RemoteSchemaProviderSelectorDialog extends AbstractDialog<RemoteSchemaProviderConfig | undefined> {

    private reactRoot: Root | undefined;
    private providers: RemoteSchemaProviderConfig[] = [];
    private isLoading = true;
    
    private result: RemoteSchemaProviderConfig | undefined;

    constructor(
        protected readonly providerStore: RemoteSchemaProviderStoreService
    ) {
        super({
            title: nls.localize('rockit/schemaManager/selectRemoteProvider', 'Select Remote Provider')
        });
        
        this.contentNode.style.width = '500px';
        this.contentNode.style.height = '400px';
        this.contentNode.style.padding = '0'; 
    }

    get value(): RemoteSchemaProviderConfig | undefined {
        return this.result;
    }

    protected async loadProviders() {
        this.isLoading = true;
        this.render(); 
        try {
            this.providers = await this.providerStore.loadProviders();
        } catch (error) {
            console.error("Failed to load providers:", error);
        } finally {
            this.isLoading = false;
            this.render();
        }
    }

    protected handleSelect(provider: RemoteSchemaProviderConfig) {
        this.result = provider;
        this.accept(); 
    }

    protected async handleConfigure() {
        const dialog = new RemoteSchemaProviderListDialog(this.providerStore);
        await dialog.open();
        await this.loadProviders();
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div className="remote-provider-selector">
                
                {/* Content Area */}
                <div className="remote-provider-selector__content">
                    
                    {/* Header */}
                    <div className="remote-provider-selector__header">
                        <div className="remote-provider-selector__icon-wrapper">
                            <DnsIcon className="remote-provider-selector__header-icon" />
                        </div>
                        <div>
                            <div className="remote-provider-selector__title">
                                {nls.localize('rockit/schemaManager/chooseRepository', 'Choose Repository')}
                            </div>
                            <div className="remote-provider-selector__description">
                                {nls.localize(
                                    'rockit/schemaManager/chooseRepositoryDescription',
                                    'Select a remote provider to browse schemas.',
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Content Body */}
                    <div className="remote-provider-selector__body">
                        
                        {this.isLoading ? (
                            <div className="remote-provider-selector__state-msg">
                                <i className="codicon codicon-loading codicon-modifier-spin" />
                                {nls.localize('rockit/schemaManager/loadingProviders', 'Loading providers...')}
                            </div>
                        ) : this.providers.length === 0 ? (
                            <div className="remote-provider-selector__state-msg">
                                <div className="remote-provider-selector__empty-box">
                                    <StorageIcon className="remote-provider-selector__empty-icon" />
                                    <div className="remote-provider-selector__empty-title">
                                        {nls.localize('rockit/schemaManager/noProvidersFound', 'No Providers Found')}
                                    </div>
                                    <p className="remote-provider-selector__empty-desc">
                                        {nls.localize(
                                            'rockit/schemaManager/noProvidersDescription',
                                            'No remote repositories have been configured yet.',
                                        )}
                                    </p>
                                    <button 
                                        className="theia-button" 
                                        onClick={() => this.handleConfigure()}
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        <AddLinkIcon fontSize="small" /> {nls.localize('rockit/schemaManager/configureProviders', 'Configure Providers')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            // List of Providers
                            this.providers.map(p => (
                                <button
                                    key={p.id}
                                    className="remote-provider-selector__item"
                                    onClick={() => this.handleSelect(p)}
                                    title={p.baseUrl}
                                >
                                    <div className="remote-provider-selector__item-content">
                                        <div className="remote-provider-selector__item-icon-box">
                                            <StorageIcon className="remote-provider-selector__item-icon" />
                                        </div>
                                        
                                        <div className="remote-provider-selector__item-details">
                                            <div className="remote-provider-selector__item-title">
                                                {p.title}
                                            </div>
                                            <div className="remote-provider-selector__item-url">
                                                {p.baseUrl}
                                            </div>
                                        </div>
                                    </div>

                                    <ChevronRightIcon style={{ color: 'var(--theia-icon-foreground)', opacity: 0.5 }} />
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="remote-provider-selector__footer">
                    {this.providers.length > 0 ? (
                        <button 
                            className="remote-provider-selector__manage-btn"
                            onClick={() => this.handleConfigure()}
                        >
                            <SettingsIcon style={{ fontSize: '14px', marginRight: '6px' }} />
                            {nls.localize('rockit/schemaManager/manageProviders', 'Manage Providers...')}
                        </button>
                    ) : (
                        <div /> 
                    )}

                    <button 
                        className="theia-button secondary remote-provider-selector__cancel-btn"
                        onClick={() => this.close()}
                    >
                        {nls.localize('rockit/common/cancel', 'Cancel')}
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
