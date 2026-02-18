// src/browser/components/remote-schema-provider-config-dialog.tsx

import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

// MUI Icons
import DnsIcon from '@mui/icons-material/Dns';
import LinkIcon from '@mui/icons-material/Link';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import CategoryIcon from '@mui/icons-material/Category';
import { IconButton } from '@mui/material';

import { ConnectionSuccessDialog } from './connection-success-dialog';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';
import type { RemoteSchemaProviderConfig } from '../types';

// Import CSS
import '../styles/remote-schema-provider-config-dialog.css';

export class RemoteSchemaProviderConfigDialog extends AbstractDialog<RemoteSchemaProviderConfig | undefined> {

    private reactRoot: ReactDOM.Root | undefined;
    
    // Form State
    private titleValue: string = '';
    private baseUrlValue: string = '';
    private apiKeyValue: string = '';
    private typeValue: 'CEDAR' = 'CEDAR';
    
    private isEditingKey = true;
    private isTesting = false;
    private showKey = false; 
    private errorMsg: string | null = null;
    private result: RemoteSchemaProviderConfig | undefined;

    constructor(
        private readonly providerStore: RemoteSchemaProviderStoreService,
        private readonly providerToEdit?: RemoteSchemaProviderConfig
    ) {
        super({
            title: providerToEdit ? 'Edit Provider' : 'Add Provider'
        });
        
        // Layout handled by CSS mostly, but container needs explicit size
        this.contentNode.style.width = '500px';
        this.contentNode.style.padding = '0';

        if (providerToEdit) {
            this.titleValue = providerToEdit.title;
            this.baseUrlValue = providerToEdit.baseUrl;
            this.apiKeyValue = providerToEdit.apiKey || '';
            this.isEditingKey = false; 
        }
    }

    get value(): RemoteSchemaProviderConfig | undefined {
        return this.result;
    }

    private async handleSaveAttempt() {
        if (!this.titleValue || !this.baseUrlValue) {
            this.errorMsg = "Title and Base URL are required.";
            this.render();
            return;
        }

        this.isTesting = true;
        this.errorMsg = null;
        this.render();

        const domainBase = this.calculateDomainBase(this.baseUrlValue);
        
        try {
            const schemaNames = await this.providerStore.testConnection(domainBase, this.apiKeyValue || undefined);
            
            this.isTesting = false; 
            this.render();

            const successDialog = new ConnectionSuccessDialog(this.titleValue, schemaNames);
            const confirmed = await successDialog.open();

            if (confirmed) {
                this.result = {
                    id: this.providerToEdit ? this.providerToEdit.id : Date.now().toString(),
                    title: this.titleValue,
                    baseUrl: this.baseUrlValue,
                    domainBase: domainBase,
                    type: this.typeValue,
                    apiKey: this.apiKeyValue || undefined
                };
                this.accept(); 
            }
        } catch (err: any) {
            this.isTesting = false;
            this.errorMsg = `Connection failed: ${err.message || 'Unknown error'}`;
            this.render();
        }
    }

    private handleCancel() {
        this.result = undefined;
        this.close();
    }

