import { AbstractDialog, Message } from '@theia/core/lib/browser';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import DnsIcon from '@mui/icons-material/Dns';
import LinkIcon from '@mui/icons-material/Link';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import CategoryIcon from '@mui/icons-material/Category';
import { IconButton } from '@mui/material';

import { DataRepositoryConfig } from '../types';
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
    private errorMsg: string | null = null;
    private result: DataRepositoryConfig | undefined;

    constructor(private readonly repoToEdit?: DataRepositoryConfig) {
        super({
            title: repoToEdit ? 'Edit Repository' : 'Add Repository'
        });
        
        this.contentNode.style.width = '500px';
        this.contentNode.style.padding = '0';

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

    private handleSaveAttempt() {
        if (!this.titleValue || !this.baseUrlValue) {
            this.errorMsg = "Title and Base URL are required.";
            this.render();
            return;
        }

        this.result = {
            id: this.repoToEdit ? this.repoToEdit.id : Date.now().toString(),
            title: this.titleValue,
            baseUrl: this.baseUrlValue,
            type: this.typeValue,
            apiKey: this.apiKeyValue || undefined
        };
        
        this.accept(); 
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
                    
                    {/* Header Info */}
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
                            <strong>Error:</strong> {this.errorMsg}
                        </div>
                    )}

                    {/* Form Fields */}
                    <div className="data-repo-config__form">
                        
                        {/* Title */}
                        <div>
                            <label className="data-repo-config__label">Name (Display)</label>
                            <input 
                                className="theia-input data-repo-config__input" 
                                value={this.titleValue}
                                onChange={(e) => { this.titleValue = e.target.value; this.render(); }}
                                placeholder="e.g. ARP Research Data Repository"
                                autoFocus
                            />
                        </div>

                        {/* Base URL */}
                        <div>
                            <label className="data-repo-config__label">
                                <LinkIcon style={{ fontSize: '16px', opacity: 0.7 }}/> Base URL
                            </label>
                            <input 
                                className="theia-input data-repo-config__input" 
                                placeholder="https://repo.researchdata.hu"
                                value={this.baseUrlValue}
                                onChange={(e) => { this.baseUrlValue = e.target.value; this.render(); }}
                            />
                        </div>

                        {/* Type Dropdown */}
                        <div>
                            <label className="data-repo-config__label">
                                <CategoryIcon style={{ fontSize: '16px', opacity: 0.7 }}/> Type
                            </label>
                            <select 
                                className="theia-select data-repo-config__select" 
                                value={this.typeValue}
                                onChange={(e) => { this.typeValue = e.target.value; this.render(); }}
                            >
                                <option value="ARP Dataverse">ARP Dataverse</option>
                            </select>
                        </div>

                        {/* API Key */}
                        <div>
                            <label className="data-repo-config__label">
                                <VpnKeyIcon style={{ fontSize: '16px', opacity: 0.7 }}/> API Key (Optional)
                            </label>
                            <div className="data-repo-config__api-key-wrapper">
                                <input 
                                    className="theia-input data-repo-config__input data-repo-config__input--password" 
                                    type={this.showKey ? "text" : "password"}
                                    value={this.isEditingKey ? this.apiKeyValue : '••••••••••••••••'}
                                    onChange={(e) => { this.apiKeyValue = e.target.value; this.render(); }}
                                    disabled={!this.isEditingKey}
                                    placeholder={this.isEditingKey ? "Paste API Key here" : "Stored securely"}
                                />
                                {this.isEditingKey ? (
                                    <div className="data-repo-config__visibility-toggle">
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
                                        className="theia-button secondary data-repo-config__change-btn"
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
                <div className="data-repo-config__footer">
                    <button 
                        className="theia-button secondary data-repo-config__btn-cancel"
                        onClick={() => this.handleCancel()}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main data-repo-config__btn-save"
                        onClick={() => this.handleSaveAttempt()}
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