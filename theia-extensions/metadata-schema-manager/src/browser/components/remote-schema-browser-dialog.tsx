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
    private selectedIdRef = React.createRef<string | null>();
    
    constructor(
        private readonly provider: RemoteSchemaProviderConfig,
        private readonly schemaManagerService: SchemaManagerService,
        private readonly envVariablesServer: EnvVariablesServer
    ) {
        super({
            title: `Browse ${provider.title}`
        });

        this.contentNode.style.width = '600px';
        this.contentNode.style.height = '500px';
        this.contentNode.style.padding = '0';
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';

        this.appendCloseButton('Cancel');
        const acceptBtn = this.appendAcceptButton('Add');
        acceptBtn.disabled = true;
    }

    get value(): string | undefined {
        return this.selectedIdRef.current || undefined;
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
                selectionRef={this.selectedIdRef}
                onSelectionChanged={(isValid) => {
                    if (this.acceptButton) {
                        this.acceptButton.disabled = !isValid;
                    }
                }}
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
    selectionRef: React.MutableRefObject<string | null | undefined>;
    onSelectionChanged: (isValid: boolean) => void;
}

const BrowserContent: React.FC<BrowserContentProps> = ({ 
    provider, 
    schemaManagerService, 
    selectionRef, 
    onSelectionChanged 
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
        selectionRef.current = id;
        setSelectedName(name);
        setSelectedId(id);
        onSelectionChanged(true);
    };

    const handleFolderSelected = (id: string, name: string) => {
        selectionRef.current = null;
        setSelectedName(null);
        setSelectedId(null);
        onSelectionChanged(false);
    };

    const handleGoTo = () => {
        if (!selectedId) return;
        const element = document.getElementById(`cedar-node-${selectedId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    const handleDeselect = () => {
        selectionRef.current = null;
        setSelectedName(null);
        setSelectedId(null);
        onSelectionChanged(false);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {schemaApi ? (
                    <CedarTree
                        schemaApi={schemaApi}
                        alreadySelectedSchemaIds={existingIds}
                        onTemplateSelected={handleTemplateSelected}
                        onFolderSelected={handleFolderSelected}
                    />
                ) : (
                    <div style={{ padding: 20, color: 'var(--theia-descriptionForeground)' }}>
                        Initializing connection...
                    </div>
                )}
            </div>

            <div style={{ 
                padding: '8px 12px', 
                borderTop: '1px solid var(--theia-panel-border)',
                backgroundColor: 'var(--theia-editor-background)',
                fontSize: 'var(--theia-ui-font-size0)',
                color: 'var(--theia-descriptionForeground)',
                display: 'flex',
                alignItems: 'center',
                minHeight: '24px'
            }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                    {selectedName ? (
                        <>
                            <div style={{ display: 'flex', marginRight: '8px' }}>
                                {/* FIX: Added PopperProps with zIndex to force tooltip on top of Theia dialog */}
                                <Tooltip title="Locate in Tree" PopperProps={{ style: { zIndex: 99999 } }}>
                                    <IconButton size="small" onClick={handleGoTo} style={{ padding: 2 }}>
                                        <CenterFocusWeakIcon fontSize="small" style={{ fontSize: '16px', color: 'var(--theia-icon-foreground)' }} />
                                    </IconButton>
                                </Tooltip>
                                {/* FIX: Added PopperProps with zIndex here as well */}
                                <Tooltip title="Deselect" PopperProps={{ style: { zIndex: 99999 } }}>
                                    <IconButton size="small" onClick={handleDeselect} style={{ padding: 2, marginLeft: 2 }}>
                                        <CancelIcon fontSize="small" style={{ fontSize: '16px', color: 'var(--theia-errorForeground)' }} />
                                    </IconButton>
                                </Tooltip>
                            </div>
                            <span style={{ fontWeight: 600, color: 'var(--theia-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                Selected: {selectedName}
                            </span>
                        </>
                    ) : (
                        <span>Please select a template to add.</span>
                    )}
                </div>
            </div>
        </div>
    );
};