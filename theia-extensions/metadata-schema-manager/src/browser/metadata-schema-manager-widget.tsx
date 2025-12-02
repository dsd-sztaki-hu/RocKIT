// src/browser/metadata-schema-manager-widget.tsx
import * as React from 'react';
import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser';
import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { URI } from '@theia/core/lib/common/uri';
import { OpenFileDialogProps, FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';

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

@injectable()
export class MetadataSchemaManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = METADATA_SCHEMA_MANAGER_WIDGET_ID;
    static readonly LABEL = METADATA_SCHEMA_MANAGER_LABEL;

    // Declare properties including the new EnvVariablesServer
    protected readonly fileService: FileService;
    protected readonly fileDialogService: FileDialogService;
    protected readonly messageService: MessageService;
    protected readonly envVariablesServer: EnvVariablesServer; // Add the env server

    protected schemas: SchemaInfo[] = [];
    protected isLoading = true;

    // Initialize properties via constructor parameters, including the env server
    constructor(
        @inject(FileService) fileService: FileService,
        @inject(FileDialogService) fileDialogService: FileDialogService,
        @inject(MessageService) messageService: MessageService,
        @inject(EnvVariablesServer) envVariablesServer: EnvVariablesServer // Inject the env server
    ) {
        super();
        this.fileService = fileService;
        this.fileDialogService = fileDialogService;
        this.messageService = messageService;
        this.envVariablesServer = envVariablesServer; // Assign the env server

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
        // Use the EnvVariablesServer to get THEIA_CONFIG_DIR
        const theiaConfigDirResult: EnvVariableResult | undefined = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
        const theiaConfigDirPath = theiaConfigDirResult?.value;

        if (!theiaConfigDirPath) {
             console.error("Could not determine THEIA_CONFIG_DIR using EnvVariablesServer.");
             this.messageService.error("Could not determine THEIA_CONFIG_DIR.");
             this.isLoading = false; // Stop loading indicator
             this.update(); // Re-render to show error or empty state
             return;
        }

        console.log("THEIA_CONFIG_DIR found:", theiaConfigDirPath);

        // The THEIA_CONFIG_DIR is usually something like $HOME/.theia
        // So its parent directory should be the home directory
        const theiaConfigDirUri = new URI(theiaConfigDirPath);
        const homeDirUri = theiaConfigDirUri.parent; // Navigate up one level
        const homePath = homeDirUri.path.toString();

        console.log("Derived home path:", homePath);

        const homeDir = new URI(homePath);
        const aromaDir = homeDir.resolve('.aroma');
        const schemasDir = aromaDir.resolve('metadata-schemas');
        const localDir = schemasDir.resolve('local');
        const remoteDir = schemasDir.resolve('remote');

        try {
            // Create .aroma directory if it doesn't exist
            if (!(await this.fileService.exists(aromaDir))) {
                console.log("Creating .aroma directory");
                await this.fileService.createFolder(aromaDir);
            }

            // Create metadata-schemas directory if it doesn't exist
            if (!(await this.fileService.exists(schemasDir))) {
                console.log("Creating metadata-schemas directory");
                await this.fileService.createFolder(schemasDir);
            }

            // Create local directory if it doesn't exist
            if (!(await this.fileService.exists(localDir))) {
                console.log("Creating local directory");
                await this.fileService.createFolder(localDir);
            }

            // Create remote directory if it doesn't exist
            if (!(await this.fileService.exists(remoteDir))) {
                console.log("Creating remote directory");
                await this.fileService.createFolder(remoteDir);
            }

            console.log("Directories setup complete, loading schemas...");
            await this.loadSchemas();
        } catch (error) {
            console.error('Error setting up directories:', error);
            this.messageService.error(`Error setting up directories: ${error}`);
            this.isLoading = false; // Stop loading indicator on error
            this.update(); // Re-render to show error or empty state
        }
    }

    protected async loadSchemas(): Promise<void> {
        console.log("Starting loadSchemas");
        this.isLoading = true;
        this.schemas = [];

        try {
            // Use the EnvVariablesServer to get THEIA_CONFIG_DIR
            const theiaConfigDirResult: EnvVariableResult | undefined = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
            const theiaConfigDirPath = theiaConfigDirResult?.value;

            if (!theiaConfigDirPath) {
                 console.error("Could not determine THEIA_CONFIG_DIR for loading schemas using EnvVariablesServer.");
                 this.messageService.error("Could not determine THEIA_CONFIG_DIR.");
                 this.isLoading = false; // Stop loading indicator
                 this.update(); // Re-render to show error or empty state
                 return;
            }

            // Navigate up from THEIA_CONFIG_DIR to get the home directory
            const theiaConfigDirUri = new URI(theiaConfigDirPath);
            const homeDirUri = theiaConfigDirUri.parent;
            const homePath = homeDirUri.path.toString();

            console.log("Loading schemas from home path:", homePath);

            const homeDir = new URI(homePath);
            const schemasDir = homeDir.resolve('.aroma/metadata-schemas');
            const localDir = schemasDir.resolve('local');
            const remoteDir = schemasDir.resolve('remote');

            // Load local schemas
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
                            // Check if required fields exist
                            if (typeof schemaContent['schema:name'] !== 'string' || typeof schemaContent['pav:version'] !== 'string') {
                                console.warn(`Schema ${child.name} is missing required 'schema:name' or 'pav:version' field.`);
                                continue; // Skip schemas without the required fields
                            }
                        } catch (e) {
                            console.warn(`Could not parse JSON from ${child.name}:`, e);
                            continue; // Skip invalid JSON files
                        }
                        // Use the specific field names
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

            // Load remote schemas
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
                            // Check if required fields exist
                            if (typeof schemaContent['schema:name'] !== 'string' || typeof schemaContent['pav:version'] !== 'string') {
                                console.warn(`Schema ${child.name} is missing required 'schema:name' or 'pav:version' field.`);
                                continue; // Skip schemas without the required fields
                            }
                        } catch (e) {
                            console.warn(`Could not parse JSON from ${child.name}:`, e);
                            continue; // Skip invalid JSON files
                        }
                        // Use the specific field names
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
            this.update(); // Trigger a re-render
        }
    }

    protected async importSchemaFromFile(): Promise<void> {
        try {
            // Use the EnvVariablesServer to get THEIA_CONFIG_DIR
            const theiaConfigDirResult: EnvVariableResult | undefined = await this.envVariablesServer.getValue('THEIA_CONFIG_DIR');
            const theiaConfigDirPath = theiaConfigDirResult?.value;

            if (!theiaConfigDirPath) {
                 console.error("Could not determine THEIA_CONFIG_DIR for importing schema using EnvVariablesServer.");
                 this.messageService.error("Could not determine THEIA_CONFIG_DIR.");
                 return;
            }

            // Navigate up from THEIA_CONFIG_DIR to get the home directory
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
                // Read the selected file
                const fileContent = await this.fileService.read(fileUri);

                // Get the filename
                const fileName = fileUri.path.base;

                // Copy to local schemas directory
                const targetUri = localDirUri.resolve(fileName);

                // Check if file already exists
                if (await this.fileService.exists(targetUri)) {
                    const overwrite = confirm(`File ${fileName} already exists. Do you want to overwrite it?`);
                    if (!overwrite) {
                        return;
                    }
                }

                await this.fileService.write(targetUri, fileContent.value);
                this.messageService.info(`Schema ${fileName} imported successfully!`);

                // Reload schemas to show the new one
                await this.loadSchemas();
            }
        } catch (error) {
            console.error('Error importing schema from file:', error);
            this.messageService.error(`Error importing schema: ${error}`);
        }
    }

    protected async importSchemaFromUrl(): Promise<void> {
        console.log('Import schema from URL button clicked');
        // Placeholder implementation
        this.messageService.info('Import from URL feature is not yet implemented');
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        console.log("onActivateRequest called");
        this.update();
    }

    // Override onAfterAttach to ensure the node is ready before rendering
    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // Initial render after the widget's DOM node is attached
        this.render();
    }

    // Override onUpdateRequest to re-render when data changes
    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        console.log("onUpdateRequest called, re-rendering");
        this.render();
    }

    // New method to handle the React rendering directly into the widget's node
    protected render(): void {
        console.log("Rendering Metadata Schema Manager Widget, isLoading:", this.isLoading, "schemas:", this.schemas.length);

        // Create the React component structure
        const component = React.createElement('div', { className: 'metadata-schema-manager-container', style: { padding: '20px', backgroundColor: '#f5f5f5' } }, [
            React.createElement('div', { key: 'controls', className: 'metadata-schema-controls', style: { marginBottom: '10px' } }, [
                React.createElement('button', {
                    key: 'import-file',
                    className: 'theia-button',
                    onClick: () => this.importSchemaFromFile(),
                    style: { marginRight: '10px' }
                }, 'Import Schema from File'),
                React.createElement('button', {
                    key: 'import-url',
                    className: 'theia-button secondary',
                    onClick: () => this.importSchemaFromUrl()
                }, 'Import Schema from URL')
            ]),
            React.createElement('div', { key: 'table-container', className: 'metadata-schema-table-container' }, [
                React.createElement('table', {
                    key: 'schema-table',
                    className: 'theia-DataGrid',
                    style: { width: '100%', borderCollapse: 'collapse', border: '1px solid #ccc' }
                }, [
                    React.createElement('thead', { key: 'thead' }, [
                        React.createElement('tr', { key: 'header-row', style: { backgroundColor: '#e9e9e9' } }, [
                            React.createElement('th', { key: 'name-header', style: { padding: '8px', border: '1px solid #ccc' } }, 'Schema Name'),
                            React.createElement('th', { key: 'source-header', style: { padding: '8px', border: '1px solid #ccc' } }, 'Source'),
                            React.createElement('th', { key: 'version-header', style: { padding: '8px', border: '1px solid #ccc' } }, 'Version')
                        ])
                    ]),
                    React.createElement('tbody', { key: 'tbody' }, [
                        // Show loading message or no data message or actual rows
                        this.isLoading ? (
                            React.createElement('tr', { key: 'loading-row' }, [
                                React.createElement('td', { key: 'loading-cell', colSpan: 3, style: { padding: '8px', textAlign: 'center', border: '1px solid #ccc' } }, 'Loading schemas...')
                            ])
                        ) : this.schemas.length === 0 ? (
                            React.createElement('tr', { key: 'no-data-row' }, [
                                React.createElement('td', { key: 'no-data-cell', colSpan: 3, style: { padding: '8px', textAlign: 'center', border: '1px solid #ccc' } }, 'No schemas found')
                            ])
                        ) : (
                            this.schemas.map((schema, index) =>
                                React.createElement('tr', { key: index }, [
                                    React.createElement('td', { key: `name-${index}`, style: { padding: '8px', border: '1px solid #ccc' } }, schema.name),
                                    React.createElement('td', { key: `source-${index}`, style: { padding: '8px', border: '1px solid #ccc' } },
                                        React.createElement('span', {
                                            style: {
                                                color: schema.source === 'local' ? '#28a745' : '#007bff',
                                                fontWeight: 'bold'
                                            }
                                        }, schema.source.charAt(0).toUpperCase() + schema.source.slice(1))
                                    ),
                                    React.createElement('td', { key: `version-${index}`, style: { padding: '8px', border: '1px solid #ccc' } }, schema.version)
                                ])
                            )
                        )
                    ])
                ])
            ])
        ]);

        // Render the component into the widget's DOM node
        // This uses the older ReactDOM.render, which is compatible with older React versions
        // If Theia 1.65.2 uses React 18+, we might need to use createRoot instead
        const ReactDOM = require('react-dom'); // Dynamically require ReactDOM
        ReactDOM.render(component, this.node); // Render directly into the widget's node
    }

    // Override onBeforeDetach to cleanup React rendering if necessary
    protected onBeforeDetach(msg: Message): void {
        const ReactDOM = require('react-dom');
        ReactDOM.unmountComponentAtNode(this.node); // Clean up React rendering
        super.onBeforeDetach(msg);
    }

    storeState(): object {
        return {};
    }

    restoreState(oldState: object): void {
        // No state to restore
    }
}