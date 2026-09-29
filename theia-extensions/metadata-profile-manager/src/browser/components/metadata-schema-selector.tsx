// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// src/browser/components/metadata-schema-selector.tsx

import { injectable, inject } from 'inversify';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { FrontendApplicationContribution, AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import CancelIcon from '@mui/icons-material/Cancel'; 
import { IconButton, Tooltip } from '@mui/material';

import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service';
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service';
import { ProfileManagerService } from '../services/metadata-profile-manager-service';
import { MetadataSchemaTable } from './metadata-schema-table';
import { MetadataSchemaToolbar } from './metadata-schema-toolbar';
import { RemoteSchemaProviderListDialog } from './remote-schema-provider-list-dialog';
import { RemoteSchemaProviderSelectorDialog } from './remote-schema-provider-selector-dialog';
import { MetadataSchemaImportFromUrlDialog } from './metadata-schema-import-from-url-dialog';
import type { ProfileInfo } from '../types';
import '../styles/metadata-schema-selector.css';

const MSG_TIMEOUT = 5000;

@injectable()
export class MetadataSchemaSelectorContribution implements FrontendApplicationContribution {
    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(RoCrateHistoryService) protected readonly roCrateHistoryService!: RoCrateHistoryService;
    @inject(ProfileManagerService) protected readonly profileManagerService!: ProfileManagerService;
    @inject(FileDialogService) protected readonly fileDialogService!: FileDialogService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;
    @inject(CommandRegistry) protected readonly commandRegistry!: CommandRegistry;
    @inject(LoadMaskService) protected readonly loadMaskService!: LoadMaskService;

    private isDialogVisible = false;

    onStart(): void {
        const maybeOpen = (isOpen: boolean) => {
            if (isOpen && !this.isDialogVisible) {
                void this.openDialog();
            }
        };

        this.appStateService.onDidChangeSelector(state => state.openSchemaSelectorWindow)(
            (isOpen) => {
                maybeOpen(Boolean(isOpen));
            }
        );

        maybeOpen(Boolean(this.appStateService.getState().openSchemaSelectorWindow));
    }

    protected async openDialog(): Promise<void> {
        this.isDialogVisible = true;
        try {
            const dialog = new MetadataSchemaSelectorDialog(
                this.profileManagerService,
                this.fileDialogService,
                this.messageService,
                this.loadMaskService,
            );

            const selectedSchemas = await dialog.open();

            if (selectedSchemas?.length) {
                await this.handleAssociate(selectedSchemas);
            }
        } catch (err) {
            console.error("Failed to open selector dialog:", err);
            this.messageService.error(
                nls.localize('rockit/profileManager/openSelectorFailed', 'Failed to open profile selector dialog.'),
                { timeout: MSG_TIMEOUT },
            );
        } finally {
            this.isDialogVisible = false;
            this.appStateService.updateState({ 
                openSchemaSelectorWindow: false, 
                schemaSelectorContext: undefined 
            });
        }
    }

    protected async handleAssociate(schemas: ProfileInfo[]): Promise<void> {
        const crate = this.appStateService.roCrate;
        const graph = crate && Array.isArray(crate['@graph']) ? crate['@graph'] as any[] : [];
        const isLargeCrate = graph.length >= 1_000;
        const loadMask = this.loadMaskService.show({
            message: nls.localize('rockit/profileManager/associatingSchema', 'Associating metadata profile...'),
            delay: isLargeCrate ? 0 : undefined,
        });
        try {
            if (isLargeCrate) {
                await this.waitForLoadMaskPaint();
            }
            const ctx = this.appStateService.getState().schemaSelectorContext;
            const entityId = ctx?.entityId ?? './';

            if (!ctx?.entityId) {
            }

            if (crate && graph.length > 0) {
                const w3ids = schemas
                    .map(schema => schema.conformsTo?.trim() || this.profileManagerService.deriveConformsToFromId(schema.aux.reference))
                    .filter((w3id): w3id is string => Boolean(w3id));
                
                if (w3ids.length) {
                    const updatedGraph: any[] = [];
                    let sliceStarted = performance.now();
                    for (let index = 0; index < graph.length; index += 1) {
                        const entry = graph[index];
                        let updatedEntry = entry;
                        if (String(entry['@id']) === entityId) {
                            const existing = entry.conformsTo;
                            const base = existing ? (Array.isArray(existing) ? existing.slice() : [existing]) : [];
                            const normalized = base
                                .map((v: any) => (typeof v === 'string' ? { '@id': v } : v))
                                .filter((v: any) => v && typeof v['@id'] === 'string');

                            const next = w3ids.reduce((acc: any[], w3id) => {
                                const already = acc.some((v: any) => v['@id'] === w3id);
                                return already ? acc : [...acc, { '@id': w3id }];
                            }, normalized);

                            updatedEntry = { ...entry, conformsTo: next };
                        }
                        updatedGraph.push(updatedEntry);

                        if (index % 250 === 0 && performance.now() - sliceStarted >= 12) {
                            loadMask.update({ progress: { worked: index + 1, total: graph.length } });
                            await new Promise<void>(resolve => setTimeout(resolve, 0));
                            sliceStarted = performance.now();
                        }
                    }

                    loadMask.update({
                        message: nls.localize('rockit/profileManager/finalizingAssociation', 'Finalizing profile association...'),
                        progress: { worked: graph.length, total: graph.length },
                    });
                    await new Promise<void>(resolve => setTimeout(resolve, 0));
                    
                    this.roCrateHistoryService.applyRoCrateChange(
                        { ...crate, '@graph': updatedGraph } as any,
                        { label: nls.localize('rockit/profileManager/associateHistory', 'Associate profile with entity') }
                    );
                }
            }

            const schemaNames = schemas.map(schema => schema.name).join(', ');
            const message = schemas.length === 1
                ? nls.localize('rockit/profileManager/associatedSchema', 'Associated profile: {0}', schemaNames)
                : nls.localize(
                    'rockit/profileManager/associatedSchemas',
                    'Associated {0} profiles: {1}',
                    schemas.length,
                    schemaNames,
                );
            this.messageService.info(message, { timeout: MSG_TIMEOUT });

        } catch (e) {
            console.error(e);
            this.messageService.error(
                nls.localize('rockit/profileManager/associateFailed', 'Failed to associate profile.'),
                { timeout: MSG_TIMEOUT },
            );
        } finally {
            loadMask.dispose();
        }
    }

    protected async waitForLoadMaskPaint(): Promise<void> {
        await new Promise<void>(resolve => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            setTimeout(finish, 50);
            requestAnimationFrame(() => requestAnimationFrame(finish));
        });
    }
}

