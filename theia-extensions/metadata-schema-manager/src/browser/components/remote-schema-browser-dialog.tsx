// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// src/browser/components/remote-schema-browser-dialog.tsx

import { injectable, inject } from 'inversify';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { FrontendApplicationContribution, AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { nls } from '@theia/core/lib/common/nls';
import { IconButton, Tooltip } from '@mui/material'; 
import CenterFocusWeakIcon from '@mui/icons-material/CenterFocusWeak'; 
import CancelIcon from '@mui/icons-material/Cancel'; 

import { ProfileManagerService } from '../services/metadata-schema-manager-service';
import { SchemaApi } from '../services/schema-api';
import CedarTree from './cedar-tree';
import { RemoteProfileProviderConfig } from '../types';
import '../styles/remote-schema-browser-dialog.css';

@injectable()
export class RemoteSchemaBrowserContribution implements FrontendApplicationContribution {
    @inject(ProfileManagerService) protected readonly profileManagerService!: ProfileManagerService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;

    onStart(): void {
        this.profileManagerService.onOpenRemoteBrowser((provider) => this.openDialog(provider));
    }

    protected async openDialog(provider: RemoteProfileProviderConfig): Promise<void> {
        const dialog = new RemoteSchemaBrowserDialog(
            provider,
            this.profileManagerService,
            this.envVariablesServer
        );

        const selectedTemplateId = await dialog.open();

        if (selectedTemplateId) {
            this.handleDownload(selectedTemplateId, provider);
        }
    }

    protected async handleDownload(templateId: string, provider: RemoteProfileProviderConfig): Promise<void> {
        try {
            await this.profileManagerService.downloadRemoteProfile(templateId, provider);
        } catch (error: any) {
            // Avoid logging if the user actively aborted the process.
            if (error.message !== 'Aborted') {
                console.error("Download failed", error);
            }
        }
    }
}

export class RemoteSchemaBrowserDialog extends AbstractDialog<string | undefined> {

    private reactRoot: Root | undefined;
    private result: string | undefined;

    constructor(
        private readonly provider: RemoteProfileProviderConfig,
        private readonly profileManagerService: ProfileManagerService,
        private readonly envVariablesServer: EnvVariablesServer
    ) {
        super({
            title: nls.localize('rockit/schemaManager/browseProvider', 'Browse {0}', provider.title)
        });

        this.contentNode.style.width = '600px';
        this.contentNode.style.height = '550px';
        this.contentNode.style.padding = '0';
    }

    get value(): string | undefined {
        return this.result;
    }

    protected handleAccept(value: string) {
        this.result = value;
        this.accept();
    }

    protected handleClose() {
        this.close();
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <BrowserContent
                provider={this.provider}
                profileManagerService={this.profileManagerService}
                envVariablesServer={this.envVariablesServer}
                onAccept={(id) => this.handleAccept(id)}
                onCancel={() => this.handleClose()}
            />
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

interface BrowserContentProps {
    provider: RemoteProfileProviderConfig;
    profileManagerService: ProfileManagerService;
    envVariablesServer: EnvVariablesServer;
    onAccept: (id: string) => void;
    onCancel: () => void;
}

const BrowserContent: React.FC<BrowserContentProps> = ({ 
    provider, 
    profileManagerService,
    onAccept, 
    onCancel 
}) => {
    const [schemaApi, setSchemaApi] = React.useState<SchemaApi | null>(null);
    const [existingIds, setExistingIds] = React.useState<string[]>([]);
    
    const [selectedName, setSelectedName] = React.useState<string | null>(null);
    const [selectedId, setSelectedId] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (provider) {
            let domain = provider.domainBase.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '');
            
            setSchemaApi(new SchemaApi({
                domainBase: domain,
                apiKey: providerApiKey(provider),
                proxyUrl: providerProxyUrl(provider)
            }));

            profileManagerService.loadAllProfiles().then(profiles => {
                const ids = profiles.map(profile => profile.aux.reference);
                setExistingIds(ids);
            });
        }
    }, [provider, profileManagerService]);

    const handleTemplateSelected = (id: string, name: string) => {
        setSelectedId(id);
        setSelectedName(name);
    };

    const handleFolderSelected = (id: string, name: string) => {
        setSelectedId(null);
        setSelectedName(null);
    };

    const handleGoTo = () => {
        if (!selectedId) return;
        const element = document.getElementById(`cedar-node-${selectedId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    const handleDeselect = () => {
        setSelectedId(null);
        setSelectedName(null);
    };

    return (
        <div className="remote-browser-dialog">
            
            <div className="remote-browser-dialog__tree-container">
                {schemaApi ? (
                    <CedarTree
                        schemaApi={schemaApi}
                        alreadySelectedSchemaIds={existingIds}
                        onTemplateSelected={handleTemplateSelected}
                        onFolderSelected={handleFolderSelected}
                    />
                ) : (
                    <div className="remote-browser-dialog__loading">
                        {nls.localize('rockit/schemaManager/initializingConnection', 'Initializing connection...')}
                    </div>
                )}
            </div>

            <div className="remote-browser-dialog__footer">
                
                <div className="remote-browser-dialog__selection-info">
                    {selectedName ? (
                        <>
                            <div className="remote-browser-dialog__controls">
                                <Tooltip title={nls.localize('rockit/schemaManager/locateInTree', 'Locate in Tree')} PopperProps={{ style: { zIndex: 99999 } }}>
                                    <IconButton size="small" onClick={handleGoTo} style={{ padding: 2, color: 'var(--theia-icon-foreground)' }}>
                                        <CenterFocusWeakIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title={nls.localize('rockit/schemaManager/deselect', 'Deselect')} PopperProps={{ style: { zIndex: 99999 } }}>
                                    <IconButton size="small" onClick={handleDeselect} style={{ padding: 2, color: 'var(--theia-errorForeground)' }}>
                                        <CancelIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </div>
                            
                            <span className="remote-browser-dialog__selected-name">
                                {selectedName}
                            </span>
                        </>
                    ) : (
                        <span className="remote-browser-dialog__placeholder">
                            {nls.localize('rockit/schemaManager/selectTemplate', 'Select a template to import...')}
                        </span>
                    )}
                </div>

                <div className="remote-browser-dialog__actions">
                    <button 
                        className="theia-button secondary remote-browser-dialog__btn-cancel"
                        onClick={onCancel}
                    >
                        {nls.localize('rockit/common/cancel', 'Cancel')}
                    </button>
                    <button 
                        className="theia-button main remote-browser-dialog__btn-add"
                        onClick={() => selectedId && onAccept(selectedId)}
                        disabled={!selectedId}
                    >
                        {nls.localize('rockit/schemaManager/add', 'Add')}
                    </button>
                </div>
            </div>
        </div>
    );
};

function providerApiKey(provider: RemoteProfileProviderConfig): string | undefined {
    const accessMode = provider.accessMode || (provider.apiKey ? 'apiKey' : 'dataverseProxy');
    return accessMode === 'apiKey' ? provider.apiKey : undefined;
}

function providerProxyUrl(provider: RemoteProfileProviderConfig): string | undefined {
    const accessMode = provider.accessMode || (provider.apiKey ? 'apiKey' : 'dataverseProxy');
    if (accessMode !== 'dataverseProxy') return undefined;
    const baseUrl = provider.dataverseProxyBaseUrl || deriveDataverseProxyBaseUrl(provider.domainBase || provider.baseUrl || '');
    return `${baseUrl.replace(/\/+$/, '')}/api/arp/cedarResourceProxy?url=`;
}

function deriveDataverseProxyBaseUrl(value: string): string {
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
