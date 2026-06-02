import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { CircularProgress } from '@mui/material';

import { DataverseCollectionService } from '../services/dataverse-collection-service';
import DataverseTree from './dataverse-tree';
import { DataRepositoryConfig, DataverseCollection, DataverseCollectionSelection } from '../types';
import '../styles/dataverse-collection-browser-dialog.css';

export class DataverseCollectionBrowserDialog extends AbstractDialog<DataverseCollectionSelection | undefined> {

    private reactRoot: Root | undefined;
    private selection: DataverseCollectionSelection | undefined;

    constructor(
        private readonly repository: DataRepositoryConfig,
        private readonly collectionService: DataverseCollectionService,
        private readonly supportsArpRoCrateZipUpload: boolean
    ) {
        super({
            title: `Browse ${repository.title}`
        });

        this.contentNode.style.width = '600px';
        this.contentNode.style.height = '550px';
        this.contentNode.style.padding = '0';

        this.appendCloseButton();
        this.appendAcceptButton('Select');
    }

    get value(): DataverseCollectionSelection | undefined {
        return this.selection;
    }

    protected handleSelectionChanged(value: DataverseCollectionSelection) {
        this.selection = value;
        this.update();
    }

    protected isValid(value: DataverseCollectionSelection | undefined): boolean {
        return !!value?.collection
            && value.collection.isWritable !== false
            && (this.supportsArpRoCrateZipUpload || !!value.metadataLanguage);
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <BrowserContent
                repository={this.repository}
                collectionService={this.collectionService}
                supportsArpRoCrateZipUpload={this.supportsArpRoCrateZipUpload}
                onSelectionChanged={(selection) => this.handleSelectionChanged(selection)}
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
    supportsArpRoCrateZipUpload: boolean;
    onSelectionChanged: (selection: DataverseCollectionSelection) => void;
}

const BrowserContent: React.FC<BrowserContentProps> = ({
    repository,
    collectionService,
    supportsArpRoCrateZipUpload,
    onSelectionChanged
}) => {
    const [roleIds, setRoleIds] = React.useState<string[]>([]);
    const [selectedCollection, setSelectedCollection] = React.useState<DataverseCollection | null>(null);
    const [metadataLanguage, setMetadataLanguage] = React.useState<'' | DataverseCollectionSelection['metadataLanguage']>('');
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
        onSelectionChanged({ collection, metadataLanguage: metadataLanguage || undefined });
    };

    const handleMetadataLanguageChanged = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const language = event.target.value as '' | NonNullable<DataverseCollectionSelection['metadataLanguage']>;
        setMetadataLanguage(language);
        if (selectedCollection) {
            onSelectionChanged({ collection: selectedCollection, metadataLanguage: language || undefined });
        }
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

            {!supportsArpRoCrateZipUpload && (
                <div className="dataverse-browser-dialog__selection-info">
                    <label className="dataverse-browser-dialog__language-label" htmlFor="dataverse-metadata-language">
                        Dataset language
                    </label>
                    <select
                        id="dataverse-metadata-language"
                        className="theia-select dataverse-browser-dialog__language-select"
                        value={metadataLanguage}
                        onChange={handleMetadataLanguageChanged}
                    >
                        <option value="">None</option>
                        <option value="hu">Hungarian</option>
                        <option value="en">English</option>
                    </select>
                </div>
            )}
        </div>
    );
};
