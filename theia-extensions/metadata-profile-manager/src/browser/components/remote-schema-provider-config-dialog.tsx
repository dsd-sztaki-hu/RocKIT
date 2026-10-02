// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// src/browser/components/remote-schema-provider-config-dialog.tsx

import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import DnsIcon from '@mui/icons-material/Dns';
import LinkIcon from '@mui/icons-material/Link';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import CategoryIcon from '@mui/icons-material/Category';
import SecurityIcon from '@mui/icons-material/Security';
import { IconButton } from '@mui/material';
import { nls } from '@theia/core/lib/common/nls';

import { ConnectionSuccessDialog } from './connection-success-dialog';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';
import { createDefaultArpProductionProvider, type RemoteProfileProviderConfig } from '../types';
import '../styles/remote-schema-provider-config-dialog.css';

export class RemoteProfileProviderConfigDialog extends AbstractDialog<RemoteProfileProviderConfig | undefined> {

    private reactRoot: Root | undefined;
    
    // Form State
    private titleValue: string = '';
    private baseUrlValue: string = '';
    private apiKeyValue: string = '';
    private typeValue: 'CEDAR' = 'CEDAR';
    private accessModeValue: 'apiKey' | 'dataverseProxy' = 'dataverseProxy';
    private dataverseProxyBaseUrlValue: string = '';
    
    private isEditingKey = true;
    private isTesting = false;
    private showKey = false; 
    private errorMsg: string | null = null;
    private result: RemoteProfileProviderConfig | undefined;
    private newProviderDefaults: RemoteProfileProviderConfig | undefined;

    constructor(
        private readonly providerStore: RemoteSchemaProviderStoreService,
        private readonly providerToEdit?: RemoteProfileProviderConfig
    ) {
        super({
            title: providerToEdit
                ? nls.localize('rockit/profileManager/editProvider', 'Edit Provider')
                : nls.localize('rockit/profileManager/addProvider', 'Add Provider')
        });
        
        this.contentNode.style.width = '500px';
        this.contentNode.style.padding = '0';
        // Actions are rendered in the React footer, so the native Theia control row is unused.
        this.controlPanel.remove();

        if (providerToEdit) {
            this.titleValue = providerToEdit.title;
            this.baseUrlValue = providerToEdit.baseUrl;
            this.accessModeValue = providerToEdit.accessMode || (providerToEdit.apiKey ? 'apiKey' : 'dataverseProxy');
            this.dataverseProxyBaseUrlValue = providerToEdit.dataverseProxyBaseUrl || this.deriveDataverseProxyBaseUrl(providerToEdit.domainBase || providerToEdit.baseUrl);
            this.apiKeyValue = providerToEdit.apiKey || '';
            this.isEditingKey = false; 
        }
    }

    get value(): RemoteProfileProviderConfig | undefined {
        return this.result;
    }

    private handlePrefillDefaults() {
        const defaults = createDefaultArpProductionProvider();
        this.newProviderDefaults = defaults;
        this.titleValue = defaults.title;
        this.baseUrlValue = defaults.baseUrl;
        this.typeValue = defaults.type;
        this.accessModeValue = defaults.accessMode || 'dataverseProxy';
        this.dataverseProxyBaseUrlValue = defaults.dataverseProxyBaseUrl || '';
        this.apiKeyValue = '';
        this.errorMsg = null;
        this.render();
    }

