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
    private dialogBlock: HTMLElement | undefined;
    private readonly interactionDisposers: Array<() => void> = [];
    private stopActiveInteraction: (() => void) | undefined;

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
        this.contentNode.classList.add('schema-selector__dialog-content');
        // Actions are rendered in the React footer, so the native Theia control row is unused.
        this.controlPanel.remove();
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
        requestAnimationFrame(() => {
            this.render();
            requestAnimationFrame(() => this.enableWindowInteractions());
        });
    }

    protected onBeforeDetach(msg: Message): void {
        this.disableWindowInteractions();
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }

    /**
     * Turns the modal shell into a small desktop-style window. Moving uses a
     * compositor transform, while resizing only updates a cheap outline until
     * pointer-up. This keeps the Ant table from being laid out for every pixel.
     */
    private enableWindowInteractions(): void {
        if (this.dialogBlock) {
            return;
        }

        const dialogBlock = this.node.querySelector<HTMLElement>('.dialogBlock');
        const titleBar = dialogBlock?.querySelector<HTMLElement>('.dialogTitle');
        if (!dialogBlock || !titleBar) {
            return;
        }

        const initialRect = dialogBlock.getBoundingClientRect();
        this.dialogBlock = dialogBlock;
        dialogBlock.classList.add('schema-selector__dialog-window');
        dialogBlock.style.position = 'fixed';
        dialogBlock.style.left = `${initialRect.left}px`;
        dialogBlock.style.top = `${initialRect.top}px`;
        dialogBlock.style.width = `${initialRect.width}px`;
        dialogBlock.style.height = `${initialRect.height}px`;
        dialogBlock.style.minWidth = 'min(520px, calc(100vw - 8px))';
        dialogBlock.style.minHeight = 'min(320px, calc(100vh - 8px))';
        dialogBlock.style.maxWidth = 'calc(100vw - 8px)';
        dialogBlock.style.maxHeight = 'calc(100vh - 8px)';
        dialogBlock.style.margin = '0';

        // The shell owns the geometry after initialization; the content fills it.
        this.contentNode.style.width = 'auto';
        this.contentNode.style.height = 'auto';
        this.contentNode.style.maxWidth = 'none';
        this.contentNode.style.maxHeight = 'none';

        const moveHandler = (event: PointerEvent) => this.beginMove(event, dialogBlock);
        titleBar.addEventListener('pointerdown', moveHandler);
        this.interactionDisposers.push(() => titleBar.removeEventListener('pointerdown', moveHandler));

        for (const direction of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
            const handle = document.createElement('div');
            handle.className = `schema-selector__resize-handle schema-selector__resize-handle--${direction}`;
            handle.dataset.direction = direction;
            handle.setAttribute('aria-hidden', 'true');
            const resizeHandler = (event: PointerEvent) => this.beginResize(event, dialogBlock, direction);
            handle.addEventListener('pointerdown', resizeHandler);
            dialogBlock.appendChild(handle);
            this.interactionDisposers.push(() => {
                handle.removeEventListener('pointerdown', resizeHandler);
                handle.remove();
            });
        }
    }

    private disableWindowInteractions(): void {
        this.stopActiveInteraction?.();
        this.stopActiveInteraction = undefined;
        while (this.interactionDisposers.length) {
            this.interactionDisposers.pop()?.();
        }
        this.dialogBlock = undefined;
    }

    private beginMove(event: PointerEvent, dialogBlock: HTMLElement): void {
        if (event.button !== 0) {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest('.closeButton, button, a, input, select, textarea')) {
            return;
        }

        event.preventDefault();
        this.stopActiveInteraction?.();

        const start = dialogBlock.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        let frame: number | undefined;
        let nextLeft = start.left;
        let nextTop = start.top;

        const paint = () => {
            frame = undefined;
            dialogBlock.style.transform = `translate3d(${nextLeft - start.left}px, ${nextTop - start.top}px, 0)`;
        };
        const move = (moveEvent: PointerEvent) => {
            const margin = 4;
            nextLeft = Math.min(
                Math.max(margin, start.left + moveEvent.clientX - startX),
                Math.max(margin, window.innerWidth - start.width - margin),
            );
            nextTop = Math.min(
                Math.max(margin, start.top + moveEvent.clientY - startY),
                Math.max(margin, window.innerHeight - start.height - margin),
            );
            if (frame === undefined) {
                frame = requestAnimationFrame(paint);
            }
        };
        const cleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', cancel);
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
                frame = undefined;
            }
            dialogBlock.style.willChange = '';
            document.body.classList.remove('schema-selector--moving');
            if (this.stopActiveInteraction === cancel) {
                this.stopActiveInteraction = undefined;
            }
        };
        const cancel = () => {
            dialogBlock.style.transform = '';
            cleanup();
        };
        const finish = (upEvent: PointerEvent) => {
            move(upEvent);
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
                frame = undefined;
            }
            dialogBlock.style.transform = '';
            dialogBlock.style.left = `${nextLeft}px`;
            dialogBlock.style.top = `${nextTop}px`;
            cleanup();
        };

        dialogBlock.style.willChange = 'transform';
        document.body.classList.add('schema-selector--moving');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', cancel);
        this.stopActiveInteraction = cancel;
    }

    private beginResize(
        event: PointerEvent,
        dialogBlock: HTMLElement,
        direction: string,
    ): void {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.stopActiveInteraction?.();

        const start = dialogBlock.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const preview = document.createElement('div');
        preview.className = 'schema-selector__resize-preview';
        document.body.appendChild(preview);

        let frame: number | undefined;
        let geometry = { left: start.left, top: start.top, width: start.width, height: start.height };

        const calculateGeometry = (pointerEvent: PointerEvent) => {
            const margin = 4;
            const minWidth = Math.min(520, window.innerWidth - margin * 2);
            const minHeight = Math.min(320, window.innerHeight - margin * 2);
            const deltaX = pointerEvent.clientX - startX;
            const deltaY = pointerEvent.clientY - startY;
            let { left, top, width, height } = geometry;

            if (direction.includes('e')) {
                width = Math.min(
                    Math.max(minWidth, start.width + deltaX),
                    window.innerWidth - start.left - margin,
                );
                left = start.left;
            } else if (direction.includes('w')) {
                width = Math.min(
                    Math.max(minWidth, start.width - deltaX),
                    start.right - margin,
                );
                left = start.right - width;
            }

            if (direction.includes('s')) {
                height = Math.min(
                    Math.max(minHeight, start.height + deltaY),
                    window.innerHeight - start.top - margin,
                );
                top = start.top;
            } else if (direction.includes('n')) {
                height = Math.min(
                    Math.max(minHeight, start.height - deltaY),
                    start.bottom - margin,
                );
                top = start.bottom - height;
            }

            geometry = { left, top, width, height };
        };
        const paint = () => {
            frame = undefined;
            preview.style.left = `${geometry.left}px`;
            preview.style.top = `${geometry.top}px`;
            preview.style.width = `${geometry.width}px`;
            preview.style.height = `${geometry.height}px`;
        };
        const move = (moveEvent: PointerEvent) => {
            calculateGeometry(moveEvent);
            if (frame === undefined) {
                frame = requestAnimationFrame(paint);
            }
        };
        const cleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', cleanup);
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
                frame = undefined;
            }
            preview.remove();
            document.body.classList.remove('schema-selector--resizing');
            if (this.stopActiveInteraction === cleanup) {
                this.stopActiveInteraction = undefined;
            }
        };
        const finish = (upEvent: PointerEvent) => {
            calculateGeometry(upEvent);
            dialogBlock.style.left = `${geometry.left}px`;
            dialogBlock.style.top = `${geometry.top}px`;
            dialogBlock.style.width = `${geometry.width}px`;
            dialogBlock.style.height = `${geometry.height}px`;
            cleanup();
            // Consumers that cache viewport sizes should update once, after the
            // expensive content has received its final dimensions.
            requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        };

        paint();
        document.body.classList.add('schema-selector--resizing');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', cleanup);
        this.stopActiveInteraction = cleanup;
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
