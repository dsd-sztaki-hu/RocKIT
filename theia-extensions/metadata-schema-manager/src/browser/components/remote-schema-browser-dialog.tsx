// src/browser/components/remote-schema-browser-dialog.tsx

import { injectable, inject } from 'inversify';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { FrontendApplicationContribution, AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { IconButton, Tooltip } from '@mui/material'; 
import CenterFocusWeakIcon from '@mui/icons-material/CenterFocusWeak'; 
import CancelIcon from '@mui/icons-material/Cancel'; 

import { SchemaManagerService } from '../services/metadata-schema-manager-service';
import { SchemaApi } from '../services/schema-api';
import CedarTree from './cedar-tree';
import { RemoteSchemaProviderConfig } from '../types';
import '../styles/remote-schema-browser-dialog.css';


@injectable()
export class RemoteSchemaBrowserContribution implements FrontendApplicationContribution {
    @inject(SchemaManagerService) protected readonly schemaManagerService!: SchemaManagerService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;

    onStart(): void {
        this.schemaManagerService.onOpenRemoteBrowser((provider) => this.openDialog(provider));
    }

    protected async openDialog(provider: RemoteSchemaProviderConfig): Promise<void> {
        const dialog = new RemoteSchemaBrowserDialog(
            provider,
            this.schemaManagerService,
            this.envVariablesServer
        );

        const selectedTemplateId = await dialog.open();

        if (selectedTemplateId) {
            this.handleDownload(selectedTemplateId, provider);
        }
    }

    protected async handleDownload(templateId: string, provider: RemoteSchemaProviderConfig): Promise<void> {
        try {
            await this.schemaManagerService.downloadRemoteSchema(templateId, provider);
        } catch (error) {
            console.error("Download failed", error);
        }
    }
}

export class RemoteSchemaBrowserDialog extends AbstractDialog<string | undefined> {

    private reactRoot: ReactDOM.Root | undefined;
    private result: string | undefined;

    constructor(
        private readonly provider: RemoteSchemaProviderConfig,
        private readonly schemaManagerService: SchemaManagerService,
        private readonly envVariablesServer: EnvVariablesServer
    ) {
        super({
            title: `Browse ${provider.title}`
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
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <BrowserContent
                provider={this.provider}
                schemaManagerService={this.schemaManagerService}
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
    provider: RemoteSchemaProviderConfig;
    schemaManagerService: SchemaManagerService;
    envVariablesServer: EnvVariablesServer;
    onAccept: (id: string) => void;
    onCancel: () => void;
}

const BrowserContent: React.FC<BrowserContentProps> = ({ 
    provider, 
    schemaManagerService, 
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
                apiKey: provider.apiKey
            }));

            schemaManagerService.loadAllSchemas().then(schemas => {
                const ids = schemas.map(s => s.reference);
                setExistingIds(ids);
            });
        }
    }, [provider, schemaManagerService]);

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
                        Initializing connection...
                    </div>
                )}
            </div>

            <div className="remote-browser-dialog__footer">
                
                <div className="remote-browser-dialog__selection-info">
                    {selectedName ? (
                        <>
                            <div className="remote-browser-dialog__controls">
                                <Tooltip title="Locate in Tree" PopperProps={{ style: { zIndex: 99999 } }}>
                                    <IconButton size="small" onClick={handleGoTo} style={{ padding: 2, color: 'var(--theia-icon-foreground)' }}>
                                        <CenterFocusWeakIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title="Deselect" PopperProps={{ style: { zIndex: 99999 } }}>
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
                            Select a template to import...
                        </span>
                    )}
                </div>

                <div className="remote-browser-dialog__actions">
                    <button 
                        className="theia-button secondary remote-browser-dialog__btn-cancel"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main remote-browser-dialog__btn-add"
                        onClick={() => selectedId && onAccept(selectedId)}
                        disabled={!selectedId}
                    >
                        Add
                    </button>
                </div>
            </div>
        </div>
    );
};