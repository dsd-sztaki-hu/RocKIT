// src/browser/components/remote-schema-provider-selector-dialog.tsx

import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

// MUI Icons
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';
import AddLinkIcon from '@mui/icons-material/AddLink';
import ChevronRightIcon from '@mui/icons-material/ChevronRight'; // New
import SettingsIcon from '@mui/icons-material/Settings'; // New

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
        
        this.contentNode.style.width = '500px';
        this.contentNode.style.height = '400px';
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';
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
                
                {/* Content Area */}
                <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    
                    {/* Header */}
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '20px', flexShrink: 0 }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '40px', height: '40px', borderRadius: '50%',
                            backgroundColor: 'var(--theia-list-hoverBackground)',
                            border: '1px solid var(--theia-contrastBorder, transparent)'
                        }}>
                            <DnsIcon style={{ color: 'var(--theia-textLink-foreground)', fontSize: '22px' }} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 'var(--theia-ui-font-size1)' }}>
                                Choose Repository
                            </div>
                            <div style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)' }}>
                                Select a remote provider to browse schemas.
                            </div>
                        </div>
                    </div>

                    {/* Content Body */}
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                        
                        {this.isLoading ? (
                            <div style={{ 
                                flex: 1, 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                color: 'var(--theia-descriptionForeground)',
                                gap: '8px'
                            }}>
                                <i className="codicon codicon-loading codicon-modifier-spin" />
                                Loading providers...
                            </div>
                        ) : this.providers.length === 0 ? (
                            <div style={{ 
                                flex: 1, 
                                display: 'flex', 
                                flexDirection: 'column', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                textAlign: 'center',
                                border: '2px dashed var(--theia-panel-border)',
                                borderRadius: '6px',
                                padding: '20px',
                                backgroundColor: 'var(--theia-input-background)'
                            }}>
                                <StorageIcon style={{ fontSize: '48px', color: 'var(--theia-descriptionForeground)', opacity: 0.4, marginBottom: '15px' }} />
                                <div style={{ fontSize: 'var(--theia-ui-font-size1)', fontWeight: 600, marginBottom: '5px' }}>
                                    No Providers Found
                                </div>
                                <p style={{ color: 'var(--theia-descriptionForeground)', marginBottom: '20px', maxWidth: '80%' }}>
                                    You haven't configured any remote repositories yet.
                                </p>
                                <button 
                                    className="theia-button" 
                                    onClick={() => this.handleConfigure()}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                >
                                    <AddLinkIcon fontSize="small" /> Configure Providers
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {this.providers.map(p => (
                                    <button
                                        key={p.id}
                                        className="theia-button secondary"
                                        style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'space-between', // Push chevron to right
                                            textAlign: 'left',
                                            padding: '12px 15px',
                                            margin: '0 2px', 
                                            boxSizing: 'border-box', 
                                            border: '1px solid var(--theia-panel-border)',
                                            backgroundColor: 'var(--theia-editor-background)',
                                            transition: 'transform 0.1s, border-color 0.2s',
                                            cursor: 'pointer'
                                        }}
                                        onClick={() => this.handleSelect(p)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = 'var(--theia-focusBorder)';
                                            e.currentTarget.style.backgroundColor = 'var(--theia-list-hoverBackground)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = 'var(--theia-panel-border)';
                                            e.currentTarget.style.backgroundColor = 'var(--theia-editor-background)';
                                        }}
                                        title={p.baseUrl}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                                            <div style={{ 
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                width: '32px', height: '32px', borderRadius: '4px',
                                                backgroundColor: 'var(--theia-activityBar-background)',
                                                marginRight: '15px',
                                                flexShrink: 0
                                            }}>
                                                <StorageIcon style={{ fontSize: '18px', color: 'var(--theia-activityBar-foreground)' }} />
                                            </div>
                                            
                                            <div style={{ overflow: 'hidden' }}>
                                                <div style={{ 
                                                    fontWeight: 600, 
                                                    overflow: 'hidden', 
                                                    textOverflow: 'ellipsis',
                                                    fontSize: 'var(--theia-ui-font-size1)',
                                                    color: 'var(--theia-foreground)'
                                                }}>
                                                    {p.title}
                                                </div>
                                                <div style={{ 
                                                    fontSize: '0.85em', 
                                                    color: 'var(--theia-descriptionForeground)', 
                                                    overflow: 'hidden', 
                                                    textOverflow: 'ellipsis',
                                                    marginTop: '2px' 
                                                }}>
                                                    {p.baseUrl}
                                                </div>
                                            </div>
                                        </div>

                                        <ChevronRightIcon style={{ color: 'var(--theia-icon-foreground)', opacity: 0.5 }} />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '15px 20px',
                    backgroundColor: 'var(--theia-layout-color2)', 
                    borderTop: '1px solid var(--theia-panel-border)'
                }}>
                    {this.providers.length > 0 ? (
                        <button 
                            className="theia-button secondary"
                            onClick={() => this.handleConfigure()}
                            style={{ 
                                display: 'flex',
                                alignItems: 'center',
                                border: 'none', 
                                background: 'transparent', 
                                padding: '4px 8px',
                                color: 'var(--theia-textLink-foreground)',
                                cursor: 'pointer',
                                fontSize: 'var(--theia-ui-font-size0)'
                            }}
                        >
                            <SettingsIcon style={{ fontSize: '14px', marginRight: '6px' }} />
                            Manage Providers...
                        </button>
                    ) : (
                        <div /> 
                    )}

                    <button 
                        className="theia-button secondary"
                        onClick={() => this.close()}
                        style={{ 
                            minWidth: '80px',
                            border: '1px solid var(--theia-button-border, #ccc)'
                        }}
                    >
                        Cancel
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