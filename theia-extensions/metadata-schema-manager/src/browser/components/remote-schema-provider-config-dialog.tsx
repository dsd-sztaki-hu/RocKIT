import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

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
    private errorMsg: string | null = null;
    private result: RemoteSchemaProviderConfig | undefined;

    constructor(
        private readonly providerStore: RemoteSchemaProviderStoreService,
        private readonly providerToEdit?: RemoteSchemaProviderConfig
    ) {
        super({
            title: providerToEdit ? 'Edit Remote Schema Provider' : 'New Remote Schema Provider'
        });
        
        this.contentNode.style.width = '500px';

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
            this.errorMsg = `Connection failed: ${err.message || 'Unknown error'}`;
        } finally {
            this.isTesting = false;
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                
                {this.errorMsg && (
                    <div style={{ 
                        color: 'var(--theia-errorForeground)', 
                        border: '1px solid var(--theia-errorForeground)', 
                        padding: '8px', 
                        borderRadius: '2px',
                        fontSize: '0.9em'
                    }}>
                        {this.errorMsg}
                    </div>
                )}

                <div>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Title (Display Name)</label>
                    <input 
                        className="theia-input" 
                        style={{ width: '100%' }}
                        value={this.titleValue}
                        onChange={(e) => { this.titleValue = e.target.value; this.render(); }}
                        disabled={this.isTesting}
                        autoFocus
                    />
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Base URL</label>
                    <input 
                        className="theia-input" 
                        style={{ width: '100%' }}
                        placeholder="https://cedar.schema.researchdata.hu"
                        value={this.baseUrlValue}
                        onChange={(e) => { this.baseUrlValue = e.target.value; this.render(); }}
                        disabled={this.isTesting}
                    />
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '5px' }}>Type</label>
                    {/* FIX: Removed disabled={true} to allow expansion */}
                    <select 
                        className="theia-select" 
                        style={{ width: '100%' }}
                        value={this.typeValue}
                        onChange={(e) => { this.typeValue = e.target.value as any; this.render(); }}
                        disabled={this.isTesting} 
                    >
                        <option value="CEDAR">CEDAR</option>
                    </select>
                </div>

                <div>
                    <label style={{ display: 'block', marginBottom: '5px' }}>API Key (Optional)</label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                        <input 
                            className="theia-input" 
                            type="password"
                            style={{ flex: 1 }}
                            value={this.isEditingKey ? this.apiKeyValue : '********'}
                            onChange={(e) => { this.apiKeyValue = e.target.value; this.render(); }}
                            disabled={!this.isEditingKey || this.isTesting}
                            placeholder={this.isEditingKey ? "Enter Key" : "Stored securely"}
                        />
                        {!this.isEditingKey && (
                            <button 
                                className="theia-button"
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

                {this.isTesting && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: 0.7 }}>
                        <i className="codicon codicon-loading codicon-modifier-spin" /> 
                        <span>Verifying connection...</span>
                    </div>
                )}

                {/* FOOTER BUTTONS */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                    <button 
                        className="theia-button secondary"
                        onClick={() => this.handleCancel()}
                        disabled={this.isTesting}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main"
                        onClick={() => this.handleSaveAttempt()}
                        disabled={this.isTesting}
                    >
                        Save
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