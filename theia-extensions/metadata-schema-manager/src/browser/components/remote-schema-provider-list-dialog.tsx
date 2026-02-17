import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

import { RemoteSchemaProviderConfigDialog } from './remote-schema-provider-config-dialog';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';
import type { RemoteSchemaProviderConfig } from '../types';

export class RemoteSchemaProviderListDialog extends AbstractDialog<void> {

    private reactRoot: ReactDOM.Root | undefined;
    private providers: RemoteSchemaProviderConfig[] = [];
    private isLoading = false;

    constructor(
        protected readonly providerStore: RemoteSchemaProviderStoreService
    ) {
        super({
            title: 'Remote Schema Providers'
        });
        
        this.contentNode.style.width = '600px';
        this.contentNode.style.height = '400px';
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';

        this.appendCloseButton('Close');
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
            'Confirm Deletion',
            'Are you sure you want to delete this remote schema provider configuration?'
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
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
                    <button 
                        className="theia-button" 
                        onClick={() => this.handleAdd()}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                    >
                        <i className="codicon codicon-add" /> Add Provider
                    </button>
                </div>

                <div style={{ 
                    flex: 1, 
                    border: '1px solid var(--theia-panel-border)', 
                    overflowY: 'auto',
                    backgroundColor: 'var(--theia-editor-background)'
                }}>
                    {this.isLoading ? (
                        <div style={{ padding: '20px', textAlign: 'center', opacity: 0.6 }}>Loading...</div>
                    ) : this.providers.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', opacity: 0.6 }}>
                            No remote providers configured.
                        </div>
                    ) : (
                        this.providers.map((provider, index) => (
                            <div key={provider.id} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '10px',
                                borderBottom: index < this.providers.length - 1 ? '1px solid var(--theia-panel-border)' : 'none'
                            }}>
                                <div style={{ overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 600, color: 'var(--theia-foreground)' }}>{provider.title}</div>
                                    <div style={{ 
                                        fontSize: '0.9em', 
                                        color: 'var(--theia-descriptionForeground)', 
                                        whiteSpace: 'nowrap', 
                                        overflow: 'hidden', 
                                        textOverflow: 'ellipsis' 
                                    }}>
                                        {provider.type} - {provider.baseUrl}
                                    </div>
                                </div>
                                
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button 
                                        className="theia-button secondary" 
                                        title="Edit"
                                        style={{ padding: '4px 8px' }}
                                        onClick={() => this.handleEdit(provider)}
                                    >
                                        <i className="codicon codicon-edit" />
                                    </button>
                                    <button 
                                        className="theia-button secondary" 
                                        title="Delete"
                                        style={{ padding: '4px 8px', color: '#f48771' }}
                                        onClick={() => this.handleDelete(provider.id)}
                                    >
                                        <i className="codicon codicon-trash" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
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

/**
 * FIXED ConfirmDialog: Uses proper AbstractDialog APIs
 */
class ConfirmDialog extends AbstractDialog<boolean> {
    constructor(title: string, msg: string) {
        super({ title });
        this.contentNode.innerText = msg;
        this.contentNode.style.padding = '20px';
        this.contentNode.style.lineHeight = '1.5em';
        
        // 1. Add Cancel Button
        this.appendCloseButton('Cancel');
        
        // 2. Add Delete Button (Primary Action)
        // Using appendAcceptButton automatically wires the click to 'this.accept()'
        const deleteBtn = this.appendAcceptButton('Delete');
        
        // 3. Style the button manually
        deleteBtn.style.backgroundColor = '#d32f2f'; // Red
        deleteBtn.style.color = 'white';
        deleteBtn.style.border = '1px solid #b71c1c';
        
        // Ensure styling overrides standard Theia button styles if needed
        deleteBtn.classList.add('theia-button'); 
    }
    
    // When accept() is called (by clicking the button), this value is returned.
    get value(): boolean {
        return true;
    }
}