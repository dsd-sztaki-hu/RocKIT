// src/browser/components/remote-schema-provider-list-dialog.tsx

import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

// MUI Components & Icons
import { IconButton, Tooltip } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

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
            title: 'Manage Remote Providers'
        });
        
        this.contentNode.style.width = '600px';
        this.contentNode.style.height = '500px'; // Increased slightly for footer space
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';
        this.contentNode.style.padding = '0'; 

        // Removed default buttons to use custom footer
        // this.appendCloseButton('Close');
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
            <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                height: '100%',
                backgroundColor: 'var(--theia-editor-background)',
                color: 'var(--theia-foreground)'
            }}>
                {/* Main Content Area with Padding */}
                <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    
                    {/* Header Section */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: '36px', height: '36px', borderRadius: '4px',
                                backgroundColor: 'var(--theia-list-hoverBackground)',
                                color: 'var(--theia-foreground)'
                            }}>
                                <SettingsInputComponentIcon />
                            </div>
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 'var(--theia-ui-font-size1)' }}>Configured Providers</div>
                                <div style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)' }}>
                                    Manage connections to remote schema repositories.
                                </div>
                            </div>
                        </div>

                        <button 
                            className="theia-button" 
                            onClick={() => this.handleAdd()}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '30px', paddingRight: '12px' }}
                        >
                            <AddIcon style={{ fontSize: '18px' }} /> Add Provider
                        </button>
                    </div>

                    {/* List Container */}
                    <div style={{ 
                        flex: 1, 
                        border: '1px solid var(--theia-panel-border)', 
                        borderRadius: '4px',
                        overflowY: 'auto',
                        backgroundColor: 'var(--theia-input-background)'
                    }}>
                        {this.isLoading ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--theia-descriptionForeground)' }}>
                                <i className="codicon codicon-loading codicon-modifier-spin" /> Loading...
                            </div>
                        ) : this.providers.length === 0 ? (
                            <div style={{ 
                                height: '100%', 
                                display: 'flex', 
                                flexDirection: 'column', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                opacity: 0.7,
                                gap: '10px'
                            }}>
                                <StorageIcon style={{ fontSize: '48px', color: 'var(--theia-descriptionForeground)', opacity: 0.5 }} />
                                <div>No remote providers configured.</div>
                            </div>
                        ) : (
                            this.providers.map((provider, index) => (
                                <div 
                                    key={provider.id} 
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '12px 15px',
                                        borderBottom: index < this.providers.length - 1 ? '1px solid var(--theia-panel-border)' : 'none',
                                        backgroundColor: 'var(--theia-editor-background)',
                                        transition: 'background-color 0.2s'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--theia-list-hoverBackground)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--theia-editor-background)'}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', overflow: 'hidden' }}>
                                        <StorageIcon style={{ color: 'var(--theia-textLink-foreground)', opacity: 0.9 }} />
                                        
                                        <div style={{ overflow: 'hidden' }}>
                                            <div style={{ 
                                                fontWeight: 600, 
                                                color: 'var(--theia-foreground)',
                                                marginBottom: '2px',
                                                fontSize: 'var(--theia-ui-font-size1)'
                                            }}>
                                                {provider.title}
                                            </div>
                                            <div style={{ 
                                                fontSize: '0.9em', 
                                                color: 'var(--theia-descriptionForeground)', 
                                                whiteSpace: 'nowrap', 
                                                overflow: 'hidden', 
                                                textOverflow: 'ellipsis' 
                                            }}>
                                                {provider.baseUrl}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div style={{ display: 'flex', gap: '8px', marginLeft: '10px' }}>
                                        <Tooltip title="Edit Configuration" PopperProps={{ style: { zIndex: 99999 } }}>
                                            <IconButton 
                                                size="small"
                                                onClick={() => this.handleEdit(provider)}
                                                style={{ color: 'var(--theia-icon-foreground)' }}
                                            >
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        
                                        <Tooltip title="Delete Provider" PopperProps={{ style: { zIndex: 99999 } }}>
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
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end', 
                    padding: '15px 20px',
                    backgroundColor: 'var(--theia-layout-color2)', // Standard footer bg
                    borderTop: '1px solid var(--theia-panel-border)'
                }}>
                    <button 
                        className="theia-button secondary"
                        onClick={() => this.close()}
                        style={{ 
                            minWidth: '80px',
                            border: '1px solid var(--theia-button-border, #ccc)' // Fallback border for light themes
                        }}
                    >
                        Close
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

// ... ConfirmDialog class (remains unchanged) ...
class ConfirmDialog extends AbstractDialog<boolean> {
    private reactRoot: ReactDOM.Root | undefined;

    constructor(private titleStr: string, private msgStr: string) {
        super({ title: titleStr });
        this.contentNode.style.padding = '0';
        this.contentNode.style.width = '400px';
        this.appendCloseButton('Cancel');
        const deleteBtn = this.appendAcceptButton('Delete');
        deleteBtn.style.backgroundColor = 'var(--theia-errorForeground)';
        deleteBtn.style.color = 'var(--theia-editor-background)'; 
        deleteBtn.style.border = '1px solid var(--theia-errorForeground)';
    }
    
    get value(): boolean { return true; }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }
        this.reactRoot.render(
            <div style={{ display: 'flex', padding: '20px', gap: '15px', alignItems: 'flex-start', backgroundColor: 'var(--theia-editor-background)', color: 'var(--theia-foreground)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(244, 135, 113, 0.1)', borderRadius: '50%', padding: '8px', flexShrink: 0 }}>
                    <WarningAmberIcon style={{ color: 'var(--theia-errorForeground)', fontSize: '28px' }} />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: 'var(--theia-ui-font-size1)' }}>{this.titleStr}</div>
                    <div style={{ lineHeight: '1.5', color: 'var(--theia-descriptionForeground)' }}>{this.msgStr}</div>
                </div>
            </div>
        );
    }
    protected onAfterAttach(msg: Message): void { super.onAfterAttach(msg); this.render(); }
    protected onBeforeDetach(msg: Message): void { if (this.reactRoot) { this.reactRoot.unmount(); this.reactRoot = undefined; } super.onBeforeDetach(msg); }
}