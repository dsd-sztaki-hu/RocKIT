// src/browser/metadata-schema-manager-widget.tsx
import * as React from 'react';
import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser';
import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { URI } from '@theia/core/lib/common/uri';
import { OpenFileDialogProps, FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';

import { Button, Input, Table, Spin, Modal } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Key } from 'antd/es/table/interface';

import '../../src/browser/style/index.css';

export interface SchemaInfo {
    name: string;
    source: 'local' | 'remote';
    version: string;
    path: string; // The file URI string
}

export const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager';
export const METADATA_SCHEMA_MANAGER_LABEL = 'Metadata Schema Manager';

/* --------------------- Windows-safe URI --------------------- */
function toFileUri(path: string): URI {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.match(/^[a-zA-Z]:/)) {
        return new URI('file:///' + normalized);
    } else {
        return new URI('file://' + normalized);
    }
}

/* --------------------- Ant Design Table --------------------- */
interface SchemaTableProps {
    schemas: SchemaInfo[];
    isLoading: boolean;
    onSelectionChange: (selectedRowKeys: Key[]) => void;
    onDelete: (schemaPaths: string[]) => void; // Callback to handle deletion
}

const SchemaTable: React.FC<SchemaTableProps> = ({ schemas, isLoading, onSelectionChange, onDelete }) => {
    const searchInput = React.useRef<any>(null);

    const handleSearch = (selectedKeys: string[], confirm: () => void, dataIndex: string) => {
        confirm();
    };

    const handleReset = (clearFilters: () => void) => {
        clearFilters();
    };

    const getColumnSearchProps = (dataIndex: keyof SchemaInfo) => ({
        filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => (
            <div style={{ padding: 8 }}>
                <Input
                    ref={searchInput}
                    placeholder={`Search ${dataIndex}`}
                    value={selectedKeys[0]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                        setSelectedKeys(e.target.value ? [e.target.value] : [])
                    }
                    onPressEnter={() => handleSearch(selectedKeys as string[], confirm, dataIndex)}
                    style={{ marginBottom: 8, display: 'block' }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                        type="primary"
                        onClick={() => handleSearch(selectedKeys as string[], confirm, dataIndex)}
                        size="small"
                        style={{ width: 90 }}
                    >
                        Search
                    </Button>
                    <Button
                        onClick={() => clearFilters && handleReset(clearFilters)}
                        size="small"
                        style={{ width: 90 }}
                    >
                        Reset
                    </Button>
                </div>
            </div>
        ),
        filterIcon: (filtered: boolean) => (
            <span style={{ color: filtered ? '#1890ff' : undefined }}>🔍</span>
        ),
        onFilter: (value: any, record: SchemaInfo) =>
            record[dataIndex]
                .toString()
                .toLowerCase()
                .includes((value as string).toLowerCase()),
        onFilterDropdownOpenChange: (visible: boolean) => {
            if (visible) {
                setTimeout(() => searchInput.current?.select(), 100);
            }
        },
    });

    const rowSelection = {
        onChange: (selectedRowKeys: Key[]) => {
            onSelectionChange(selectedRowKeys);
        },
    };

    const columns: ColumnsType<SchemaInfo> = [
        {
            title: 'Schema Name',
            dataIndex: 'name',
            key: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
            ...getColumnSearchProps('name'),
        },
        {
            title: 'Source',
            dataIndex: 'source',
            key: 'source',
            width: 120,
            filters: [
                { text: 'Local', value: 'local' },
                { text: 'Remote', value: 'remote' },
            ],
            onFilter: (value, record) => record.source === value,
        },
        {
            title: 'Version',
            dataIndex: 'version',
            key: 'version',
            width: 130,
            sorter: (a, b) => a.version.localeCompare(b.version),
        },
        {
            title: 'Action',
            key: 'action',
            width: 100,
            render: (_, record) => (
                <a onClick={() => onDelete([record.path])}>Delete</a>
            ),
        },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px' }}>
            <div style={{ flexGrow: 1, overflow: 'auto' }}>
                {isLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '32px' }}>
                        <Spin size="large" />
                    </div>
                ) : (
                    <Table
                        dataSource={schemas}
                        columns={columns}
                        rowKey={(record) => record.path} // Use path as unique key for selection
                        rowSelection={{ type: 'checkbox', ...rowSelection }}
                        size="small"
                        pagination={{
                            pageSize: 10,
                            showSizeChanger: true,
                            showTotal: (total) => `Total ${total} schemas`
                        }}
                    />
                )}
            </div>
        </div>
    );
};

