import { injectable, inject } from 'inversify';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Modal, Button, Tooltip } from 'antd';
import { AimOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';

import { SchemaManagerService } from '../services/metadata-schema-manager-service';
import { SchemaApi } from '../services/schema-api';
import CedarTree from './cedar-tree';
import { RemoteSchemaProviderConfig } from '../types';

@injectable()
export class RemoteSchemaBrowserContribution implements FrontendApplicationContribution {
    @inject(SchemaManagerService) protected readonly schemaManagerService!: SchemaManagerService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;

    private container: HTMLDivElement | null = null;
    private reactRoot: ReactDOM.Root | null = null;

    onStart(): void {
        this.container = document.createElement('div');
        this.container.id = 'remote-schema-browser-container';
        document.body.appendChild(this.container);
        this.reactRoot = ReactDOM.createRoot(this.container);

        this.schemaManagerService.onOpenRemoteBrowser((provider) => this.render(true, provider));
    }

    protected render(visible: boolean, provider?: RemoteSchemaProviderConfig): void {
        if (!this.reactRoot) return;

        this.reactRoot.render(
            <RemoteBrowser
                isOpen={visible}
                onClose={() => this.render(false, undefined)}
                schemaManagerService={this.schemaManagerService}
                envVariablesServer={this.envVariablesServer}
                messageService={this.messageService}
                provider={provider}
            />
        );
    }
}

interface BrowserProps {
    isOpen: boolean;
    onClose: () => void;
    schemaManagerService: SchemaManagerService;
    envVariablesServer: EnvVariablesServer;
    messageService: MessageService;
    provider?: RemoteSchemaProviderConfig;
}

const RemoteBrowser: React.FC<BrowserProps> = ({ 
    isOpen, onClose, schemaManagerService, provider 
}) => {
    const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null);
    const [selectedTemplateName, setSelectedTemplateName] = React.useState<string | null>(null);
    const [isDownloading, setIsDownloading] = React.useState(false);
    const [schemaApi, setSchemaApi] = React.useState<SchemaApi | null>(null);
    const [existingIds, setExistingIds] = React.useState<string[]>([]);

    React.useEffect(() => {
        if (isOpen && provider) {
            setSelectedTemplateId(null);
            setSelectedTemplateName(null);
            
            let domain = provider.baseUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '');
            
            setSchemaApi(new SchemaApi({
                domainBase: domain,
                apiKey: provider.apiKey
            }));

            schemaManagerService.loadAllSchemas().then(schemas => {
                const ids = schemas.map(s => s.reference);
                setExistingIds(ids);
            });
        }
    }, [isOpen, provider, schemaManagerService]);

    const handleAdd = async () => {
        if (!selectedTemplateId) return;

        try {
            setIsDownloading(true);
            await schemaManagerService.downloadRemoteSchema(selectedTemplateId, provider);
            onClose(); 
        } catch (error) {
            console.error(error);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDeselect = () => {
        setSelectedTemplateId(null);
        setSelectedTemplateName(null);
    };

    const handleGoTo = () => {
        if (!selectedTemplateId) return;
        const element = document.getElementById(`cedar-node-${selectedTemplateId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    const footer = (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                overflow: 'hidden',
                marginRight: '16px' 
            }}>
                {selectedTemplateName ? (
                    <>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <Tooltip title="Locate in tree">
                                <Button 
                                    type="text" 
                                    size="small" 
                                    icon={<AimOutlined />} 
                                    onClick={handleGoTo} 
                                />
                            </Tooltip>
                            <Tooltip title="Deselect">
                                <Button 
                                    type="text" 
                                    size="small" 
                                    danger
                                    icon={<CloseCircleOutlined />} 
                                    onClick={handleDeselect} 
                                />
                            </Tooltip>
                        </div>
                        <Tooltip title={selectedTemplateName} placement="topLeft">
                            <span style={{ 
                                whiteSpace: 'nowrap', 
                                overflow: 'hidden', 
                                textOverflow: 'ellipsis',
                                fontWeight: 500
                            }}>
                                Selected: {selectedTemplateName}
                            </span>
                        </Tooltip>
                    </>
                ) : (
                    <span style={{ color: '#999', fontStyle: 'italic' }}>No template selected</span>
                )}
            </div>

            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <Button key="cancel" onClick={onClose}>CANCEL</Button>
                <Button 
                    key="add" 
                    type="primary" 
                    onClick={handleAdd} 
                    disabled={!selectedTemplateId || isDownloading}
                    loading={isDownloading}
                >
                    ADD
                </Button>
            </div>
        </div>
    );

    return (
        <Modal
            title={`Browse ${provider?.title || 'Remote Provider'}`}
            open={isOpen}
            onCancel={onClose}
            width={600}
            centered
            zIndex={1050}
            destroyOnClose={true} 
            // FIX: Changed layout to flex column so children handle scrolling
            bodyStyle={{ height: '500px', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}
            footer={footer}
        >
            {schemaApi ? (
                <CedarTree
                    schemaApi={schemaApi}
                    alreadySelectedSchemaIds={existingIds}
                    onTemplateSelected={(id, name) => {
                        setSelectedTemplateId(id);
                        setSelectedTemplateName(name);
                    }}
                    onFolderSelected={(id, name) => {
                        console.log(`Folder selected: ${name}`);
                    }}
                />
            ) : (
                <div style={{ padding: 20 }}>Initializing API...</div>
            )}
        </Modal>
    );
};