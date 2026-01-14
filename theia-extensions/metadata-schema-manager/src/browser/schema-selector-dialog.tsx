import { injectable, inject } from 'inversify';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Modal, Button, Input, message } from 'antd';
import type { Key } from 'antd/es/table/interface';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';

import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { SchemaManagerService } from './metadata-schema-manager-service';
import { SchemaTable } from './schema-table';
import { SchemaToolbar } from './schema-toolbar';
import type { SchemaInfo } from './types';

// Constants
const MSG_TIMEOUT = 5000;

@injectable()
export class SchemaSelectorDialogContribution implements FrontendApplicationContribution {

    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(SchemaManagerService) protected readonly schemaManagerService!: SchemaManagerService;
    
    @inject(FileDialogService) protected readonly fileDialogService!: FileDialogService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;

    private container: HTMLDivElement | null = null;
    private reactRoot: ReactDOM.Root | null = null;

    onStart(): void {
        this.container = document.createElement('div');
        this.container.id = 'schema-selector-dialog-container';
        document.body.appendChild(this.container);
        
        this.reactRoot = ReactDOM.createRoot(this.container);
        
        this.schemaManagerService.onDidChangeSchemas(() => this.render());

        this.appStateService.onDidChangeSelector(state => state.openSchemaSelectorWindow)(
            () => this.render()
        );
        
        this.render();
    }

    protected render(): void {
        if (!this.reactRoot) return;

        const isOpen = this.appStateService.getState().openSchemaSelectorWindow || false;

        this.reactRoot.render(
            <SchemaSelector 
                isOpen={isOpen}
                appStateService={this.appStateService}
                schemaManagerService={this.schemaManagerService}
                fileDialogService={this.fileDialogService}
                messageService={this.messageService}
                envVariablesServer={this.envVariablesServer}
            />
        );
    }
}

interface SelectorProps {
    isOpen: boolean;
    appStateService: AppStateService;
    schemaManagerService: SchemaManagerService;
    fileDialogService: FileDialogService;
    messageService: MessageService;
    envVariablesServer: EnvVariablesServer;
}

const SchemaSelector: React.FC<SelectorProps> = ({ 
    isOpen, 
    appStateService, 
    schemaManagerService,
    fileDialogService,
    messageService,
    envVariablesServer
}) => {
    const [schemas, setSchemas] = React.useState<SchemaInfo[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedKey, setSelectedKey] = React.useState<Key | null>(null);
    const [selectedSchema, setSelectedSchema] = React.useState<SchemaInfo | null>(null);

    // --- Data Loading ---
    const loadData = React.useCallback(() => {
        setIsLoading(true);
        schemaManagerService.loadAllSchemas()
            .then(data => setSchemas(data))
            .catch(err => console.error(err))
            .finally(() => setIsLoading(false));
    }, [schemaManagerService]);

    React.useEffect(() => {
        if (isOpen) {
            setSelectedKey(null);
            setSelectedSchema(null);
            loadData();
        }
    }, [isOpen, loadData]);

    // --- Actions (Reusing Logic via Service) ---

    const handleImportFile = async () => {
        const fileUriOrUris = await fileDialogService.showOpenDialog({
            title: 'Import Schema',
            filters: { 'JSON': ['json'] },
            canSelectFiles: true,
            canSelectMany: true
        });

        if (!fileUriOrUris) return;
        const fileUris: URI[] = Array.isArray(fileUriOrUris) ? fileUriOrUris : [fileUriOrUris];

        messageService.showProgress({ text: 'Importing...' }).then(async progress => {
            const results = await schemaManagerService.importFiles(fileUris, progress);
            if (results.success > 0) messageService.info(`Imported ${results.success}.`, { timeout: MSG_TIMEOUT });
            if (results.fail > 0) messageService.warn(`Failed ${results.fail}.`, { timeout: MSG_TIMEOUT });
        });
    };

    const handleImportUrl = async () => {
        const envVar = await envVariablesServer.getValue('CEDAR_API_KEY');
        const apiKey = envVar?.value;

        let url = '';
        await new Promise((resolve) => {
            let inputUrl = '';
            Modal.confirm({
                title: 'Import Schema from URL',
                content: (
                    <div style={{ marginTop: 10 }}>
                        <Input 
                            placeholder="Enter CEDAR URL" 
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => inputUrl = e.target.value} 
                        />
                        <div style={{ fontSize: 12, color: '#888', marginTop: 5 }}>
                            {apiKey ? 'Using configured API Key' : 'No API Key - trying open access'}
                        </div>
                    </div>
                ),
                onOk: () => resolve(inputUrl),
                onCancel: () => resolve(null)
            });
        }).then(res => url = res as string);

        if (!url) return;

        messageService.showProgress({ text: 'Importing from URL...' }).then(async progress => {
            try {
                const name = await schemaManagerService.importFromUrl(url, apiKey, progress);
                messageService.info(`Imported: ${name}`, { timeout: MSG_TIMEOUT });
            } catch (error) {
                messageService.error(`Import Failed: ${error instanceof Error ? error.message : error}`, { timeout: MSG_TIMEOUT });
            } finally {
                progress.cancel();
            }
        });
    };

    const handleCancel = () => {
        appStateService.updateState({ openSchemaSelectorWindow: false });
    };

    const handleAssociate = async (schema: SchemaInfo) => {
        try {
            setIsLoading(true);
            const profileContent = await schemaManagerService.getConvertedProfileContent(schema.path);
            
            appStateService.updateState({ 
                profile: profileContent,
                openSchemaSelectorWindow: false 
            });
        } catch (error) {
            console.error('Failed to associate schema:', error);
            messageService.error('Failed to load profile content. See console.');
        } finally {
            setIsLoading(false);
        }
    };

    const onOk = () => {
        if (selectedSchema) handleAssociate(selectedSchema);
    };

    const onSelectionChange = (keys: Key[]) => {
        if (keys.length > 0) {
            setSelectedKey(keys[0]);
            const found = schemas.find(s => s.path === keys[0]);
            setSelectedSchema(found || null);
        } else {
            setSelectedKey(null);
            setSelectedSchema(null);
        }
    };

    return (
        <Modal
            title="Select Metadata Schema"
            open={isOpen}
            onCancel={handleCancel}
            width={1000}
            centered
            footer={[
                <Button key="cancel" onClick={handleCancel}>Cancel</Button>,
                <Button 
                    key="associate" 
                    type="primary" 
                    onClick={onOk}
                    disabled={!selectedKey || isLoading}
                    loading={isLoading}
                >
                    Associate
                </Button>
            ]}
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: '600px' }}>
                <SchemaToolbar 
                    onImportFile={handleImportFile}
                    onImportUrl={handleImportUrl}
                    onRefresh={loadData}
                />
                
                <div style={{ flexGrow: 1, overflow: 'auto' }}>
                    <SchemaTable
                        schemas={schemas}
                        isLoading={isLoading}
                        selectionType="radio"
                        onSelectionChange={onSelectionChange}
                    />
                </div>
            </div>
        </Modal>
    );
};