    private async handleSaveAttempt() {
        if (!this.titleValue || !this.baseUrlValue) {
            this.errorMsg = nls.localize(
                'rockit/profileManager/titleAndUrlRequired',
                'Title and Base URL are required.',
            );
            this.render();
            return;
        }

        this.isTesting = true;
        this.errorMsg = null;
        this.render();

        const domainBase = this.calculateDomainBase(this.baseUrlValue);
        const proxyUrl = this.accessModeValue === 'dataverseProxy'
            ? this.buildDataverseProxyUrl(this.dataverseProxyBaseUrlValue || this.deriveDataverseProxyBaseUrl(domainBase))
            : undefined;
        const apiKey = this.accessModeValue === 'apiKey' ? this.apiKeyValue || undefined : undefined;
        
        try {
            const schemaNames = await this.providerStore.testConnection(domainBase, apiKey, proxyUrl);

            const successDialog = new ConnectionSuccessDialog(this.titleValue, schemaNames);
            const confirmed = await successDialog.open();

            if (confirmed) {
                this.result = {
                    id: this.providerToEdit?.id || this.newProviderDefaults?.id || Date.now().toString(),
                    title: this.titleValue,
                    baseUrl: this.baseUrlValue,
                    domainBase: domainBase,
                    type: this.typeValue,
                    resourceBaseUrl: this.providerToEdit?.resourceBaseUrl || this.newProviderDefaults?.resourceBaseUrl,
                    registryFolderId: this.providerToEdit?.registryFolderId || this.newProviderDefaults?.registryFolderId,
                    accessMode: this.accessModeValue,
                    dataverseProxyBaseUrl: this.accessModeValue === 'dataverseProxy'
                        ? (this.dataverseProxyBaseUrlValue || this.deriveDataverseProxyBaseUrl(domainBase))
                        : undefined,
                    apiKey: apiKey
                };
                this.accept(); 
            }
        } catch (err: any) {
            this.errorMsg = nls.localize(
                'rockit/profileManager/connectionFailed',
                'Connection failed: {0}',
                err.message || nls.localize('rockit/validation/unknownError', 'Unknown error'),
            );
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

    private deriveDataverseProxyBaseUrl(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) return 'https://repo.researchdata.hu';
        try {
            const urlObj = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
            const parts = urlObj.hostname.split('.');
            const first = parts[0]?.toLowerCase();
            if (first === 'schema') {
                parts[0] = 'repo';
            } else if (['cedar', 'resource', 'open', 'openview'].includes(first)) {
                parts.shift();
                if (parts[0]?.toLowerCase() === 'schema') {
                    parts[0] = 'repo';
                } else {
                    parts.unshift('repo');
                }
            } else if (first !== 'repo') {
                parts.unshift('repo');
            }
            urlObj.hostname = parts.join('.');
            urlObj.pathname = '';
            urlObj.search = '';
            urlObj.hash = '';
            return urlObj.origin;
        } catch {
            return trimmed;
        }
    }

    private buildDataverseProxyUrl(baseUrl: string): string {
        return `${baseUrl.replace(/\/+$/, '')}/api/arp/cedarResourceProxy?url=`;
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
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
                                {this.providerToEdit
                                    ? nls.localize('rockit/profileManager/editConnection', 'Edit Connection')
                                    : nls.localize('rockit/profileManager/newConnection', 'New Connection')}
                            </div>
                            <div className="remote-provider-config__description">
                                {nls.localize(
                                    'rockit/profileManager/configureConnectionDescription',
                                    'Configure connection details for a remote metadata repository.',
                                )}
                            </div>
                        </div>
                    </div>

                    {this.errorMsg && (
                        <div className="remote-provider-config__error">
                            <strong>{nls.localize('rockit/profileManager/error', 'Error')}:</strong> {this.errorMsg}
                        </div>
                    )}

                    {/* Form Fields */}
                    <div className="remote-provider-config__form">
                        
                        {/* Title */}
                        <div>
                            <label className="remote-provider-config__label">
                                {nls.localize('rockit/profileManager/displayName', 'Name (Display)')}
                            </label>
                            <input 
                                className="theia-input remote-provider-config__input" 
                                value={this.titleValue}
                                onChange={(e) => { this.titleValue = e.target.value; this.render(); }}
                                disabled={this.isTesting}
                                placeholder={nls.localize(
                                    'rockit/profileManager/displayNamePlaceholder',
                                    'e.g. ARP Production',
                                )}
                                autoFocus
                            />
                        </div>

                        {/* Base URL */}
                        <div>
                            <label className="remote-provider-config__label">
                                <LinkIcon style={{ fontSize: '16px', opacity: 0.7 }}/> {nls.localize('rockit/profileManager/baseUrl', 'Base URL')}
                            </label>
                            <input 
                                className="theia-input remote-provider-config__input" 
                                placeholder="https://cedar.schema.researchdata.hu"
                                value={this.baseUrlValue}
                                onChange={(e) => {
                                    this.baseUrlValue = e.target.value;
                                    if (this.accessModeValue === 'dataverseProxy') {
                                        this.dataverseProxyBaseUrlValue = this.deriveDataverseProxyBaseUrl(this.calculateDomainBase(e.target.value));
                                    }
                                    this.render();
                                }}
                                disabled={this.isTesting}
                            />
                        </div>

                        {/* Type Dropdown */}
                        <div>
                            <label className="remote-provider-config__label">
                                <CategoryIcon style={{ fontSize: '16px', opacity: 0.7 }}/> {nls.localize('rockit/profileManager/type', 'Type')}
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

                        {/* Access Mode */}
                        <div>
                            <label className="remote-provider-config__label">
                                <SecurityIcon style={{ fontSize: '16px', opacity: 0.7 }}/> {nls.localize('rockit/profileManager/access', 'Access')}
                            </label>
                            <select
                                className="theia-select remote-provider-config__select"
                                value={this.accessModeValue}
                                onChange={(e) => {
                                    this.accessModeValue = e.target.value as 'apiKey' | 'dataverseProxy';
                                    if (this.accessModeValue === 'dataverseProxy' && !this.dataverseProxyBaseUrlValue) {
                                        this.dataverseProxyBaseUrlValue = this.deriveDataverseProxyBaseUrl(this.calculateDomainBase(this.baseUrlValue));
                                    }
                                    this.render();
                                }}
                                disabled={this.isTesting}
                            >
                                <option value="dataverseProxy">{nls.localize('rockit/profileManager/dataverseProxy', 'Dataverse proxy (read-only)')}</option>
                                <option value="apiKey">{nls.localize('rockit/profileManager/cedarApiKey', 'CEDAR API key')}</option>
                            </select>
                        </div>

                        {this.accessModeValue === 'dataverseProxy' && (
                            <div>
                                <label className="remote-provider-config__label">
                                    <LinkIcon style={{ fontSize: '16px', opacity: 0.7 }}/> {nls.localize('rockit/profileManager/dataverseProxyUrl', 'Dataverse Proxy Base URL')}
                                </label>
                                <input
                                    className="theia-input remote-provider-config__input"
                                    placeholder="https://repo.researchdata.hu"
                                    value={this.dataverseProxyBaseUrlValue || this.deriveDataverseProxyBaseUrl(this.calculateDomainBase(this.baseUrlValue))}
                                    onChange={(e) => { this.dataverseProxyBaseUrlValue = e.target.value; this.render(); }}
                                    disabled={this.isTesting}
                                />
                            </div>
                        )}

                        {/* API Key */}
                        {this.accessModeValue === 'apiKey' && (
                        <div>
                            <label className="remote-provider-config__label">
                                <VpnKeyIcon style={{ fontSize: '16px', opacity: 0.7 }}/> API Key
                            </label>
                            <div className="remote-provider-config__api-key-wrapper">
                                <input 
                                    className="theia-input remote-provider-config__input remote-provider-config__input--password" 
                                    type={this.showKey ? "text" : "password"}
                                    value={this.isEditingKey ? this.apiKeyValue : '********'}
                                    onChange={(e) => { this.apiKeyValue = e.target.value; this.render(); }}
                                    disabled={!this.isEditingKey || this.isTesting}
                                    placeholder={this.isEditingKey
                                        ? nls.localize('rockit/profileManager/pasteApiKey', 'Paste API Key here')
                                        : nls.localize('rockit/profileManager/storedSecurely', 'Stored securely')}
                                />
                                {this.isEditingKey ? (
                                    <div className="remote-provider-config__visibility-toggle">
                                        <IconButton 
                                            size="small" 
                                            onClick={() => { this.showKey = !this.showKey; this.render(); }}
                                            style={{ color: 'var(--theia-foreground)', opacity: 0.7 }}
                                            title={this.showKey
                                                ? nls.localize('rockit/profileManager/hideApiKey', 'Hide API Key')
                                                : nls.localize('rockit/profileManager/showApiKey', 'Show API Key')}
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
                                        {nls.localize('rockit/profileManager/change', 'Change')}
                                    </button>
                                )}
                            </div>
                        </div>
                        )}
                    </div>
                </div>

                {/* Footer Section */}
                <div className="remote-provider-config__footer">
                    {!this.providerToEdit && (
                        <button
                            className="theia-button secondary remote-provider-config__btn-defaults"
                            onClick={() => this.handlePrefillDefaults()}
                            disabled={this.isTesting}
                        >
                            {nls.localize('rockit/profileManager/useArpDefaults', 'Set default')}
                        </button>
                    )}
                    <div className="remote-provider-config__footer-spacer" />
                    <button 
                        className="theia-button secondary remote-provider-config__btn-cancel"
                        onClick={() => this.handleCancel()}
                        disabled={this.isTesting}
                    >
                        {nls.localize('rockit/common/cancel', 'Cancel')}
                    </button>
                    <button 
                        className="theia-button main remote-provider-config__btn-save"
                        onClick={() => this.handleSaveAttempt()}
                        disabled={this.isTesting}
                    >
                        {this.isTesting && <i className="codicon codicon-loading codicon-modifier-spin" />}
                        {this.isTesting
                            ? nls.localize('rockit/profileManager/verifying', 'Verifying...')
                            : nls.localize('rockit/profileManager/save', 'Save')}
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
