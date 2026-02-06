import { injectable, inject } from 'inversify';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Modal, Button, Input } from 'antd';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { CommandRegistry } from '@theia/core/lib/common/command';

import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { SchemaManagerService } from '../services/metadata-schema-manager-service';
import { MetadataSchemaTable } from './metadata-schema-table';
import { MetadataSchemaToolbar } from './metadata-schema-toolbar';
import { RemoteSchemaProviderListDialog } from './remote-schema-provider-list-dialog';
import { RemoteSchemaProviderConfigDialog } from './remote-schema-provider-config-dialog';
import { RemoteSchemaProviderSelectorDialog } from './remote-schema-provider-selector-dialog';
import { MetadataSchemaImportFromUrlDialog } from './metadata-schema-import-from-url-dialog';
import type { SchemaInfo, RemoteSchemaProviderConfig } from '../types';

const MSG_TIMEOUT = 5000;

@injectable()
export class MetadataSchemaSelectorContribution implements FrontendApplicationContribution {
    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(SchemaManagerService) protected readonly schemaManagerService!: SchemaManagerService;
    @inject(FileDialogService) protected readonly fileDialogService!: FileDialogService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;
    @inject(CommandRegistry) protected readonly commandRegistry!: CommandRegistry;

    private container: HTMLDivElement | null = null;
    private reactRoot: ReactDOM.Root | null = null;

    onStart(): void {
        this.container = document.createElement('div');
        this.container.id = 'metadata-schema-selector-container';
        document.body.appendChild(this.container);
        this.reactRoot = ReactDOM.createRoot(this.container);

        const update = () => this.render();
        this.schemaManagerService.onDidChangeSchemas(update);
        this.appStateService.onDidChangeSelector(state => state.openSchemaSelectorWindow)(update);
        update();
    }

    protected render(): void {
        if (!this.reactRoot) return;
        const isOpen = this.appStateService.getState().openSchemaSelectorWindow || false;
        
        this.reactRoot.render(
            <SchemaSelector 
                isOpen={isOpen}
                appState={this.appStateService}
                service={this.schemaManagerService}
                utils={{
                    fileDialog: this.fileDialogService,
                    msg: this.messageService,
                    env: this.envVariablesServer,
                    cmd: this.commandRegistry
                }}
            />
        );
    }
}

interface SelectorProps {
    isOpen: boolean;
    appState: AppStateService;
    service: SchemaManagerService;
    utils: {
        fileDialog: FileDialogService;
        msg: MessageService;
        env: EnvVariablesServer;
        cmd: CommandRegistry;
    }
}

