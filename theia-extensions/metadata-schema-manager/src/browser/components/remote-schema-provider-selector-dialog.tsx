import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

import { RemoteSchemaProviderListDialog } from './remote-schema-provider-list-dialog';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';
import type { RemoteSchemaProviderConfig } from '../types';

export class RemoteSchemaProviderSelectorDialog extends AbstractDialog<RemoteSchemaProviderConfig | undefined> {

    private reactRoot: ReactDOM.Root | undefined;
    private providers: RemoteSchemaProviderConfig[] = [];
    private isLoading = true;
    
    private result: RemoteSchemaProviderConfig | undefined;

    constructor(
        protected readonly providerStore: RemoteSchemaProviderStoreService
    ) {
        super({
            title: 'Select Remote Provider'
        });
        
        // Increased width to 500px to prevent cramping
        this.contentNode.style.width = '500px';
        this.contentNode.style.minHeight = '150px';
        this.contentNode.style.maxHeight = '500px';
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';

        this.appendCloseButton('Cancel');
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
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '10px', overflowX: 'hidden' }}>
                
                {this.isLoading ? (
                    <div style={{ 
                        flex: 1, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        padding: '20px',
                        color: 'var(--theia-descriptionForeground)'
                    }}>
                        <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '8px' }} />
                        Loading providers...
                    </div>
                ) : this.providers.length === 0 ? (
                    <div style={{ 
                        flex: 1, 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        padding: '20px',
                        textAlign: 'center'
                    }}>
                        <p style={{ color: 'var(--theia-descriptionForeground)', marginBottom: '15px' }}>
                            No remote schema providers are currently configured.
                        </p>
                        <button 
                            className="theia-button" 
                            onClick={() => this.handleConfigure()}
                        >
                            Configure Providers
                        </button>
                    </div>
                ) : (
                    <div style={{ 
                        flex: 1, 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '8px', 
                        overflowY: 'auto',
                        overflowX: 'hidden', // Explicitly hide horizontal scroll
                        padding: '5px' 
                    }}>
                        <div style={{ 
                            fontSize: 'var(--theia-ui-font-size0)', 
                            color: 'var(--theia-descriptionForeground)', 
                            marginBottom: '5px' 
                        }}>
                            Available Providers:
                        </div>
                        
                        {this.providers.map(p => (
                            <button
                                key={p.id}
                                className="theia-button secondary"
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    textAlign: 'left',
                                    padding: '10px',
                                    width: '100%',
                                    // boxSizing: 'border-box' ensures padding doesn't add to width
                                    boxSizing: 'border-box', 
                                    border: '1px solid var(--theia-panel-border)'
                                }}
                                onClick={() => this.handleSelect(p)}
                                title={p.baseUrl}
                            >
                                <i className="codicon codicon-server" style={{ fontSize: '16px', marginRight: '10px', opacity: 0.8 }} />
                                <div style={{ overflow: 'hidden', flex: 1 }}>
                                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {p.title}
                                    </div>
                                    <div style={{ fontSize: '0.85em', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {p.baseUrl}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
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