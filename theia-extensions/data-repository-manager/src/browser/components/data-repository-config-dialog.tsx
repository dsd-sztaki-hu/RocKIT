import { AbstractDialog, Message } from '@theia/core/lib/browser';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import DnsIcon from '@mui/icons-material/Dns';
import LinkIcon from '@mui/icons-material/Link';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import CategoryIcon from '@mui/icons-material/Category';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { IconButton } from '@mui/material';

import { DataRepositoryConfig } from '../types';
import { DataRepositorySuccessDialog } from './data-repository-success-dialog';
import { DataverseService } from '../services/dataverse-service';
import '../styles/data-repository-config-dialog.css';

export class DataRepositoryConfigDialog extends AbstractDialog<DataRepositoryConfig | undefined> {

    private reactRoot: Root | undefined;
    
    // Form State
    private titleValue: string = '';
    private baseUrlValue: string = '';
    private apiKeyValue: string = '';
    private typeValue: string = 'ARP Dataverse';
    
    private isEditingKey = true; 
    private showKey = false; 
    private isTesting = false; 
    private errorMsg: string | null = null;
    private result: DataRepositoryConfig | undefined;

    constructor(
        private readonly dataverseService: DataverseService,
        private readonly repoToEdit?: DataRepositoryConfig
    ) {
        super({
            title: repoToEdit ? 'Edit Repository' : 'Add Repository'
        });
        
        this.contentNode.style.width = '500px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.maxHeight = '90vh';
        this.contentNode.style.padding = '0';
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';

        if (repoToEdit) {
            this.titleValue = repoToEdit.title;
            this.baseUrlValue = repoToEdit.baseUrl;
            this.typeValue = repoToEdit.type;
            this.apiKeyValue = repoToEdit.apiKey || '';
            this.isEditingKey = false; 
        }
    }

    get value(): DataRepositoryConfig | undefined {
        return this.result;
    }

    private async handleSaveAttempt() {
        const cleanTitle = this.titleValue.trim();
        let cleanBaseUrl = this.baseUrlValue.trim();
        const cleanApiKey = this.apiKeyValue.trim();

        if (!cleanTitle) {
            this.errorMsg = "Name (Display) is required.";
            this.render(); return;
        }
        if (!cleanBaseUrl) {
            this.errorMsg = "Base URL is required.";
            this.render(); return;
        }
        if (!cleanApiKey) {
            this.errorMsg = "API Token is required.";
            this.render(); return;
        }

        try {
            const parsedUrl = new URL(cleanBaseUrl);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                throw new Error("Invalid protocol");
            }
            cleanBaseUrl = cleanBaseUrl.replace(/\/+$/, '');
        } catch (e) {
            this.errorMsg = "Please enter a valid HTTP or HTTPS Base URL.";
            this.render(); return;
        }

        this.isTesting = true;
        this.errorMsg = null;
        this.render();

        let expirationDate: string | undefined = undefined;

        try {
            if (this.typeValue === 'ARP Dataverse') {
                const result = await this.dataverseService.validateToken(cleanBaseUrl, cleanApiKey);
                expirationDate = result.expirationDate;
            }

            const successDialog = new DataRepositorySuccessDialog(cleanTitle, expirationDate);
            const confirmed = await successDialog.open();

            if (confirmed) {
                this.result = {
                    id: this.repoToEdit ? this.repoToEdit.id : Date.now().toString(),
                    title: cleanTitle,
                    baseUrl: cleanBaseUrl,
                    type: this.typeValue,
                    apiKey: cleanApiKey
                };
                this.accept(); 
            } else {
                this.isTesting = false;
                this.render();
            }

        } catch (error: any) {
            console.error("Connection Test Failed:", error);
            if (error.message === 'Failed to fetch' || (error.message && error.message.includes('NetworkError'))) {
                this.errorMsg = "Could not reach the server. Please check the Base URL and your network connection.";
            } else {
                this.errorMsg = error.message || "An unknown error occurred during connection testing.";
            }
            this.isTesting = false;
            this.render();
        }
    }

    private handleCancel() {
        this.result = undefined;
        this.close();
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div className="data-repo-config">
                <div className="data-repo-config__content">
                    
                    <div className="data-repo-config__header">
                        <div className="data-repo-config__icon-wrapper">
                            <DnsIcon style={{ color: 'var(--theia-textLink-foreground)', fontSize: '24px' }} />
                        </div>
                        <div>
                            <div className="data-repo-config__title">
                                {this.repoToEdit ? 'Edit Connection' : 'New Connection'}
                            </div>
                            <div className="data-repo-config__description">
                                Configure connection details for a remote data repository.
                            </div>
                        </div>
                    </div>

                    {this.errorMsg && (
                        <div className="data-repo-config__error">
                            <ErrorOutlineIcon fontSize="small" />
                            <span><strong>Error:</strong> {this.errorMsg}</span>
                        </div>
                    )}

                    <div className="data-repo-config__form">
                        
                        <div>
                            <label className="data-repo-config__label">Name (Display)</label>
                            <input 
                                className="theia-input data-repo-config__input" 
                                value={this.titleValue}
                                onChange={(e) => { this.titleValue = e.target.value; this.render(); }}
                                disabled={this.isTesting}
                                placeholder="e.g. ARP Research Data Repository"
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="data-repo-config__label">
                                <LinkIcon style={{ fontSize: '16px', opacity: 0.7 }}/> Base URL
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
                                <CategoryIcon style={{ fontSize: '16px', opacity: 0.7 }}/> Type
                            </label>
                            <select 
                                className="theia-select data-repo-config__select" 
                                value={this.typeValue}
                                disabled={this.isTesting}
                                onChange={(e) => { this.typeValue = e.target.value; this.render(); }}
                            >
                                <option value="ARP Dataverse">ARP Dataverse</option>
                            </select>
                        </div>

                        <div>
                            <label className="data-repo-config__label">
                                <VpnKeyIcon style={{ fontSize: '16px', opacity: 0.7 }}/> API Token
                            </label>
                            <div className="data-repo-config__api-key-wrapper">
                                <div className="data-repo-config__input-icon-wrapper">
                                    <input 
                                        className="theia-input data-repo-config__input data-repo-config__input--password" 
                                        type={this.showKey ? "text" : "password"}
                                        value={this.isEditingKey ? this.apiKeyValue : '••••••••••••••••'}
                                        onChange={(e) => { this.apiKeyValue = e.target.value; this.render(); }}
                                        disabled={!this.isEditingKey || this.isTesting}
                                        placeholder={this.isEditingKey ? "Paste API Token here" : "Stored securely"}
                                    />
                                    {this.isEditingKey && (
                                        <div className="data-repo-config__visibility-toggle">
                                            <IconButton 
                                                size="small" 
                                                onClick={() => { this.showKey = !this.showKey; this.render(); }}
                                                disabled={this.isTesting}
                                                style={{ color: 'var(--theia-foreground)', opacity: 0.7 }}
                                                title={this.showKey ? "Hide API Token" : "Show API Token"}
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
                                        Change
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
                        Cancel
                    </button>
                    <button 
                        className="theia-button main data-repo-config__btn-save"
                        onClick={() => this.handleSaveAttempt()}
                        disabled={this.isTesting}
                    >
                        {this.isTesting && <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: '6px' }} />}
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