export class MetadataSchemaSelectorDialog extends AbstractDialog<ProfileInfo[] | undefined> {

    protected selectedSchemas: ProfileInfo[] | undefined;
    private reactRoot: Root | undefined;

    constructor(
        protected readonly profileManager: ProfileManagerService,
        protected readonly fileDialog: FileDialogService,
        protected readonly msgService: MessageService,
        protected readonly loadMaskService: LoadMaskService,
    ) {
        super({
            title: nls.localize('rockit/profileManager/selectSchema', 'Select Metadata Profile')
        });
        
        this.contentNode.style.width = '1000px';
        this.contentNode.style.height = '600px';
        this.contentNode.style.maxHeight = '80vh';
        this.contentNode.style.maxWidth = '90vw';
        
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';
    }

    get value(): ProfileInfo[] | undefined {
        return this.selectedSchemas;
    }

    protected handleAccept(schemas: ProfileInfo[]) {
        this.selectedSchemas = schemas;
        this.accept();
    }

    protected handleClose() {
        this.selectedSchemas = undefined;
        this.close();
    }

    protected render(): void {
        if (!this.contentNode) return;

        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <SelectorContent 
                service={this.profileManager}
                fileDialog={this.fileDialog}
                msg={this.msgService}
                loadMask={this.loadMaskService}
                onAccept={(s) => this.handleAccept(s)}
                onCancel={() => this.handleClose()}
            />
        );
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        requestAnimationFrame(() => this.render());
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }
}

