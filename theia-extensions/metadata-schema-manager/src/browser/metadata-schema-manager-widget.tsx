// src/browser/metadata-schema-manager-widget.tsx
import * as React from 'react';
import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser';
import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { URI } from '@theia/core/lib/common/uri';
import { OpenFileDialogProps, FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';

import { Button, Input, Table, Spin } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import '../../src/browser/style/index.css';

export interface SchemaInfo {
    name: string;
    source: 'local' | 'remote';
    version: string;
    path: string;
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
const SchemaTable: React.FC<{ schemas: SchemaInfo[]; isLoading: boolean }> = ({ schemas, isLoading }) => {
    const [filter, setFilter] = React.useState('');

    const columns: ColumnsType<SchemaInfo> = [
        {
            title: 'Schema Name',
            dataIndex: 'name',
            key: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
        },
        {
            title: 'Source',
            dataIndex: 'source',
            key: 'source',
            width: 120,
            sorter: (a, b) => a.source.localeCompare(b.source),
        },
        {
            title: 'Version',
            dataIndex: 'version',
            key: 'version',
            width: 130,
            sorter: (a, b) => a.version.localeCompare(b.version),
        }
    ];

    const filteredData = React.useMemo(() => {
        return schemas.filter(schema =>
            !filter ||
            schema.name.toLowerCase().includes(filter.toLowerCase()) ||
            schema.source.toLowerCase().includes(filter.toLowerCase()) ||
            schema.version.toLowerCase().includes(filter.toLowerCase())
        );
    }, [schemas, filter]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px' }}>
            <Input
                placeholder="Filter schemas"
                size="small"
                style={{ marginBottom: '8px' }}
                value={filter}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
            />
            <div style={{ flexGrow: 1, overflow: 'auto' }}>
                {isLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '32px' }}>
                        <Spin size="large" />
                    </div>
                ) : (
                    <Table
                        dataSource={filteredData}
                        columns={columns}
                        rowKey={(record, index) => `${record.name}-${index}`}
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
    protected async importSchemaFromFile(): Promise<void> {
        const result = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
        const configPath = result?.value;
        if (!configPath) return;

        const localDir = toFileUri(configPath).parent.resolve('.aroma/metadata-schemas/local');

        const props: OpenFileDialogProps = {
            title: 'Import Schema',
            filters: { 'JSON': ['json'] },
            canSelectFiles: true
        };

        const fileUri = await this.fileDialogService.showOpenDialog(props);
        if (!fileUri) return;

        const fileName = fileUri.path.base;
        const targetUri = localDir.resolve(fileName);
        const content = await this.fileService.read(fileUri);

        if (await this.fileService.exists(targetUri)) {
            if (!confirm(`Overwrite ${fileName}?`)) return;
        }

        await this.fileService.write(targetUri, content.value);
        this.messageService.info(`Imported ${fileName}`);
        await this.loadSchemas();
    }

    protected async importSchemaFromUrl(): Promise<void> {
        this.messageService.info('Import from URL not implemented yet.');
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
                </div>
                <div style={{ flexGrow: 1 }}>
                    <SchemaTable schemas={this.schemas} isLoading={this.isLoading} />
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