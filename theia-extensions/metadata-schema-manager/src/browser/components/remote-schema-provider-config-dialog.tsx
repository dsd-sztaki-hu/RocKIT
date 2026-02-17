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

export class RemoteSchemaProviderConfigDialog extends AbstractDialog<RemoteSchemaProviderConfig | undefined> {

    private reactRoot: ReactDOM.Root | undefined;
    
    // Form State
    private titleValue: string = '';
    private baseUrlValue: string = '';
    private apiKeyValue: string = '';
    private typeValue: 'CEDAR' = 'CEDAR';
    
    private isEditingKey = true;
    private isTesting = false;
    private showKey = false; // Toggle password visibility
    private errorMsg: string | null = null;
    private result: RemoteSchemaProviderConfig | undefined;

    constructor(
        private readonly providerStore: RemoteSchemaProviderStoreService,
        private readonly providerToEdit?: RemoteSchemaProviderConfig
    ) {
        super({
            title: providerToEdit ? 'Edit Provider' : 'Add Provider'
        });
        
        this.contentNode.style.width = '500px';
        this.contentNode.style.padding = '0'; // Handle padding in React

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

        const inputStyle: React.CSSProperties = {
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            fontSize: '13px',
            border: '1px solid var(--theia-input-border, #ccc)',
            backgroundColor: 'var(--theia-input-background)',
            color: 'var(--theia-input-foreground)',
            borderRadius: '2px',
            marginTop: '4px'
        };

        const labelStyle: React.CSSProperties = {
            fontSize: 'var(--theia-ui-font-size0)',
            fontWeight: 600,
            color: 'var(--theia-foreground)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
        };

        this.reactRoot.render(
            <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                height: '100%', // Take full height
                backgroundColor: 'var(--theia-editor-background)',
                color: 'var(--theia-foreground)'
            }}>
                
                {/* Scrollable Content Area */}
                <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
                    {/* Header Info */}
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '20px' }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '42px', height: '42px', borderRadius: '50%',
                            backgroundColor: 'var(--theia-list-hoverBackground)',
                            border: '1px solid var(--theia-contrastBorder, transparent)'
                        }}>
                            <DnsIcon style={{ color: 'var(--theia-textLink-foreground)', fontSize: '24px' }} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 'var(--theia-ui-font-size1)' }}>
                                {this.providerToEdit ? 'Edit Connection' : 'New Connection'}
                            </div>
                            <div style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)' }}>
                                Configure connection details for a remote metadata repository.
                            </div>
                        </div>
                    </div>

                    {this.errorMsg && (
                        <div style={{ 
                            color: 'var(--theia-errorForeground)', 
                            border: '1px solid var(--theia-errorForeground)', 
                            padding: '10px', 
                            borderRadius: '4px',
                            marginBottom: '15px',
                            fontSize: '0.9em',
                            backgroundColor: 'rgba(255, 0, 0, 0.05)'
                        }}>
                            <strong>Error:</strong> {this.errorMsg}
                        </div>
                    )}

                    {/* Form Fields */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                        
                        {/* Title */}
                        <div>
                            <label style={labelStyle}>
                                Name (Display)
                            </label>
                            <input 
                                className="theia-input" 
                                style={inputStyle}
                                value={this.titleValue}
                                onChange={(e) => { this.titleValue = e.target.value; this.render(); }}
                                disabled={this.isTesting}
                                placeholder="e.g. ARP Production"
                                autoFocus
                            />
                        </div>

                        {/* Base URL */}
                        <div>
                            <label style={labelStyle}>
                                <LinkIcon style={{ fontSize: '16px', opacity: 0.7 }}/> Base URL
                            </label>
                            <input 
                                className="theia-input" 
                                style={inputStyle}
                                placeholder="https://cedar.schema.researchdata.hu"
                                value={this.baseUrlValue}
                                onChange={(e) => { this.baseUrlValue = e.target.value; this.render(); }}
                                disabled={this.isTesting}
                            />
                        </div>

                        {/* Type Dropdown */}
                        <div>
                            <label style={labelStyle}>
                                <CategoryIcon style={{ fontSize: '16px', opacity: 0.7 }}/> Type
                            </label>
                            <select 
                                className="theia-select" 
                                style={{ ...inputStyle, cursor: 'pointer' }}
                                value={this.typeValue}
                                onChange={(e) => { this.typeValue = e.target.value as any; this.render(); }}
                                disabled={this.isTesting} 
                            >
                                <option value="CEDAR">CEDAR</option>
                            </select>
                        </div>

                        {/* API Key */}
                        <div>
                            <label style={labelStyle}>
                                <VpnKeyIcon style={{ fontSize: '16px', opacity: 0.7 }}/> API Key (Optional)
                            </label>
                            <div style={{ position: 'relative', display: 'flex', marginTop: '4px' }}>
                                <input 
                                    className="theia-input" 
                                    type={this.showKey ? "text" : "password"}
                                    style={{ ...inputStyle, marginTop: 0, paddingRight: '40px' }}
                                    value={this.isEditingKey ? this.apiKeyValue : '********'}
                                    onChange={(e) => { this.apiKeyValue = e.target.value; this.render(); }}
                                    disabled={!this.isEditingKey || this.isTesting}
                                    placeholder={this.isEditingKey ? "Paste API Key here" : "Stored securely"}
                                />
                                {this.isEditingKey ? (
                                    <div style={{ position: 'absolute', right: '5px', top: '50%', transform: 'translateY(-50%)' }}>
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
                                        className="theia-button secondary"
                                        style={{ marginLeft: '8px', whiteSpace: 'nowrap', height: '32px' }}
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
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end', 
                    gap: '10px', 
                    padding: '15px 20px',
                    backgroundColor: 'var(--theia-layout-color2)', // Consistent footer
                    borderTop: '1px solid var(--theia-panel-border)'
                }}>
                    <button 
                        className="theia-button secondary"
                        onClick={() => this.handleCancel()}
                        disabled={this.isTesting}
                        style={{ 
                            minWidth: '80px',
                            border: '1px solid var(--theia-button-border, #ccc)' // Visible border in light mode
                        }}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main"
                        onClick={() => this.handleSaveAttempt()}
                        disabled={this.isTesting}
                        style={{ minWidth: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
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