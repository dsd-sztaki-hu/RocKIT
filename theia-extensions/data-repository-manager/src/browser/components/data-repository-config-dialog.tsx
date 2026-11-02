// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { AbstractDialog, Message } from '@theia/core/lib/browser';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import DnsIcon from '@mui/icons-material/Dns';
import LinkIcon from '@mui/icons-material/Link';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { IconButton } from '@mui/material';
import { nls } from '@theia/core/lib/common/nls';

import { DataRepositoryConfig } from '../types';
import { DataRepositorySuccessDialog } from './data-repository-success-dialog';
import { RepositoryProviderRegistration } from '../repository-provider-registry';
import { RepositoryProviderService } from '../repository-provider-service';
import type { CrosswalkRegistryEntry } from 'crosswalk-manager/lib/browser/crosswalk-manager-types';
import '../styles/data-repository-config-dialog.css';

export class DataRepositoryConfigDialog extends AbstractDialog<DataRepositoryConfig | undefined> {

    private reactRoot: Root | undefined;
    
    // Form State
    private titleValue: string = '';
    private baseUrlValue: string = '';
    private apiKeyValue: string = '';
    private providerIdValue: string = '';
    private crosswalkIdValue: string = '';
    
    private isEditingKey = true; 
    private showKey = false; 
    private isTesting = false; 
    private errorMsg: string | null = null;
    private result: DataRepositoryConfig | undefined;

    constructor(
        private readonly repoToEdit?: DataRepositoryConfig,
        private readonly providers: RepositoryProviderRegistration[] = [],
        private readonly providerService?: RepositoryProviderService,
        private readonly crosswalks: CrosswalkRegistryEntry[] = []
    ) {
        super({
            title: repoToEdit
                ? nls.localize('rockit/dataRepository/editRepository', 'Edit Repository')
                : nls.localize('rockit/dataRepository/addRepository', 'Add Repository')
        });
        
        this.contentNode.style.width = '500px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.maxHeight = '90vh';
        this.contentNode.style.padding = '0';
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';
        // Actions are rendered in the React footer, so the native Theia control row is unused.
        this.controlPanel.remove();

        if (repoToEdit) {
            this.titleValue = repoToEdit.title;
            this.baseUrlValue = repoToEdit.baseUrl;
            this.apiKeyValue = repoToEdit.apiKey || '';
            this.providerIdValue = repoToEdit.providerId || '';
            this.crosswalkIdValue = repoToEdit.crosswalkId || '';
            this.isEditingKey = false; 
        }
        this.selectSingleCompatibleCrosswalk();
    }

    get value(): DataRepositoryConfig | undefined {
        return this.result;
    }

    private async handleSaveAttempt() {
        const cleanTitle = this.titleValue.trim();
        let cleanBaseUrl = this.baseUrlValue.trim();
        const cleanApiKey = this.apiKeyValue.trim();

        if (!cleanTitle) {
            this.errorMsg = nls.localize('rockit/dataRepository/displayNameRequired', 'Name (Display) is required.');
            this.render(); return;
        }
        if (!cleanBaseUrl) {
            this.errorMsg = nls.localize('rockit/dataRepository/baseUrlRequired', 'Base URL is required.');
            this.render(); return;
        }
        const selectedProvider = this.providers.find(provider => provider.id === this.providerIdValue);
        if (!selectedProvider) {
            this.errorMsg = nls.localize('rockit/dataRepository/providerRequired', 'Repository Type is required.');
            this.render(); return;
        }
        if (!cleanApiKey && selectedProvider?.connection?.requiresApiKey) {
            this.errorMsg = nls.localize('rockit/dataRepository/tokenRequired', 'API Token is required.');
            this.render(); return;
        }

        try {
            const parsedUrl = new URL(cleanBaseUrl);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                throw new Error("Invalid protocol");
            }
            cleanBaseUrl = cleanBaseUrl.replace(/\/+$/, '');
        } catch (e) {
            this.errorMsg = nls.localize('rockit/dataRepository/validBaseUrlRequired', 'Please enter a valid HTTP or HTTPS Base URL.');
            this.render(); return;
        }

