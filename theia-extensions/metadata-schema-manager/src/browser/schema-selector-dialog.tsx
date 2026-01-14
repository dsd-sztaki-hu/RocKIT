import { injectable, inject } from 'inversify';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Modal, Button } from 'antd';
import type { Key } from 'antd/es/table/interface';

import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { SchemaManagerService } from './metadata-schema-manager-service';
import { SchemaTable } from './schema-table';
import type { SchemaInfo } from './types';

@injectable()
export class SchemaSelectorDialogContribution implements FrontendApplicationContribution {

    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(SchemaManagerService) protected readonly schemaManagerService!: SchemaManagerService;

    private container: HTMLDivElement | null = null;
    private reactRoot: ReactDOM.Root | null = null;

    // FIX: Use onStart() instead of @postConstruct to satisfy the interface
    onStart(): void {
        // Create a detached container for our React Portal/Root
        this.container = document.createElement('div');
        this.container.id = 'schema-selector-dialog-container';
        document.body.appendChild(this.container);
        
        this.reactRoot = ReactDOM.createRoot(this.container);
        
        // Initial Render
        this.render();

        // Re-render whenever relevant app state changes
        this.appStateService.onDidChangeSelector(state => state.openSchemaSelectorWindow)(
            () => this.render()
        );
    }

    protected render(): void {
        if (!this.reactRoot) return;

        // Get visibility from App State
        const isOpen = this.appStateService.getState().openSchemaSelectorWindow || false;

        this.reactRoot.render(
            <SchemaSelector 
                isOpen={isOpen}
                appStateService={this.appStateService}
                schemaManagerService={this.schemaManagerService}
            />
        );
    }
}

interface SelectorProps {
    isOpen: boolean;
    appStateService: AppStateService;
    schemaManagerService: SchemaManagerService;
}

const SchemaSelector: React.FC<SelectorProps> = ({ isOpen, appStateService, schemaManagerService }) => {
    const [schemas, setSchemas] = React.useState<SchemaInfo[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedKey, setSelectedKey] = React.useState<Key | null>(null);
    const [selectedSchema, setSelectedSchema] = React.useState<SchemaInfo | null>(null);

    // Load schemas when opened
    React.useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            setSelectedKey(null); // Reset selection
            setSelectedSchema(null);
            
            schemaManagerService.loadAllSchemas()
                .then(data => setSchemas(data))
                .catch(err => console.error(err))
                .finally(() => setIsLoading(false));
        }
    }, [isOpen, schemaManagerService]);

    const handleCancel = () => {
        // Close window via App State
        appStateService.updateState({ openSchemaSelectorWindow: false });
    };

    const handleAssociate = async (schema: SchemaInfo) => {
        try {
            setIsLoading(true);
            
            // 1. Get the converted JSON content
            const profileContent = await schemaManagerService.getConvertedProfileContent(schema.path);
            
            // 2. Set 'profile' in App State
            appStateService.updateState({ 
                profile: profileContent,
                openSchemaSelectorWindow: false 
            });

        } catch (error) {
            console.error('Failed to associate schema:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const onOk = () => {
        if (selectedSchema) {
            handleAssociate(selectedSchema);
        }
    };

    const onSelectionChange = (keys: Key[]) => {
        if (keys.length > 0) {
            const key = keys[0];
            setSelectedKey(key);
            const found = schemas.find(s => s.path === key);
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
                <Button key="cancel" onClick={handleCancel}>
                    Cancel
                </Button>,
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
            <div style={{ height: '500px', overflow: 'auto' }}>
                <SchemaTable
                    schemas={schemas}
                    isLoading={isLoading}
                    selectionType="radio"
                    onSelectionChange={onSelectionChange}
                    onRowDoubleClick={(record) => handleAssociate(record)}
                />
            </div>
        </Modal>
    );
};