    private calculateDomainBase(url: string): string {
        try {
            const trimmed = url.trim();
            const hasProtocol = /^https?:\/\//i.test(trimmed);
            const urlObj = new URL(hasProtocol ? trimmed : `https://${trimmed}`);
            const parts = urlObj.hostname.split('.');
            const CEDAR_PREFIXES = ['cedar', 'repo', 'resource', 'open', 'openview'];
            
            if (parts.length > 1 && CEDAR_PREFIXES.includes(parts[0].toLowerCase())) {
                parts.shift();
                urlObj.hostname = parts.join('.');
                return urlObj.origin;
            }
            return urlObj.origin;
        } catch {
            return url;
        }
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div className="remote-provider-config">
                
                {/* Scrollable Content Area */}
                <div className="remote-provider-config__content">
                    {/* Header Info */}
                    <div className="remote-provider-config__header">
                        <div className="remote-provider-config__icon-wrapper">
                            <DnsIcon style={{ color: 'var(--theia-textLink-foreground)', fontSize: '24px' }} />
                        </div>
                        <div>
                            <div className="remote-provider-config__title">
                                {this.providerToEdit ? 'Edit Connection' : 'New Connection'}
                            </div>
                            <div className="remote-provider-config__description">
                                Configure connection details for a remote metadata repository.
                            </div>
                        </div>
                    </div>

                    {this.errorMsg && (
                        <div className="remote-provider-config__error">
                            <strong>Error:</strong> {this.errorMsg}
                        </div>
                    )}

                    {/* Form Fields */}
                    <div className="remote-provider-config__form">
                        
                        {/* Title */}
                        <div>
                            <label className="remote-provider-config__label">
                                Name (Display)
                            </label>
                            <input 
                                className="theia-input remote-provider-config__input" 
                                value={this.titleValue}
                                onChange={(e) => { this.titleValue = e.target.value; this.render(); }}
                                disabled={this.isTesting}
                                placeholder="e.g. ARP Production"
                                autoFocus
                            />
                        </div>

                        {/* Base URL */}
                        <div>
                            <label className="remote-provider-config__label">
                                <LinkIcon style={{ fontSize: '16px', opacity: 0.7 }}/> Base URL
                            </label>
                            <input 
                                className="theia-input remote-provider-config__input" 
                                placeholder="https://cedar.schema.researchdata.hu"
                                value={this.baseUrlValue}
                                onChange={(e) => { this.baseUrlValue = e.target.value; this.render(); }}
                                disabled={this.isTesting}
                            />
                        </div>

                        {/* Type Dropdown */}
                        <div>
                            <label className="remote-provider-config__label">
                                <CategoryIcon style={{ fontSize: '16px', opacity: 0.7 }}/> Type
                            </label>
                            <select 
                                className="theia-select remote-provider-config__select" 
                                value={this.typeValue}
                                onChange={(e) => { this.typeValue = e.target.value as any; this.render(); }}
                                disabled={this.isTesting} 
                            >
                                <option value="CEDAR">CEDAR</option>
                            </select>
                        </div>

                        {/* API Key */}
                        <div>
                            <label className="remote-provider-config__label">
                                <VpnKeyIcon style={{ fontSize: '16px', opacity: 0.7 }}/> API Key (Optional)
                            </label>
                            <div className="remote-provider-config__api-key-wrapper">
                                <input 
                                    className="theia-input remote-provider-config__input remote-provider-config__input--password" 
                                    type={this.showKey ? "text" : "password"}
                                    value={this.isEditingKey ? this.apiKeyValue : '********'}
                                    onChange={(e) => { this.apiKeyValue = e.target.value; this.render(); }}
                                    disabled={!this.isEditingKey || this.isTesting}
                                    placeholder={this.isEditingKey ? "Paste API Key here" : "Stored securely"}
                                />
                                {this.isEditingKey ? (
                                    <div className="remote-provider-config__visibility-toggle">
                                        <IconButton 
                                            size="small" 
                                            onClick={() => { this.showKey = !this.showKey; this.render(); }}
                                            style={{ color: 'var(--theia-foreground)', opacity: 0.7 }}
                                            title={this.showKey ? "Hide API Key" : "Show API Key"}
                                        >
                                            {this.showKey ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                        </IconButton>
                                    </div>
                                ) : (
                                    <button 
                                        className="theia-button secondary remote-provider-config__change-btn"
                                        onClick={() => { 
                                            this.isEditingKey = true; 
                                            this.apiKeyValue = ''; 
                                            this.render(); 
                                        }}
                                    >
                                        Change
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Section */}
                <div className="remote-provider-config__footer">
                    <button 
                        className="theia-button secondary remote-provider-config__btn-cancel"
                        onClick={() => this.handleCancel()}
                        disabled={this.isTesting}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main remote-provider-config__btn-save"
                        onClick={() => this.handleSaveAttempt()}
                        disabled={this.isTesting}
                    >
                        {this.isTesting && <i className="codicon codicon-loading codicon-modifier-spin" />}
                        {this.isTesting ? 'Verifying...' : 'Save'}
                    </button>
                </div>
            </div>
        );
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.render();
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }
}