        this.isTesting = true;
        this.errorMsg = null;
        this.render();

        let expirationDate: string | undefined = undefined;
        const repository: DataRepositoryConfig = {
            id: this.repoToEdit ? this.repoToEdit.id : Date.now().toString(),
            title: cleanTitle,
            baseUrl: cleanBaseUrl,
            apiKey: cleanApiKey,
            providerId: this.providerIdValue,
            ...(this.crosswalkIdValue ? { crosswalkId: this.crosswalkIdValue } : {})
        };

        try {
            if (!this.providerService) {
                throw new Error('The repository provider service is unavailable.');
            }
            const result = await this.providerService.executeForRepository<
                { repository: DataRepositoryConfig },
                { valid?: boolean; expirationDate?: string }
            >(repository, 'validate', { repository });
            if (!result?.valid) {
                throw new Error('The repository provider did not validate the connection.');
            }
            expirationDate = result.expirationDate;

            const successDialog = new DataRepositorySuccessDialog(cleanTitle, expirationDate);
            const confirmed = await successDialog.open();

            if (confirmed) {
                this.result = repository;
                this.accept(); 
            } else {
                this.isTesting = false;
                this.render();
            }

        } catch (error: any) {
            console.error("Connection Test Failed:", error);
            if (error.message === 'Failed to fetch' || (error.message && error.message.includes('NetworkError'))) {
                this.errorMsg = nls.localize('rockit/dataRepository/serverUnreachable', 'Could not reach the server. Please check the Base URL and your network connection.');
            } else {
                this.errorMsg = error.message || nls.localize('rockit/dataRepository/connectionUnknownError', 'An unknown error occurred during connection testing.');
            }
            this.isTesting = false;
            this.render();
        }
    }

    private handleCancel() {
        this.result = undefined;
        this.close();
    }

    private compatibleCrosswalks(): CrosswalkRegistryEntry[] {
        if (!this.providerIdValue) return this.crosswalks;
        const providerId = this.providerIdValue.toLocaleLowerCase();
        const compatible = this.crosswalks.filter(crosswalk =>
            crosswalk.repositories?.some(repository =>
                repository.toLocaleLowerCase() === providerId
            )
        );
        return compatible.length ? compatible : this.crosswalks;
    }

    private selectSingleCompatibleCrosswalk(): void {
        if (this.crosswalkIdValue) return;
        const compatible = this.compatibleCrosswalks();
        if (this.providerIdValue && compatible.length === 1) {
            this.crosswalkIdValue = compatible[0].id;
        }
    }

    private changeProvider(providerId: string): void {
        this.providerIdValue = providerId;
        if (!this.compatibleCrosswalks().some(crosswalk => crosswalk.id === this.crosswalkIdValue)) {
            this.crosswalkIdValue = '';
        }
        this.selectSingleCompatibleCrosswalk();
        this.render();
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }
        const selectedProviderAvailable = this.providers.some(
            provider => provider.id === this.providerIdValue
        );
        const providerAvailabilityMessage = this.providers.length === 0
            ? nls.localize(
                'rockit/dataRepository/noProvidersInstalledMessage',
                'No repository provider extensions are installed. Install one from the Extensions view before saving this connection.'
            )
            : this.providerIdValue && !selectedProviderAvailable
                ? nls.localize(
                    'rockit/dataRepository/configuredProviderUnavailable',
                    'The configured repository type is unavailable. Install its provider extension or select another repository type.'
                )
                : undefined;
        const saveDisabledReason = this.isTesting
            ? nls.localize(
                'rockit/dataRepository/connectionBeingVerified',
                'The repository connection is being verified.'
            )
            : this.providers.length === 0
                ? nls.localize(
                    'rockit/dataRepository/installProviderBeforeSaving',
                    'Install a repository provider extension before saving this connection.'
                )
                : !selectedProviderAvailable
                    ? nls.localize(
                        'rockit/dataRepository/selectProviderBeforeSaving',
                        'Select a repository type before saving this connection.'
                    )
                    : undefined;

        this.reactRoot.render(
            <div className="data-repo-config">
                <div className="data-repo-config__content">
                    
                    <div className="data-repo-config__header">
                        <div className="data-repo-config__icon-wrapper">
                            <DnsIcon style={{ color: 'var(--theia-textLink-foreground)', fontSize: '24px' }} />
                        </div>
                        <div>
                            <div className="data-repo-config__title">
                                {this.repoToEdit
                                    ? nls.localize('rockit/dataRepository/editConnection', 'Edit Connection')
                                    : nls.localize('rockit/dataRepository/newConnection', 'New Connection')}
                            </div>
                            <div className="data-repo-config__description">
                                {nls.localize('rockit/dataRepository/configureConnection', 'Configure connection details for a remote data repository.')}
                            </div>
                        </div>
                    </div>

                    {this.errorMsg && (
                        <div className="data-repo-config__error">
                            <ErrorOutlineIcon fontSize="small" />
                            <span><strong>{nls.localize('rockit/dataRepository/error', 'Error')}:</strong> {this.errorMsg}</span>
                        </div>
                    )}

                    {providerAvailabilityMessage && (
                        <div className="data-repo-config__error" role="alert">
                            <ErrorOutlineIcon fontSize="small" />
                            <span>
                                <strong>{nls.localize('rockit/dataRepository/actionRequired', 'Action required')}:</strong>{' '}
                                {providerAvailabilityMessage}
                            </span>
                        </div>
                    )}

                    <div className="data-repo-config__form">
                        
                        <div>
                            <label className="data-repo-config__label">{nls.localize('rockit/dataRepository/displayName', 'Name (Display)')}</label>
                            <input 
                                className="theia-input data-repo-config__input" 
                                value={this.titleValue}
                                onChange={(e) => { this.titleValue = e.target.value; this.render(); }}
                                disabled={this.isTesting}
                                placeholder={nls.localize('rockit/dataRepository/displayNamePlaceholder', 'e.g. ARP Research Data Repository')}
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="data-repo-config__label">
                                {nls.localize('rockit/dataRepository/providerType', 'Repository Type')}
                            </label>
                            <select
                                className="theia-select data-repo-config__input"
                                value={selectedProviderAvailable ? this.providerIdValue : ''}
                                disabled={this.isTesting || this.providers.length === 0}
                                onChange={(event) => this.changeProvider(event.target.value)}
                            >
                                <option value="" disabled>
                                    {this.providers.length === 0
                                        ? nls.localize(
                                            'rockit/dataRepository/noProvidersInstalled',
                                            'No repository types installed'
                                        )
                                        : nls.localize(
                                            'rockit/dataRepository/selectProvider',
                                            'Select a repository type'
                                        )}
                                </option>
                                {this.providers.map(provider => (
                                    <option key={provider.id} value={provider.id}>
                                        {provider.displayName}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {this.crosswalks.length > 0 && (
                            <div>
                                <label className="data-repo-config__label">
                                    {nls.localize('rockit/dataRepository/crosswalk', 'Metadata Crosswalk')}
                                </label>
                                <select
                                    className="theia-select data-repo-config__input"
                                    value={this.crosswalkIdValue}
                                    disabled={this.isTesting}
                                    onChange={(event) => {
                                        this.crosswalkIdValue = event.target.value;
                                        this.render();
                                    }}
                                >
                                    <option value="">
                                        {nls.localize('rockit/dataRepository/noCrosswalk', 'No crosswalk')}
                                    </option>
                                    {this.compatibleCrosswalks().map(crosswalk => (
                                        <option key={crosswalk.id} value={crosswalk.id}>
                                            {crosswalk.name}
                                        </option>
                                    ))}
                                    {this.crosswalkIdValue &&
                                        !this.crosswalks.some(crosswalk => crosswalk.id === this.crosswalkIdValue) && (
                                            <option value={this.crosswalkIdValue} disabled>
                                                {nls.localize(
                                                    'rockit/dataRepository/missingCrosswalk',
                                                    'Missing crosswalk: {0}',
                                                    this.crosswalkIdValue,
                                                )}
                                            </option>
                                        )}
                                </select>
                                <div className="data-repo-config__field-hint">
                                    {nls.localize(
                                        'rockit/dataRepository/crosswalkHint',
                                        'RocKIT uses this crosswalk for repository metadata import, export, update, and synchronization.',
                                    )}
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="data-repo-config__label">
                                <LinkIcon style={{ fontSize: '16px', opacity: 0.7 }}/> {nls.localize('rockit/dataRepository/baseUrl', 'Base URL')}
                            </label>
                            <input 
                                className="theia-input data-repo-config__input" 
                                placeholder="https://repo.researchdata.hu"
                                value={this.baseUrlValue}
                                disabled={this.isTesting}
                                onChange={(e) => { this.baseUrlValue = e.target.value; this.render(); }}
                            />
                        </div>

                        <div>
                            <label className="data-repo-config__label">
                                <VpnKeyIcon style={{ fontSize: '16px', opacity: 0.7 }}/> {nls.localize('rockit/dataRepository/apiToken', 'API Token')}
                            </label>
                            <div className="data-repo-config__api-key-wrapper">
                                <div className="data-repo-config__input-icon-wrapper">
                                    <input 
                                        className="theia-input data-repo-config__input data-repo-config__input--password" 
                                        type={this.showKey ? "text" : "password"}
                                        value={this.isEditingKey ? this.apiKeyValue : '••••••••••••••••'}
                                        onChange={(e) => { this.apiKeyValue = e.target.value; this.render(); }}
                                        disabled={!this.isEditingKey || this.isTesting}
                                        placeholder={this.isEditingKey
                                            ? nls.localize('rockit/dataRepository/pasteToken', 'Paste API Token here')
                                            : nls.localize('rockit/dataRepository/storedSecurely', 'Stored securely')}
                                    />
                                    {this.isEditingKey && (
                                        <div className="data-repo-config__visibility-toggle">
                                            <IconButton 
                                                size="small" 
                                                onClick={() => { this.showKey = !this.showKey; this.render(); }}
                                                disabled={this.isTesting}
                                                style={{ color: 'var(--theia-foreground)', opacity: 0.7 }}
                                                title={this.showKey
                                                    ? nls.localize('rockit/dataRepository/hideToken', 'Hide API Token')
                                                    : nls.localize('rockit/dataRepository/showToken', 'Show API Token')}
                                            >
                                                {this.showKey ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                            </IconButton>
                                        </div>
                                    )}
                                </div>
                                {!this.isEditingKey && (
                                    <button 
                                        className="theia-button secondary data-repo-config__change-btn"
                                        disabled={this.isTesting}
                                        onClick={() => { 
                                            this.isEditingKey = true; 
                                            this.apiKeyValue = ''; 
                                            this.render(); 
                                        }}
                                    >
                                        {nls.localize('rockit/dataRepository/change', 'Change')}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="data-repo-config__footer">
                    <button 
                        className="theia-button secondary data-repo-config__btn-cancel"
                        onClick={() => this.handleCancel()}
                        disabled={this.isTesting}
                    >
                        {nls.localize('rockit/common/cancel', 'Cancel')}
                    </button>
                    <span
                        className={`data-repo-config__save-tooltip${
                            saveDisabledReason ? ' data-repo-config__save-tooltip--disabled' : ''
                        }`}
                        title={saveDisabledReason}
                    >
                        <button
                            className="theia-button main data-repo-config__btn-save"
                            onClick={() => this.handleSaveAttempt()}
                            disabled={!!saveDisabledReason}
                        >
                            {this.isTesting && <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} />}
                            {this.isTesting
                                ? nls.localize('rockit/dataRepository/verifying', 'Verifying...')
                                : nls.localize('rockit/dataRepository/save', 'Save')}
                        </button>
                    </span>
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