/* --------------------- Main Widget Class --------------------- */
@injectable()
export class MetadataSchemaManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = METADATA_SCHEMA_MANAGER_WIDGET_ID;
    static readonly LABEL = METADATA_SCHEMA_MANAGER_LABEL;

    protected readonly fileService: FileService;
    protected readonly fileDialogService: FileDialogService;
    protected readonly messageService: MessageService;
    protected readonly envVariablesServer: EnvVariablesServer;

    protected schemas: SchemaInfo[] = [];
    protected isLoading = true;
    protected selectedSchemaKeys: Key[] = []; // State for selected rows
    private reactRoot: any;

    constructor(
        @inject(FileService) fileService: FileService,
        @inject(FileDialogService) fileDialogService: FileDialogService,
        @inject(MessageService) messageService: MessageService,
        @inject(EnvVariablesServer) envVariablesServer: EnvVariablesServer
    ) {
        super();
        this.fileService = fileService;
        this.fileDialogService = fileDialogService;
        this.messageService = messageService;
        this.envVariablesServer = envVariablesServer;

        this.id = METADATA_SCHEMA_MANAGER_WIDGET_ID;
        this.title.label = METADATA_SCHEMA_MANAGER_LABEL;
        this.title.caption = METADATA_SCHEMA_MANAGER_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-file-code';
    }

    protected async setupDirectories(): Promise<void> {
        try {
            const result = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
            const configPath = result?.value;
            if (!configPath) throw new Error('THEIA_CONFIG_DIR not found');

            const configUri = toFileUri(configPath);
            const homeUri = configUri.parent;

            const aromaDir = homeUri.resolve('.aroma');
            const schemasDir = aromaDir.resolve('metadata-schemas');
            const localDir = schemasDir.resolve('local');
            const remoteDir = schemasDir.resolve('remote');

            if (!(await this.fileService.exists(aromaDir))) await this.fileService.createFolder(aromaDir);
            if (!(await this.fileService.exists(schemasDir))) await this.fileService.createFolder(schemasDir);
            if (!(await this.fileService.exists(localDir))) await this.fileService.createFolder(localDir);
            if (!(await this.fileService.exists(remoteDir))) await this.fileService.createFolder(remoteDir);

            await this.loadSchemas();
        } catch (err) {
            this.messageService.error(`Error setting up directories: ${err}`);
            this.isLoading = false;
            this.update();
        }
    }

    protected async loadSchemas(): Promise<void> {
        this.isLoading = true;
        this.schemas = [];
        this.selectedSchemaKeys = []; // Clear selection on load

        try {
            const result = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
            const configPath = result?.value;
            if (!configPath) throw new Error('THEIA_CONFIG_DIR not found');

            const homeUri = toFileUri(configPath).parent;
            const schemasDir = homeUri.resolve('.aroma/metadata-schemas');

            for (const source of ['local', 'remote'] as const) {
                const dir = schemasDir.resolve(source);
                const stat = await this.fileService.resolve(dir);
                if (!stat?.children) continue;

                for (const file of stat.children) {
                    if (!file.name.endsWith('.json')) continue;

                    try {
                        const content = await this.fileService.read(file.resource);
                        const parsed = JSON.parse(content.value);
                        if (!parsed['schema:name'] || !parsed['pav:version']) continue;

                        this.schemas.push({
                            name: parsed['schema:name'],
                            version: parsed['pav:version'],
                            source,
                            path: file.resource.toString()
                        });
                    } catch {
                        console.warn(`Failed to parse JSON: ${file.name}`);
                    }
                }
            }
        } catch (err) {
            this.messageService.error(`Error loading schemas: ${err}`);
        }

        this.isLoading = false;
        this.update();
    }

    /* --------------------- Actions --------------------- */

    protected onSelectionChange = (selectedRowKeys: Key[]): void => {
        this.selectedSchemaKeys = selectedRowKeys;
        this.update();
    };

    protected async deleteSchemas(schemaPaths: string[]): Promise<void> {
        if (schemaPaths.length === 0) return;

        const count = schemaPaths.length;
        const itemName = count > 1 ? `${count} selected items` : `the selected item`;
        
        // Show confirmation modal
        Modal.confirm({
            title: 'Confirm Deletion',
            content: `Are you sure you want to delete ${itemName}?`,
            okText: 'Yes',
            cancelText: 'Cancel',
            onOk: async () => {
                this.isLoading = true;
                this.update();
                let successfulDeletes = 0;
                
                for (const path of schemaPaths) {
                    try {
                        const uri = new URI(path);
                        await this.fileService.delete(uri);
                        successfulDeletes++;
                    } catch (err) {
                        this.messageService.error(`Failed to delete schema at ${path}: ${err}`);
                    }
                }

                if (successfulDeletes > 0) {
                    this.messageService.info(`Successfully deleted ${successfulDeletes} schema(s).`);
                }
                
                // Refresh table and clear selection
                await this.loadSchemas();
            }
        });
    }

    protected async importSchemaFromFile(): Promise<void> {
        const result = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
        const configPath = result?.value;
        if (!configPath) return;

        const localDir = toFileUri(configPath).parent.resolve('.aroma/metadata-schemas/local');

        const props: OpenFileDialogProps = {
            title: 'Import Schema',
            filters: { 'JSON': ['json'] },
            canSelectFiles: true,
            canSelectMany: true 
        };

        const fileUriOrUris = await this.fileDialogService.showOpenDialog(props);
        
        if (!fileUriOrUris) return;

        const fileUris: URI[] = Array.isArray(fileUriOrUris) ? fileUriOrUris : [fileUriOrUris];

        let importCount = 0;
        
        for (const fileUri of fileUris) {
            if (!fileUri) continue;

            const fileName = fileUri.path.base;
            const targetUri = localDir.resolve(fileName);
            
            try {
                const content = await this.fileService.read(fileUri);

                if (await this.fileService.exists(targetUri)) {
                    if (!confirm(`Overwrite existing schema file ${fileName}?`)) {
                        this.messageService.warn(`Skipped importing ${fileName}.`);
                        continue;
                    }
                }

                await this.fileService.write(targetUri, content.value);
                importCount++;
            } catch (error) {
                this.messageService.error(`Failed to import ${fileName}: ${error}`);
            }
        }

        if (importCount > 0) {
            this.messageService.info(`Successfully imported ${importCount} schema(s).`);
            await this.loadSchemas();
        }
    }

    protected async importSchemaFromUrl(): Promise<void> {
        let url = '';
        let apiKey = '';

        // Create a promise-based modal for URL and API Key input
        const getInputs = (): Promise<{ url: string; apiKey: string } | null> => {
            return new Promise((resolve) => {
                let inputUrl = '';
                let inputApiKey = '';

                Modal.confirm({
                    title: 'Import Schema from URL',
                    content: (
                        <div>
                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '4px' }}>URL:</label>
                                <Input
                                    placeholder="Enter schema URL"
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => { inputUrl = e.target.value; }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px' }}>API Key:</label>
                                <Input
                                    placeholder="Enter API key"
                                    type="password"
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => { inputApiKey = e.target.value; }}
                                />
                            </div>
                        </div>
                    ),
                    okText: 'Import',
                    cancelText: 'Cancel',
                    onOk: () => {
                        if (!inputUrl || !inputApiKey) {
                            this.messageService.error('Both URL and API Key are required.');
                            resolve(null);
                            return;
                        }
                        resolve({ url: inputUrl, apiKey: inputApiKey });
                    },
                    onCancel: () => {
                        resolve(null);
                    }
                });
            });
        };

        const inputs = await getInputs();
        if (!inputs) return;

        url = inputs.url;
        apiKey = inputs.apiKey;

        try {
            // Make the HTTP request with fetch (similar to curl)
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `apiKey ${apiKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const jsonData = await response.json();

            // Validate required fields
            if (!jsonData['schema:name'] || !jsonData['pav:version']) {
                throw new Error('Invalid schema: missing schema:name or pav:version fields');
            }

            // Generate filename
            const schemaName = jsonData['schema:name']
                .toLowerCase()
                .replace(/\s+/g, '_');
            const version = jsonData['pav:version'];
            const fileName = `remote_${schemaName}_v${version}.json`;

            // Get remote directory path
            const result = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
            const configPath = result?.value;
            if (!configPath) throw new Error('THEIA_CONFIG_DIR not found');

            const remoteDir = toFileUri(configPath).parent.resolve('.aroma/metadata-schemas/remote');
            const targetUri = remoteDir.resolve(fileName);

            // Check if file already exists
            if (await this.fileService.exists(targetUri)) {
                const overwrite = confirm(`Schema file ${fileName} already exists. Overwrite?`);
                if (!overwrite) {
                    this.messageService.warn('Import cancelled.');
                    return;
                }
            }

            // Write the JSON file
            await this.fileService.write(targetUri, JSON.stringify(jsonData, null, 2));

            this.messageService.info(`Successfully imported schema: ${jsonData['schema:name']}`);
            await this.loadSchemas();

        } catch (error) {
            this.messageService.error(`Failed to import schema from URL: ${error}`);
        }
    }

    protected async refreshSchemas(): Promise<void> {
        await this.loadSchemas();
    }

    /* --------------------- Widget Lifecycle --------------------- */
    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.node.innerHTML = '';
        this.render();
        this.setupDirectories();
    }

    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        this.render();
    }

    protected render(): void {
        if (!this.isAttached) return;

        const ReactDOM = require('react-dom/client');
        this.node.classList.add('metadata-schema-manager-widget');
        
        if (!this.reactRoot) this.reactRoot = ReactDOM.createRoot(this.node);

        // Get SchemaInfo objects for selected keys
        const selectedSchemaPaths = this.schemas
            .filter(schema => this.selectedSchemaKeys.includes(schema.path))
            .map(schema => schema.path);

        this.reactRoot.render(
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'flex', gap: '8px', padding: '8px' }}>
                    <Button type="primary" onClick={() => this.importSchemaFromFile()}>
                        Import From File
                    </Button>
                    <Button type="primary" onClick={() => this.importSchemaFromUrl()}>
                        Import From URL
                    </Button>
                    <Button type="primary" onClick={() => this.refreshSchemas()}>
                        Refresh
                    </Button>
                    {/* Conditionally display Delete Selected button */}
                    {this.selectedSchemaKeys.length > 0 && (
                        <Button 
                            type="primary" 
                            danger 
                            onClick={() => this.deleteSchemas(selectedSchemaPaths)}
                        >
                            Delete {this.selectedSchemaKeys.length} Selected Rows
                        </Button>
                    )}
                </div>
                <div style={{ flexGrow: 1 }}>
                    <SchemaTable 
                        schemas={this.schemas} 
                        isLoading={this.isLoading} 
                        onSelectionChange={this.onSelectionChange}
                        onDelete={(paths) => this.deleteSchemas(paths)}
                    />
                </div>
            </div>
        );
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) this.reactRoot.unmount();
        super.onBeforeDetach(msg);
    }

    storeState(): object { return {}; }
    restoreState(): void {}
}