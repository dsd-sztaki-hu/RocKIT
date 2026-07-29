import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import { nls } from '@theia/core/lib/common/nls';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { DataverseCollectionService } from '../services/dataverse-collection-service';
import DataverseTree from './dataverse-tree';
import { DataRepositoryConfig, DataverseCollection, DataverseCollectionSelection } from '../types';
import '../styles/dataverse-collection-browser-dialog.css';

export class DataverseCollectionBrowserDialog extends AbstractDialog<DataverseCollectionSelection | undefined> {

    private reactRoot: Root | undefined;
    private selection: DataverseCollectionSelection | undefined;

    constructor(
        private readonly repository: DataRepositoryConfig,
        private readonly collectionService: DataverseCollectionService
    ) {
        super({
            title: nls.localize('rockit/dataRepository/browseRepository', 'Browse {0}', repository.title)
        });

        this.contentNode.style.width = '600px';
        this.contentNode.style.height = '550px';
        this.contentNode.style.padding = '0';

        this.appendCloseButton();
        this.appendAcceptButton(nls.localize('rockit/dataRepository/select', 'Select'));
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
            && value.collection.isWritable !== false;
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <BrowserContent
                repository={this.repository}
                collectionService={this.collectionService}
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
    onSelectionChanged: (selection: DataverseCollectionSelection) => void;
}

const BrowserContent: React.FC<BrowserContentProps> = ({
    repository,
    collectionService,
    onSelectionChanged
}) => {
    const [selectedCollection, setSelectedCollection] = React.useState<DataverseCollection | null>(null);
    const [isClientReady, setIsClientReady] = React.useState(false);

    React.useEffect(() => {
        setIsClientReady(false);
        collectionService.initClient(repository.baseUrl, repository.apiKey || '');
        setIsClientReady(true);
    }, [repository, collectionService]);

    const handleCollectionSelected = (collection: DataverseCollection) => {
        setSelectedCollection(collection);
        onSelectionChanged({ collection });
    };

    return (
        <div className="dataverse-browser-dialog">
            <div className="dataverse-browser-dialog__tree-container">
                {isClientReady && (
                    <DataverseTree
                        collectionService={collectionService}
                        selectedCollectionId={selectedCollection?.id}
                        onCollectionSelected={handleCollectionSelected}
                    />
                )}
            </div>

        </div>
    );
};