const SchemaSelector: React.FC<SelectorProps> = ({ isOpen, appState, service, utils }) => {
    const [schemas, setSchemas] = React.useState<SchemaInfo[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedSchema, setSelectedSchema] = React.useState<SchemaInfo | null>(null);

    // --- Provider Configuration State ---
    const [isProviderListOpen, setIsProviderListOpen] = React.useState(false);
    const [isProviderConfigOpen, setIsProviderConfigOpen] = React.useState(false);
    const [isProviderSelectorOpen, setIsProviderSelectorOpen] = React.useState(false); 
    const [isImportUrlOpen, setIsImportUrlOpen] = React.useState(false);

    const [selectedProviderToEdit, setSelectedProviderToEdit] = React.useState<RemoteSchemaProviderConfig | undefined>(undefined);
    const [providersLastUpdated, setProvidersLastUpdated] = React.useState(0);
    const [configDialogKey, setConfigDialogKey] = React.useState(0);

    const loadData = React.useCallback(() => {
        setIsLoading(true);
        service.loadAllSchemas()
            .then(setSchemas)
            .catch(err => console.error(err))
            .finally(() => setIsLoading(false));
    }, [service]);

    React.useEffect(() => {
        if (isOpen) {
            setSelectedSchema(null);
            loadData();
        }
    }, [isOpen, loadData]);

    React.useEffect(() => {
        const listener = service.onDidChangeSchemas(() => {
            if (isOpen) loadData();
        });
        return () => listener.dispose();
    }, [service, loadData, isOpen]);

    // --- Provider Handlers ---

    const handleOpenProviderList = () => {
        setIsProviderListOpen(true);
        setIsProviderConfigOpen(false);
        setIsProviderSelectorOpen(false);
    };

    const handleCloseProviderList = () => {
        setIsProviderListOpen(false);
        setIsProviderConfigOpen(false);
    };

    const handleOpenProviderConfig = (provider?: RemoteSchemaProviderConfig) => {
        setSelectedProviderToEdit(provider);
        setIsProviderListOpen(false);
        setIsProviderConfigOpen(true);
        setConfigDialogKey(prev => prev + 1);
    };

    const handleCloseProviderConfig = () => {
        setIsProviderConfigOpen(false);
        setSelectedProviderToEdit(undefined);
        setIsProviderListOpen(true);
    };

    const handleProviderSave = async (newConfig: RemoteSchemaProviderConfig) => {
        const store = service.providerStoreService;
        const currentProviders = await store.loadProviders();
        let newList = [...currentProviders];
        const existingIndex = newList.findIndex(p => p.id === newConfig.id);
        if (existingIndex !== -1) {
            newList[existingIndex] = newConfig;
        } else {
            newList.push(newConfig);
        }
        await store.saveProviders(newList);
        setProvidersLastUpdated(Date.now());
    };

    const handleBrowseRemote = () => {
        setIsProviderSelectorOpen(true);
    };

    const handleProviderSelected = (provider: RemoteSchemaProviderConfig) => {
        setIsProviderSelectorOpen(false);
        service.browseRemoteSchemas(provider);
    };

    // --- Import Handlers ---

    const handleImportFile = async () => {
        const uris = await utils.fileDialog.showOpenDialog({ 
            title: 'Import', filters: { 'JSON': ['json'] }, canSelectFiles: true, canSelectMany: true 
        });
        if (!uris) return;
        const fileUris = Array.isArray(uris) ? uris : [uris];

        utils.msg.showProgress({ text: 'Importing...' }).then(async p => {
            try {
                const res = await service.importFiles(fileUris, p);
                if (res.success > 0) utils.msg.info(`Successfully imported ${res.success} schema(s).`, { timeout: MSG_TIMEOUT });
                if (res.fail > 0) utils.msg.warn(`Failed to import ${res.fail} schema(s).`, { timeout: MSG_TIMEOUT });
            } catch (e) {
                utils.msg.error('Unexpected error during import.', { timeout: MSG_TIMEOUT });
            } finally { p.cancel(); }
        });
    };

    const handleOpenImportUrl = () => {
        setIsImportUrlOpen(true);
    };

    const handleImportUrl = async (url: string) => {
        utils.msg.showProgress({ text: 'Downloading...' }).then(async p => {
            try {
                const name = await service.importFromUrl(url, p);
                utils.msg.info(`Successfully imported: ${name}`, { timeout: MSG_TIMEOUT });
            } catch (e) {
                utils.msg.error(`Error: ${e instanceof Error ? e.message : e}`, { timeout: MSG_TIMEOUT });
            } finally { p.cancel(); }
        });
    };

    const handleAssociate = async () => {
        if (!selectedSchema) return;
        try {
            setIsLoading(true);
            const crate = appState.roCrate;
            if (crate && Array.isArray(crate['@graph'])) {
                const entityId = appState.selectedEntityId ?? './';
                const w3id = selectedSchema.conformsTo ? service.deriveConformsToFromId(selectedSchema.reference) : '';
                if (w3id) {
                    const updatedGraph = (crate['@graph'] as any[]).map(entry => {
                        if (String(entry['@id']) !== entityId) return entry;
                        const existing = entry.conformsTo;
                        const base = existing ? (Array.isArray(existing) ? existing.slice() : [existing]) : [];
                        const normalized = base.map(v => (typeof v === 'string' ? { '@id': v } : v)).filter(v => v && typeof v['@id'] === 'string');
                        const already = normalized.some(v => v['@id'] === w3id);
                        const next = already ? normalized : [...normalized, { '@id': w3id }];
                        return { ...entry, conformsTo: next };
                    });
                    appState.roCrate = { ...crate, '@graph': updatedGraph } as any;
                }
            }
            const newProfileContent = await service.getConvertedProfileContent(selectedSchema.path);
            const mergedProfile = await service.getMergedProfile(appState.roCrate!, newProfileContent!, appState.profile!, selectedSchema.reference);
            appState.updateState({ profile: mergedProfile, openSchemaSelectorWindow: false });
        } catch (e) {
            utils.msg.error('Failed to load profile content.', { timeout: MSG_TIMEOUT });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal
            title="Select Metadata Schema"
            open={isOpen}
            onCancel={() => appState.updateState({ openSchemaSelectorWindow: false })}
            width={1000}
            centered
            footer={[
                <Button key="cancel" onClick={() => appState.updateState({ openSchemaSelectorWindow: false })}>Cancel</Button>,
                <Button key="ok" type="primary" onClick={handleAssociate} disabled={!selectedSchema || isLoading}>Associate</Button>
            ]}
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: '600px', position: 'relative' }}>
                <MetadataSchemaToolbar 
                    onImportFile={handleImportFile} 
                    onImportUrl={handleOpenImportUrl} 
                    onBrowse={handleBrowseRemote}
                    onRefresh={loadData}
                    onConfigureProviders={handleOpenProviderList}
                />
                <div style={{ flexGrow: 1, overflow: 'auto' }}>
                    <MetadataSchemaTable
                        schemas={schemas}
                        isLoading={isLoading}
                        selectionType="radio"
                        onSelectionChange={keys => {
                            const found = schemas.find(s => s.path === keys[0]);
                            setSelectedSchema(found || null);
                        }}
                    />
                </div>

                {isImportUrlOpen && (
                    <MetadataSchemaImportFromUrlDialog 
                        open={isImportUrlOpen}
                        onClose={() => setIsImportUrlOpen(false)}
                        onImport={(url) => handleImportUrl(url)}
                    />
                )}

                {isProviderSelectorOpen && (
                    <RemoteSchemaProviderSelectorDialog
                        open={isProviderSelectorOpen}
                        onClose={() => setIsProviderSelectorOpen(false)}
                        onSelect={handleProviderSelected}
                        onConfigure={handleOpenProviderList}
                        providerStore={service.providerStoreService}
                    />
                )}

                {isProviderListOpen && (
                    <RemoteSchemaProviderListDialog 
                        open={isProviderListOpen}
                        onClose={handleCloseProviderList}
                        onAddProvider={() => handleOpenProviderConfig(undefined)}
                        onEditProvider={(p) => handleOpenProviderConfig(p)}
                        providerStore={service.providerStoreService}
                        lastUpdated={providersLastUpdated}
                    />
                )}

                {isProviderConfigOpen && (
                    <RemoteSchemaProviderConfigDialog 
                        key={configDialogKey}
                        open={isProviderConfigOpen}
                        providerToEdit={selectedProviderToEdit}
                        onClose={handleCloseProviderConfig}
                        onSave={handleProviderSave}
                        providerStore={service.providerStoreService}
                    />
                )}
            </div>
        </Modal>
    );
};