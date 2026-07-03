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
import CancelIcon from '@mui/icons-material/Cancel'; 
import { IconButton, Tooltip } from '@mui/material';

import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service';
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service';
import { SchemaManagerService } from '../services/metadata-schema-manager-service';
import { MetadataSchemaTable } from './metadata-schema-table';
import { MetadataSchemaToolbar } from './metadata-schema-toolbar';
import { RemoteSchemaProviderListDialog } from './remote-schema-provider-list-dialog';
import { RemoteSchemaProviderSelectorDialog } from './remote-schema-provider-selector-dialog';
import { MetadataSchemaImportFromUrlDialog } from './metadata-schema-import-from-url-dialog';
import type { SchemaInfo } from '../types';
import '../styles/metadata-schema-selector.css';

const MSG_TIMEOUT = 5000;

@injectable()
export class MetadataSchemaSelectorContribution implements FrontendApplicationContribution {
    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(RoCrateHistoryService) protected readonly roCrateHistoryService!: RoCrateHistoryService;
    @inject(SchemaManagerService) protected readonly schemaManagerService!: SchemaManagerService;
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
                this.schemaManagerService,
                this.fileDialogService,
                this.messageService
            );

            const selectedSchemas = await dialog.open();

            if (selectedSchemas?.length) {
                await this.handleAssociate(selectedSchemas);
            }
        } catch (err) {
            console.error("Failed to open selector dialog:", err);
            this.messageService.error('Failed to open schema selector dialog.', { timeout: MSG_TIMEOUT });
        } finally {
            this.isDialogVisible = false;
            this.appStateService.updateState({ 
                openSchemaSelectorWindow: false, 
                schemaSelectorContext: undefined 
            });
        }
    }

    protected async handleAssociate(schemas: SchemaInfo[]): Promise<void> {
        const crate = this.appStateService.roCrate;
        const graph = crate && Array.isArray(crate['@graph']) ? crate['@graph'] as any[] : [];
        const isLargeCrate = graph.length >= 1_000;
        const loadMask = this.loadMaskService.show({
            message: 'Associating metadata schema...',
            delay: isLargeCrate ? 0 : undefined,
        });
        try {
            if (isLargeCrate) {
                await this.waitForLoadMaskPaint();
            }
            const ctx = this.appStateService.getState().schemaSelectorContext;
            const entityId = ctx?.entityId ?? './';

            if (!ctx?.entityId) {
                console.warn('MetadataSchemaSelector: missing schemaSelectorContext; defaulting to root entity', { entityId });
            }

            if (crate && graph.length > 0) {
                const w3ids = schemas
                    .map(schema => schema.conformsTo?.trim() || this.schemaManagerService.deriveConformsToFromId(schema.aux.reference))
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
                        message: 'Finalizing schema association...',
                        progress: { worked: graph.length, total: graph.length },
                    });
                    await new Promise<void>(resolve => setTimeout(resolve, 0));
                    
                    this.roCrateHistoryService.applyRoCrateChange(
                        { ...crate, '@graph': updatedGraph } as any,
                        { label: 'Associate schema with entity' }
                    );
                }
            }

            const schemaNames = schemas.map(schema => schema.name).join(', ');
            const message = schemas.length === 1
                ? `Associated schema: ${schemaNames}`
                : `Associated ${schemas.length} schemas: ${schemaNames}`;
            this.messageService.info(message, { timeout: MSG_TIMEOUT });

        } catch (e) {
            console.error(e);
            this.messageService.error('Failed to associate schema.', { timeout: MSG_TIMEOUT });
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

export class MetadataSchemaSelectorDialog extends AbstractDialog<SchemaInfo[] | undefined> {

    protected selectedSchemas: SchemaInfo[] | undefined;
    private reactRoot: Root | undefined;

    constructor(
        protected readonly schemaManager: SchemaManagerService,
        protected readonly fileDialog: FileDialogService,
        protected readonly msgService: MessageService
    ) {
        super({
            title: 'Select Metadata Schema'
        });
        
        this.contentNode.style.width = '1000px';
        this.contentNode.style.height = '600px';
        this.contentNode.style.maxHeight = '80vh';
        this.contentNode.style.maxWidth = '90vw';
        
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';
    }

    get value(): SchemaInfo[] | undefined {
        return this.selectedSchemas;
    }

    protected handleAccept(schemas: SchemaInfo[]) {
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
                service={this.schemaManager}
                fileDialog={this.fileDialog}
                msg={this.msgService}
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
    service: SchemaManagerService;
    fileDialog: FileDialogService;
    msg: MessageService;
    onAccept: (schemas: SchemaInfo[]) => void;
    onCancel: () => void;
}

const SelectorContent: React.FC<ContentProps> = ({ service, fileDialog, msg, onAccept, onCancel }) => {
    const [schemas, setSchemas] = React.useState<SchemaInfo[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedSchemas, setSelectedSchemas] = React.useState<SchemaInfo[]>([]);

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
        service.loadAllSchemas()
            .then(res => {
                setSchemas(res);
                setSelectedSchemas([]);
            })
            .catch(err => console.error(err))
            .finally(() => setIsLoading(false));
    }, [service]);

    React.useEffect(() => {
        loadData();
    }, [loadData]);

    React.useEffect(() => {
        const listener = service.onDidChangeSchemas(() => loadData());
        return () => listener.dispose();
    }, [service, loadData]);

    const handleSelectionChange = (keys: React.Key[]) => {
        const selected = keys
            .map(key => schemas.find(schema => schema.id === key))
            .filter((schema): schema is SchemaInfo => Boolean(schema));
        setSelectedSchemas(selected);
    };

    const handleRowDoubleClick = (schema: SchemaInfo) => {
        onAccept([schema]);
    };

    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.defaultPrevented || !selectedSchemas.length) {
                return;
            }

            if (isTextEditingTarget(event.target)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            onAccept(selectedSchemas);
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [onAccept, selectedSchemas]);

    const handleTableKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' || event.defaultPrevented || !selectedSchemas.length) {
            return;
        }

        if (isTextEditingTarget(event.target)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        onAccept(selectedSchemas);
    };

    const handleRefresh = () => {
        service.clearFailedPendingSchemas();
        loadData();
    };

    const handleDeleteTransient = async (ids: string[]) => {
        try {
            const count = await service.deleteSchemas(ids);
            if (count > 0) msg.info(`Aborted/Removed ${count} task(s).`, { timeout: MSG_TIMEOUT });
        } catch (e) {
            msg.error('Failed to remove task.', { timeout: MSG_TIMEOUT });
        }
    };

    const handleImportFile = async () => {
        const uris = await fileDialog.showOpenDialog({ 
            title: 'Import', filters: { 'JSON': ['json'] }, canSelectFiles: true, canSelectMany: true 
        });
        if (!uris) return;
        const fileUris = Array.isArray(uris) ? uris : [uris];

        msg.showProgress({ text: 'Importing...' }).then(async p => {
            try {
                const res = await service.importFiles(fileUris, p);
                if (res.success > 0) msg.info(`Successfully imported ${res.success} schema(s).`, { timeout: MSG_TIMEOUT });
                if (res.fail > 0) msg.warn(`Failed to import ${res.fail} schema(s).`, { timeout: MSG_TIMEOUT });
            } catch (e) {
                msg.error('Unexpected error during import.', { timeout: MSG_TIMEOUT });
            } finally { p.cancel(); }
        });
    };

    const handleImportUrl = async (url: string) => {
        msg.showProgress({ text: 'Downloading...' }).then(async p => {
            try {
                const name = await service.importFromUrl(url, p);
                msg.info(`Successfully imported: ${name}`, { timeout: MSG_TIMEOUT });
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
        if (provider) service.browseRemoteSchemas(provider);
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
                    schemas={schemas}
                    isLoading={isLoading}
                    selectionType="checkbox"
                    selectedKeys={selectedSchemas.map(schema => schema.id)}
                    onSelectionChange={handleSelectionChange}
                    onRowDoubleClick={handleRowDoubleClick}
                    allowDeleteValidSchemas={false}
                    disableInvalidRows={true}
                    onDelete={handleDeleteTransient}
                    onRetry={(id) => service.retrySchema(id)}
                />
            </div>
            
            {/* Footer */}
            <div className="schema-selector__footer">
                {/* Left: Selection Info */}
                <div className="schema-selector__info">
                    {selectedSchemas.length ? (
                        <>
                            <Tooltip title="Deselect" placement="top" classes={{ tooltip: 'schema-table__tooltip' }}>
                                <IconButton 
                                    size="small" 
                                    onClick={() => setSelectedSchemas([])} 
                                    className="schema-selector__deselect-btn"
                                >
                                    <CancelIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <span className="schema-selector__selected-text">
                                {selectedSchemas.length === 1
                                    ? `Selected: ${selectedSchemas[0].name}`
                                    : `Selected: ${selectedSchemas.length} schemas`}
                            </span>
                        </>
                    ) : (
                        <span className="schema-selector__placeholder">
                            Select one or more valid schemas, or double-click a valid row to associate it.
                        </span>
                    )}
                </div>

                {/* Right: Buttons */}
                <div className="schema-selector__actions">
                    <button 
                        className="theia-button secondary schema-selector__btn-cancel"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main schema-selector__btn-associate"
                        onClick={() => selectedSchemas.length && onAccept(selectedSchemas)}
                        disabled={!selectedSchemas.length}
                    >
                        Associate
                    </button>
                </div>
            </div>
        </div>
    );
};