interface ContentProps {
    service: ProfileManagerService;
    fileDialog: FileDialogService;
    msg: MessageService;
    loadMask: LoadMaskService;
    onAccept: (schemas: ProfileInfo[]) => void;
    onCancel: () => void;
}

const SelectorContent: React.FC<ContentProps> = ({ service, fileDialog, msg, loadMask, onAccept, onCancel }) => {
    const [schemas, setSchemas] = React.useState<ProfileInfo[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedProfiles, setSelectedProfiles] = React.useState<ProfileInfo[]>([]);

    const isTextEditingTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        const tagName = target.tagName.toLowerCase();
        if (tagName === 'textarea' || target.isContentEditable) {
            return true;
        }

        if (target instanceof HTMLInputElement) {
            const type = target.type.toLowerCase();
            return !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(type);
        }

        return false;
    };

    const loadData = React.useCallback(() => {
        setIsLoading(true);
        service.loadAllProfiles()
            .then(res => {
                setSchemas(res);
                setSelectedProfiles([]);
            })
            .catch(err => console.error(err))
            .finally(() => setIsLoading(false));
    }, [service]);

    React.useEffect(() => {
        loadData();
    }, [loadData]);

    React.useEffect(() => {
        const listener = service.onDidChangeProfiles(() => loadData());
        return () => listener.dispose();
    }, [service, loadData]);

    const handleSelectionChange = (keys: React.Key[]) => {
        const selected = keys
            .map(key => schemas.find(schema => schema.id === key))
            .filter((schema): schema is ProfileInfo => Boolean(schema));
        setSelectedProfiles(selected);
    };

    const handleRowDoubleClick = (schema: ProfileInfo) => {
        onAccept([schema]);
    };

    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.defaultPrevented || !selectedProfiles.length) {
                return;
            }

            if (isTextEditingTarget(event.target)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            onAccept(selectedProfiles);
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [onAccept, selectedProfiles]);

    const handleTableKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' || event.defaultPrevented || !selectedProfiles.length) {
            return;
        }

        if (isTextEditingTarget(event.target)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        onAccept(selectedProfiles);
    };

    const handleRefresh = () => {
        service.clearFailedPendingProfiles();
        loadData();
    };

    const handleDeleteTransient = async (ids: string[]) => {
        try {
            const count = await service.deleteProfiles(ids);
            if (count > 0) msg.info(nls.localize(
                'rockit/profileManager/removedTasks',
                'Aborted/removed {0} task(s).',
                count,
            ), { timeout: MSG_TIMEOUT });
        } catch (e) {
            msg.error(nls.localize('rockit/profileManager/removeTaskFailed', 'Failed to remove task.'), { timeout: MSG_TIMEOUT });
        }
    };

    const handleImportFile = async () => {
        const uris = await fileDialog.showOpenDialog({ 
            title: nls.localize('rockit/profileManager/import', 'Import'), filters: { 'JSON': ['json'] }, canSelectFiles: true, canSelectMany: true
        });
        if (!uris) return;
        const fileUris = Array.isArray(uris) ? uris : [uris];

        loadMask.showProgress({ text: nls.localize('rockit/profileManager/importing', 'Importing...') }).then(async p => {
            try {
                const res = await service.importFiles(fileUris, p);
                if (res.success > 0) msg.info(nls.localize('rockit/profileManager/importedCount', 'Successfully imported {0} profile(s).', res.success), { timeout: MSG_TIMEOUT });
                if (res.fail > 0) msg.warn(nls.localize('rockit/profileManager/importFailedCount', 'Failed to import {0} profile(s).', res.fail), { timeout: MSG_TIMEOUT });
            } catch (e) {
                msg.error(nls.localize('rockit/profileManager/unexpectedImportError', 'Unexpected error during import.'), { timeout: MSG_TIMEOUT });
            } finally { p.cancel(); }
        });
    };

    const handleImportUrl = async (url: string) => {
        loadMask.showProgress({ text: nls.localize('rockit/profileManager/downloadingEllipsis', 'Downloading...') }).then(async p => {
            try {
                const name = await service.importFromUrl(url, p);
                msg.info(nls.localize('rockit/profileManager/importedName', 'Successfully imported: {0}', name), { timeout: MSG_TIMEOUT });
            } catch (e: any) {
                if (e.message !== 'Aborted') {
                    msg.error(`Error: ${e instanceof Error ? e.message : e}`, { timeout: MSG_TIMEOUT });
                }
            } finally { p.cancel(); }
        });
    };

    const handleOpenImportUrl = async () => {
        const dialog = new MetadataSchemaImportFromUrlDialog();
        const url = await dialog.open();
        if (url) handleImportUrl(url);
    };

    const handleOpenProviderList = async () => {
        const dialog = new RemoteSchemaProviderListDialog(service.providerStoreService);
        await dialog.open();
    };

    const handleBrowseRemote = async () => {
        const dialog = new RemoteSchemaProviderSelectorDialog(service.providerStoreService);
        const provider = await dialog.open();
        if (provider) service.browseRemoteProfiles(provider);
    };

    return (
        <div className="metadata-schema-layout-container" style={{ padding: 0 }} onKeyDown={handleTableKeyDown}> 
            
            <MetadataSchemaToolbar 
                onImportFile={handleImportFile} 
                onImportUrl={handleOpenImportUrl} 
                onBrowse={handleBrowseRemote}
                onRefresh={handleRefresh}
                onConfigureProviders={handleOpenProviderList}
            />
            
            <div className="metadata-schema-table-wrapper">
                <MetadataSchemaTable
                    profiles={schemas}
                    isLoading={isLoading}
                    selectionType="checkbox"
                    selectedKeys={selectedProfiles.map(profile => profile.id)}
                    onSelectionChange={handleSelectionChange}
                    onRowDoubleClick={handleRowDoubleClick}
                    allowDeleteValidSchemas={false}
                    disableInvalidRows={true}
                    onDelete={handleDeleteTransient}
                    onRetry={(id) => service.retryProfile(id)}
                />
            </div>
            
            {/* Footer */}
            <div className="schema-selector__footer">
                {/* Left: Selection Info */}
                <div className="schema-selector__info">
                    {selectedProfiles.length ? (
                        <>
                            <Tooltip title={nls.localize('rockit/profileManager/deselect', 'Deselect')} placement="top" classes={{ tooltip: 'schema-table__tooltip' }}>
                                <IconButton 
                                    size="small" 
                                    onClick={() => setSelectedProfiles([])}
                                    className="schema-selector__deselect-btn"
                                >
                                    <CancelIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <span className="schema-selector__selected-text">
                                {selectedProfiles.length === 1
                                    ? nls.localize('rockit/profileManager/selectedName', 'Selected: {0}', selectedProfiles[0].name)
                                    : nls.localize('rockit/profileManager/selectedCount', 'Selected: {0} profiles', selectedProfiles.length)}
                            </span>
                        </>
                    ) : (
                        <span className="schema-selector__placeholder">
                            {nls.localize(
                                'rockit/profileManager/selectSchemaHint',
                                    'Select one or more valid profiles, or double-click a valid row to associate it.',
                            )}
                        </span>
                    )}
                </div>

                {/* Right: Buttons */}
                <div className="schema-selector__actions">
                    <button 
                        className="theia-button secondary schema-selector__btn-cancel"
                        onClick={onCancel}
                    >
                        {nls.localize('rockit/common/cancel', 'Cancel')}
                    </button>
                    <button 
                        className="theia-button main schema-selector__btn-associate"
                        onClick={() => selectedProfiles.length && onAccept(selectedProfiles)}
                        disabled={!selectedProfiles.length}
                    >
                        {nls.localize('rockit/profileManager/associate', 'Associate')}
                    </button>
                </div>
            </div>
        </div>
    );
};
