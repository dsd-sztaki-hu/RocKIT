// src/browser/components/metadata-schema-selector.tsx

import { injectable, inject } from 'inversify';
import * as React from 'react';
import { FrontendApplicationContribution, AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import CancelIcon from '@mui/icons-material/Cancel'; 
import { IconButton, Tooltip } from '@mui/material';

import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
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
    @inject(SchemaManagerService) protected readonly schemaManagerService!: SchemaManagerService;
    @inject(FileDialogService) protected readonly fileDialogService!: FileDialogService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;

    private isDialogVisible = false;

    onStart(): void {
        this.appStateService.onDidChangeSelector(state => state.openSchemaSelectorWindow)(
            (isOpen) => {
                if (isOpen && !this.isDialogVisible) {
                    this.openDialog();
                }
            }
        );
    }

    protected async openDialog(): Promise<void> {
        this.isDialogVisible = true;
        try {
            const dialog = new MetadataSchemaSelectorDialog(
                this.schemaManagerService,
                this.fileDialogService,
                this.messageService
            );

            const selectedSchema = await dialog.open();

            if (selectedSchema) {
                await this.handleAssociate(selectedSchema);
            }
        } catch (err) {
            console.error("Failed to open selector dialog:", err);
        } finally {
            this.isDialogVisible = false;
            this.appStateService.updateState({ openSchemaSelectorWindow: false });
        }
    }

    protected async handleAssociate(schema: SchemaInfo): Promise<void> {
        try {
            const crate = this.appStateService.roCrate;
            if (crate && Array.isArray(crate['@graph'])) {
                const entityId = this.appStateService.selectedEntityId ?? './';
                const w3id = schema.conformsTo || this.schemaManagerService.deriveConformsToFromId(schema.reference);
                
                if (w3id) {
                    const updatedGraph = (crate['@graph'] as any[]).map(entry => {
                        if (String(entry['@id']) !== entityId) return entry;
                        
                        const existing = entry.conformsTo;
                        const base = existing ? (Array.isArray(existing) ? existing.slice() : [existing]) : [];
                        const normalized = base
                            .map((v: any) => (typeof v === 'string' ? { '@id': v } : v))
                            .filter((v: any) => v && typeof v['@id'] === 'string');
                        
                        const already = normalized.some((v: any) => v['@id'] === w3id);
                        const next = already ? normalized : [...normalized, { '@id': w3id }];
                        
                        return { ...entry, conformsTo: next };
                    });
                    
                    this.appStateService.roCrate = { ...crate, '@graph': updatedGraph } as any;
                }
            }

            const newProfileContent = await this.schemaManagerService.getConvertedProfileContent(schema.path);
            const mergedProfile = await this.schemaManagerService.getMergedProfile(
                this.appStateService.roCrate!, 
                newProfileContent!, 
                this.appStateService.profile!, 
                schema.reference
            );
            
            this.appStateService.updateState({ profile: mergedProfile });
            this.messageService.info(`Associated schema: ${schema.name}`, { timeout: MSG_TIMEOUT });

        } catch (e) {
            console.error(e);
            this.messageService.error('Failed to load or merge profile content.', { timeout: MSG_TIMEOUT });
        }
    }
}

export class MetadataSchemaSelectorDialog extends AbstractDialog<SchemaInfo | undefined> {

    protected selectedSchema: SchemaInfo | undefined;
    private reactRoot: any;

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

    get value(): SchemaInfo | undefined {
        return this.selectedSchema;
    }

    protected handleAccept(schema: SchemaInfo) {
        this.selectedSchema = schema;
        this.accept();
    }

    protected handleClose() {
        this.selectedSchema = undefined;
        this.close();
    }

    protected render(): void {
        if (!this.contentNode) return;

        const ReactDOM = require('react-dom/client');

        if (!this.reactRoot) {
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
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
    onAccept: (schema: SchemaInfo) => void;
    onCancel: () => void;
}

const SelectorContent: React.FC<ContentProps> = ({ service, fileDialog, msg, onAccept, onCancel }) => {
    const [schemas, setSchemas] = React.useState<SchemaInfo[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedSchema, setSelectedSchema] = React.useState<SchemaInfo | undefined>(undefined);

    const loadData = React.useCallback(() => {
        setIsLoading(true);
        service.loadAllSchemas()
            .then(res => {
                setSchemas(res);
                setSelectedSchema(undefined);
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
        const found = schemas.find(s => s.path === keys[0]);
        setSelectedSchema(found);
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
            } catch (e) {
                msg.error(`Error: ${e instanceof Error ? e.message : e}`, { timeout: MSG_TIMEOUT });
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
        <div className="metadata-schema-layout-container" style={{ padding: 0 }}> 
            
            <MetadataSchemaToolbar 
                onImportFile={handleImportFile} 
                onImportUrl={handleOpenImportUrl} 
                onBrowse={handleBrowseRemote}
                onRefresh={loadData}
                onConfigureProviders={handleOpenProviderList}
            />
            
            <div className="metadata-schema-table-wrapper">
                <MetadataSchemaTable
                    schemas={schemas}
                    isLoading={isLoading}
                    selectionType="row"
                    selectedKeys={selectedSchema ? [selectedSchema.path] : []}
                    onSelectionChange={handleSelectionChange}
                />
            </div>
            
            {/* Footer */}
            <div className="schema-selector__footer">
                {/* Left: Selection Info */}
                <div className="schema-selector__info">
                    {selectedSchema ? (
                        <>
                            <Tooltip title="Deselect" PopperProps={{ style: { zIndex: 99999 } }}>
                                <IconButton 
                                    size="small" 
                                    onClick={() => setSelectedSchema(undefined)} 
                                    className="schema-selector__deselect-btn"
                                >
                                    <CancelIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <span className="schema-selector__selected-text">
                                Selected: {selectedSchema.name}
                            </span>
                        </>
                    ) : (
                        <span className="schema-selector__placeholder">
                            Click a row to select a schema.
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
                        onClick={() => selectedSchema && onAccept(selectedSchema)}
                        disabled={!selectedSchema}
                    >
                        Associate
                    </button>
                </div>
            </div>
        </div>
    );
};