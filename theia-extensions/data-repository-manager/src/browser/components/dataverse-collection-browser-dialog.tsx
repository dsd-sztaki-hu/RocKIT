import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { IconButton, Tooltip, CircularProgress } from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';

import { DataverseCollectionService } from '../services/dataverse-collection-service';
import DataverseTree from './dataverse-tree';
import { DataRepositoryConfig, DataverseCollection } from '../types';
import '../styles/dataverse-collection-browser-dialog.css';

export class DataverseCollectionBrowserDialog extends AbstractDialog<DataverseCollection | undefined> {

    private reactRoot: Root | undefined;
    private result: DataverseCollection | undefined;

    constructor(
        private readonly repository: DataRepositoryConfig,
        private readonly collectionService: DataverseCollectionService
    ) {
        super({
            title: `Browse ${repository.title}`
        });

        this.contentNode.style.width = '600px';
        this.contentNode.style.height = '550px';
        this.contentNode.style.padding = '0';
    }

    get value(): DataverseCollection | undefined {
        return this.result;
    }

    protected handleAccept(value: DataverseCollection) {
        this.result = value;
        this.accept();
    }

    protected handleClose() {
        this.close();
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <BrowserContent
                repository={this.repository}
                collectionService={this.collectionService}
                onAccept={(collection) => this.handleAccept(collection)}
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
    repository: DataRepositoryConfig;
    collectionService: DataverseCollectionService;
    onAccept: (collection: DataverseCollection) => void;
    onCancel: () => void;
}

const BrowserContent: React.FC<BrowserContentProps> = ({
    repository,
    collectionService,
    onAccept,
    onCancel
}) => {
    const [roleIds, setRoleIds] = React.useState<string[]>([]);
    const [selectedCollection, setSelectedCollection] = React.useState<DataverseCollection | null>(null);
    const [isLoadingRoles, setIsLoadingRoles] = React.useState(true);

    React.useEffect(() => {
        collectionService.initClient(repository.baseUrl, repository.apiKey || '');
        
        collectionService.getSelectableRoles().then(roles => {
            setRoleIds(roles.map(r => r.id.toString()));
            setIsLoadingRoles(false);
        }).catch(err => {
            console.error('Failed to fetch roles', err);
            setIsLoadingRoles(false);
        });
    }, [repository, collectionService]);

    const handleCollectionSelected = (collection: DataverseCollection) => {
        setSelectedCollection(collection);
    };

    const handleDeselect = () => {
        setSelectedCollection(null);
    };

    return (
        <div className="dataverse-browser-dialog">
            <div className="dataverse-browser-dialog__tree-container">
                {!isLoadingRoles ? (
                    <DataverseTree
                        collectionService={collectionService}
                        roleIds={roleIds}
                        selectedCollectionId={selectedCollection?.id}
                        onCollectionSelected={handleCollectionSelected}
                    />
                ) : (
                    <div className="dataverse-browser-dialog__loading">
                        <CircularProgress size={24} style={{ marginBottom: 10 }} />
                        <span>Initializing connection...</span>
                    </div>
                )}
            </div>

            <div className="dataverse-browser-dialog__footer">
                <div className="dataverse-browser-dialog__selection-info">
                    {selectedCollection ? (
                        <>
                            <div className="dataverse-browser-dialog__controls">
                                <Tooltip title="Deselect">
                                    <IconButton size="small" onClick={handleDeselect} style={{ padding: 2, color: 'var(--theia-errorForeground)' }}>
                                        <CancelIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </div>
                            <span className="dataverse-browser-dialog__selected-name">
                                {selectedCollection.name} {selectedCollection.isWritable === false && '(No Write Access)'}
                            </span>
                        </>
                    ) : (
                        <span className="dataverse-browser-dialog__placeholder">
                            Select a destination collection...
                        </span>
                    )}
                </div>

                <div className="dataverse-browser-dialog__actions">
                    <button
                        className="theia-button secondary dataverse-browser-dialog__btn-cancel"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        className="theia-button main dataverse-browser-dialog__btn-select"
                        onClick={() => selectedCollection && onAccept(selectedCollection)}
                        disabled={!selectedCollection || selectedCollection.isWritable === false}
                    >
                        Select
                    </button>
                </div>
            </div>
        </div>
    );
};
