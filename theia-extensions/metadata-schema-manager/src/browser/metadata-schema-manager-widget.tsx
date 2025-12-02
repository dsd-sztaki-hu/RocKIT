// src/browser/metadata-schema-manager-widget.tsx
import * as React from 'react';
import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser';
import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { URI } from '@theia/core/lib/common/uri';
import { OpenFileDialogProps, FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import '../../src/browser/style/index.css';

// Define the type for the result of getValue if not available from the module
interface EnvVariableResult {
    name: string;
    value?: string;
    original?: string;
}

export const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager';
export const METADATA_SCHEMA_MANAGER_LABEL = 'Metadata Schema Manager';

export interface SchemaInfo {
    name: string;
    source: 'local' | 'remote';
    version: string;
    path: string;
}

type SortField = 'name' | 'source' | 'version';
type SortDirection = 'asc' | 'desc';

// Enhanced Table Component
const SchemaTable: React.FC<{
    schemas: SchemaInfo[];
    isLoading: boolean;
}> = ({ schemas, isLoading }) => {
    const [sortField, setSortField] = React.useState<SortField>('name');
    const [sortDirection, setSortDirection] = React.useState<SortDirection>('asc');
    const [filterText, setFilterText] = React.useState('');

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const filteredAndSortedSchemas = React.useMemo(() => {
        let result = [...schemas];

        // Filter
        if (filterText) {
            result = result.filter(schema =>
                schema.name.toLowerCase().includes(filterText.toLowerCase()) ||
                schema.source.toLowerCase().includes(filterText.toLowerCase()) ||
                schema.version.toLowerCase().includes(filterText.toLowerCase())
            );
        }

        // Sort
        result.sort((a, b) => {
            const aVal = a[sortField];
            const bVal = b[sortField];
            const comparison = aVal.localeCompare(bVal);
            return sortDirection === 'asc' ? comparison : -comparison;
        });

        return result;
    }, [schemas, filterText, sortField, sortDirection]);

    const getSortIcon = (field: SortField) => {
        if (sortField !== field) return ' ↕';
        return sortDirection === 'asc' ? ' ↑' : ' ↓';
    };

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, [
        // Filter input
        React.createElement('input', {
            key: 'filter',
            type: 'text',
            placeholder: 'Filter schemas...',
            value: filterText,
            className: 'metadata-schema-filter',
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFilterText(e.target.value)
        }),
        // Table wrapper
        React.createElement('div', { key: 'table-wrapper', className: 'metadata-schema-table-wrapper' }, [
            React.createElement('table', {
                key: 'schema-table',
                className: 'metadata-schema-table'
            }, [
                // Table header
                React.createElement('thead', { key: 'thead' }, [
                    React.createElement('tr', { key: 'header-row' }, [
                        React.createElement('th', {
                            key: 'name-header',
                            onClick: () => handleSort('name')
                        }, [
                            'Schema Name',
                            React.createElement('span', { 
                                key: 'sort-icon',
                                className: 'metadata-schema-sort-icon' 
                            }, getSortIcon('name'))
                        ]),
                        React.createElement('th', {
                            key: 'source-header',
                            onClick: () => handleSort('source')
                        }, [
                            'Source',
                            React.createElement('span', { 
                                key: 'sort-icon',
                                className: 'metadata-schema-sort-icon' 
                            }, getSortIcon('source'))
                        ]),
                        React.createElement('th', {
                            key: 'version-header',
                            onClick: () => handleSort('version')
                        }, [
                            'Version',
                            React.createElement('span', { 
                                key: 'sort-icon',
                                className: 'metadata-schema-sort-icon' 
                            }, getSortIcon('version'))
                        ])
                    ])
                ]),
                // Table body
                React.createElement('tbody', { key: 'tbody' }, [
                    isLoading ? (
                        React.createElement('tr', { key: 'loading-row' }, [
                            React.createElement('td', {
                                key: 'loading-cell',
                                colSpan: 3,
                                className: 'metadata-schema-loading'
                            }, 'Loading schemas...')
                        ])
                    ) : filteredAndSortedSchemas.length === 0 ? (
                        React.createElement('tr', { key: 'no-data-row' }, [
                            React.createElement('td', {
                                key: 'no-data-cell',
                                colSpan: 3,
                                className: 'metadata-schema-empty-state'
                            }, filterText ? 'No matching schemas found' : 'No schemas found')
                        ])
                    ) : (
                        filteredAndSortedSchemas.map((schema, index) =>
                            React.createElement('tr', { key: index }, [
                                React.createElement('td', {
                                    key: `name-${index}`
                                }, schema.name),
                                React.createElement('td', {
                                    key: `source-${index}`
                                },
                                    React.createElement('span', {
                                        className: schema.source === 'local' 
                                            ? 'metadata-schema-source-local' 
                                            : 'metadata-schema-source-remote'
                                    }, schema.source.charAt(0).toUpperCase() + schema.source.slice(1))
                                ),
                                React.createElement('td', {
                                    key: `version-${index}`,
                                    className: 'metadata-schema-version'
                                }, schema.version)
                            ])
                        )
                    )
                ])
            ])
        ])
    ]);
};

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
        console.log("Constructor called for MetadataSchemaManagerWidget");
        this.setupDirectories();
    }

    protected async setupDirectories(): Promise<void> {
        console.log("Starting setupDirectories");
        const theiaConfigDirResult: EnvVariableResult | undefined = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
        const theiaConfigDirPath = theiaConfigDirResult?.value;

        if (!theiaConfigDirPath) {
             console.error("Could not determine THEIA_CONFIG_DIR using EnvVariablesServer.");
             this.messageService.error("Could not determine THEIA_CONFIG_DIR.");
             this.isLoading = false;
             this.update();
             return;
        }

        console.log("THEIA_CONFIG_DIR found:", theiaConfigDirPath);

        const theiaConfigDirUri = new URI(theiaConfigDirPath);
        const homeDirUri = theiaConfigDirUri.parent;
        const homePath = homeDirUri.path.toString();

        console.log("Derived home path:", homePath);

        const homeDir = new URI(homePath);
        const aromaDir = homeDir.resolve('.aroma');
        const schemasDir = aromaDir.resolve('metadata-schemas');
        const localDir = schemasDir.resolve('local');
        const remoteDir = schemasDir.resolve('remote');

        try {
            if (!(await this.fileService.exists(aromaDir))) {
                console.log("Creating .aroma directory");
                await this.fileService.createFolder(aromaDir);
            }

            if (!(await this.fileService.exists(schemasDir))) {
                console.log("Creating metadata-schemas directory");
                await this.fileService.createFolder(schemasDir);
            }

            if (!(await this.fileService.exists(localDir))) {
                console.log("Creating local directory");
                await this.fileService.createFolder(localDir);
            }

            if (!(await this.fileService.exists(remoteDir))) {
                console.log("Creating remote directory");
                await this.fileService.createFolder(remoteDir);
            }

            console.log("Directories setup complete, loading schemas...");
            await this.loadSchemas();

        } catch (error) {
            console.error('Error setting up directories:', error);
            this.messageService.error(`Error setting up directories: ${error}`);
            this.isLoading = false;
            this.update();
        }
    }

    protected async loadSchemas(): Promise<void> {
        console.log("Starting loadSchemas");
        this.isLoading = true;
        this.schemas = [];

        try {
            const theiaConfigDirResult: EnvVariableResult | undefined = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
            const theiaConfigDirPath = theiaConfigDirResult?.value;

            if (!theiaConfigDirPath) {
                 console.error("Could not determine THEIA_CONFIG_DIR for loading schemas using EnvVariablesServer.");
                 this.messageService.error("Could not determine THEIA_CONFIG_DIR.");
                 this.isLoading = false;
                 this.update();
                 return;
            }

            const theiaConfigDirUri = new URI(theiaConfigDirPath);
            const homeDirUri = theiaConfigDirUri.parent;
            const homePath = homeDirUri.path.toString();

            console.log("Loading schemas from home path:", homePath);

            const homeDir = new URI(homePath);
            const schemasDir = homeDir.resolve('.aroma/metadata-schemas');
            const localDir = schemasDir.resolve('local');
            const remoteDir = schemasDir.resolve('remote');

            const localUri = localDir;
            const localStat = await this.fileService.resolve(localUri);
            console.log("Local directory contents:", localStat?.children?.map(c => c.name) || "None");
            if (localStat && localStat.children) {
                for (const child of localStat.children) {
                    if (child.name.endsWith('.json')) {
                        console.log("Reading local schema:", child.name);
                        const content = await this.fileService.read(child.resource);
                        let schemaContent;
                        try {
                            schemaContent = JSON.parse(content.value);
                            if (typeof schemaContent['schema:name'] !== 'string' || typeof schemaContent['pav:version'] !== 'string') {
                                console.warn(`Schema ${child.name} is missing required 'schema:name' or 'pav:version' field.`);
                                continue;
                            }
                        } catch (e) {
                            console.warn(`Could not parse JSON from ${child.name}:`, e);
                            continue;
                        }
                        const name = schemaContent['schema:name'];
                        const version = schemaContent['pav:version'];

                        this.schemas.push({
                            name: name,
                            source: 'local',
                            version: version,
                            path: child.resource.toString()
                        });
                    }
                }
            }

            const remoteUri = remoteDir;
            const remoteStat = await this.fileService.resolve(remoteUri);
            console.log("Remote directory contents:", remoteStat?.children?.map(c => c.name) || "None");
            if (remoteStat && remoteStat.children) {
                for (const child of remoteStat.children) {
                    if (child.name.endsWith('.json')) {
                        console.log("Reading remote schema:", child.name);
                        const content = await this.fileService.read(child.resource);
                        let schemaContent;
                        try {
                            schemaContent = JSON.parse(content.value);
                            if (typeof schemaContent['schema:name'] !== 'string' || typeof schemaContent['pav:version'] !== 'string') {
                                console.warn(`Schema ${child.name} is missing required 'schema:name' or 'pav:version' field.`);
                                continue;
                            }
                        } catch (e) {
                            console.warn(`Could not parse JSON from ${child.name}:`, e);
                            continue;
                        }
                        const name = schemaContent['schema:name'];
                        const version = schemaContent['pav:version'];

                        this.schemas.push({
                            name: name,
                            source: 'remote',
                            version: version,
                            path: child.resource.toString()
                        });
                    }
                }
            }
            console.log("Loaded schemas:", this.schemas);
        } catch (error) {
            console.error('Error loading schemas:', error);
            this.messageService.error(`Error loading schemas: ${error}`);
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected async importSchemaFromFile(): Promise<void> {
        try {
            const theiaConfigDirResult: EnvVariableResult | undefined = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
            const theiaConfigDirPath = theiaConfigDirResult?.value;

            if (!theiaConfigDirPath) {
                 console.error("Could not determine THEIA_CONFIG_DIR for importing schema using EnvVariablesServer.");
                 this.messageService.error("Could not determine THEIA_CONFIG_DIR.");
                 return;
            }

            const theiaConfigDirUri = new URI(theiaConfigDirPath);
            const homeDirUri = theiaConfigDirUri.parent;
            const homePath = homeDirUri.path.toString();

            const localDirUri = new URI(homePath).resolve('.aroma/metadata-schemas/local');

            const dialogProps: OpenFileDialogProps = {
                title: 'Import Schema from File',
                filters: {
                    'JSON files': ['json']
                },
                canSelectFolders: false,
                canSelectFiles: true
            };

            const fileUri = await this.fileDialogService.showOpenDialog(dialogProps);

            if (fileUri) {
                const fileContent = await this.fileService.read(fileUri);
                const fileName = fileUri.path.base;
                const targetUri = localDirUri.resolve(fileName);

                if (await this.fileService.exists(targetUri)) {
                    const overwrite = confirm(`File ${fileName} already exists. Do you want to overwrite it?`);
                    if (!overwrite) {
                        return;
                    }
                }

                await this.fileService.write(targetUri, fileContent.value);
                this.messageService.info(`Schema ${fileName} imported successfully!`);
                await this.loadSchemas();
            }
        } catch (error) {
            console.error('Error importing schema from file:', error);
            this.messageService.error(`Error importing schema: ${error}`);
        }
    }

    protected async importSchemaFromUrl(): Promise<void> {
        console.log('Import schema from URL button clicked');
        this.messageService.info('Import from URL feature is not yet implemented');
    }

    protected async refreshSchemas(): Promise<void> {
        console.log("Refreshing schemas...");
        await this.loadSchemas();
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        console.log("onActivateRequest called");
        this.update();
        setTimeout(() => {
            if (this.node && this.node.parentElement) {
                this.node.parentElement.style.height = 'auto';
                this.update();
            }
        }, 0);
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        console.log("onAfterAttach called");
        this.node.innerHTML = '';
        this.render();
    }

    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        console.log("onUpdateRequest called, re-rendering");
        this.render();
    }

    protected render(): void {
        console.log("Rendering Metadata Schema Manager Widget, isLoading:", this.isLoading, "schemas:", this.schemas.length);

        const component = React.createElement('div', {
            className: 'metadata-schema-manager-container'
        }, [
            React.createElement('div', {
                key: 'controls',
                className: 'metadata-schema-controls'
            }, [
                React.createElement('button', {
                    key: 'import-file',
                    className: 'theia-button',
                    onClick: () => this.importSchemaFromFile()
                }, 'Import Schema from File'),
                React.createElement('button', {
                    key: 'import-url',
                    className: 'theia-button',
                    onClick: () => this.importSchemaFromUrl()
                }, 'Import Schema from URL'),
                React.createElement('button', {
                    key: 'refresh',
                    className: 'theia-button',
                    onClick: () => this.refreshSchemas()
                }, 'Refresh')
            ]),
            React.createElement(SchemaTable, {
                key: 'schema-table',
                schemas: this.schemas,
                isLoading: this.isLoading
            })
        ]);

        const ReactDOM = require('react-dom/client');
        if (ReactDOM.createRoot) {
            if (!this.reactRoot) {
                this.reactRoot = ReactDOM.createRoot(this.node);
            }
            this.reactRoot.render(component);
        } else {
            const legacyReactDOM = require('react-dom');
            legacyReactDOM.render(component, this.node);
        }
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        } else {
            const ReactDOM = require('react-dom');
            ReactDOM.unmountComponentAtNode(this.node);
        }
        super.onBeforeDetach(msg);
    }

    storeState(): object {
        return {};
    }

    restoreState(oldState: object): void {
        // No state to restore
    }
}