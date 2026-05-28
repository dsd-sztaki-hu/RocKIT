import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { inject, injectable } from 'inversify';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { DataRepositoryToolbar } from './components/data-repository-toolbar';
import { DataRepositoryTable } from './components/data-repository-table';
import { DataRepositoryConfigDialog } from './components/data-repository-config-dialog';
import { DataRepositoryDeleteDialog } from './components/data-repository-delete-dialog';
import { DataRepositorySelectorDialog } from './components/data-repository-selector-dialog';
import { DataverseCollectionBrowserDialog } from './components/dataverse-collection-browser-dialog';
import { DataRepositoryStoreService } from './services/data-repository-store-service';
import { DataverseService } from './services/dataverse-service';
import { DataverseCollectionService } from './services/dataverse-collection-service';
import { DataRepositoryConfig } from './types';
import './styles/index.css';

export const DATA_REPOSITORY_MANAGER_WIDGET_ID = 'data-repository-manager:widget';
export const DATA_REPOSITORY_MANAGER_LABEL = 'Data Repository Manager';

@injectable()
export class DataRepositoryManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = DATA_REPOSITORY_MANAGER_WIDGET_ID;
    static readonly LABEL = DATA_REPOSITORY_MANAGER_LABEL;

    private reactRoot: Root | undefined;
    protected repositories: DataRepositoryConfig[] = [];
    protected isLoading = true;
    protected selectedKeys: React.Key[] = [];
    protected readonly disposables = new DisposableCollection();

    constructor(
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(DataRepositoryStoreService) protected readonly storeService: DataRepositoryStoreService,
        @inject(DataverseService) protected readonly dataverseService: DataverseService,
        @inject(DataverseCollectionService) protected readonly collectionService: DataverseCollectionService
    ) {
        super();
        this.id = DATA_REPOSITORY_MANAGER_WIDGET_ID;
        this.title.label = DATA_REPOSITORY_MANAGER_LABEL;
        this.title.caption = DATA_REPOSITORY_MANAGER_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-database';

        this.disposables.push(this.storeService.onDidChange(() => this.loadData()));
    }

    protected async loadData() {
        this.isLoading = true;
        this.selectedKeys = []; // Reset selection on load
        this.update();
        try {
            this.repositories = await this.storeService.loadRepositories();
        } catch (e) {
            console.error(e);
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected handleSelectionChange = (keys: React.Key[]) => {
        this.selectedKeys = keys;
        this.update(); // Trigger React re-render
    }

    protected handleImport = () => {
        this.messageService.info("Import placeholder clicked!", { timeout: 5000 });
    }

    protected handleExport = () => {
        this.handleExportToRemote();
    }

    public async handleExportToRemote(): Promise<void> {
        const repositories = await this.storeService.loadRepositories();
        this.repositories = repositories;
        this.update();

        // Show repository selector first, matching the UX requested.
        const selector = new DataRepositorySelectorDialog(repositories, this.storeService, this.dataverseService);
        const selectedRepo = await selector.open();

        if (!selectedRepo) {
            return; // User cancelled
        }

        if (selectedRepo.type !== 'ARP Dataverse') {
            this.messageService.error(`Export to '${selectedRepo.type}' is not supported yet.`);
            return;
        }

        const dialog = new DataverseCollectionBrowserDialog(selectedRepo, this.collectionService);
        const result = await dialog.open();

        if (result) {
            this.messageService.info(`Destination selected: ${result.name}. Export functionality will be available soon.`);
            // Store the selection in widget state for future upload implementation
            console.log('User selected destination for export:', result, 'on repository:', selectedRepo);
        }
    }

    protected handleAddRepository = async () => {
        const dialog = new DataRepositoryConfigDialog(this.dataverseService);
        const result = await dialog.open();
        if (result) {
            await this.storeService.saveRepository(result);
        }
    }

    protected handleEdit = async (repo: DataRepositoryConfig) => {
        const dialog = new DataRepositoryConfigDialog(this.dataverseService, repo);
        const result = await dialog.open();
        if (result) {
            await this.storeService.saveRepository(result);
        }
    }

    // Handles single item deletion from the Action column
    protected handleDelete = async (repo: DataRepositoryConfig) => {
        const dialog = new DataRepositoryDeleteDialog(repo.title);
        const confirmed = await dialog.open();
        if (confirmed) {
            await this.storeService.deleteRepositories([repo.id]);
        }
    }

    // Handles bulk deletion from the Toolbar
    protected handleDeleteSelected = async () => {
        const count = this.selectedKeys.length;
        if (count === 0) return;

        const dialog = new DataRepositoryDeleteDialog(`${count} selected repositories`);
        const confirmed = await dialog.open();
        if (confirmed) {
            await this.storeService.deleteRepositories(this.selectedKeys.map(k => k.toString()));
            this.selectedKeys = [];
        }
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.node.innerHTML = ''; 
        this.render();
        this.loadData(); 
    }

    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        this.render();
    }

    protected render(): void {
        if (!this.isAttached) return;

        this.node.classList.add('data-repository-manager-widget');
        
        if (!this.reactRoot) {
             this.reactRoot = createRoot(this.node);
        }

        this.reactRoot.render(
            <div className="data-repo-layout-container">
                <DataRepositoryToolbar 
                    onImport={this.handleImport}
                    onExport={this.handleExport}
                    onConfigure={this.handleAddRepository}
                    selectedCount={this.selectedKeys.length}       // NEW
                    onDeleteSelected={this.handleDeleteSelected} // NEW
                />
                <DataRepositoryTable 
                    repositories={this.repositories} 
                    isLoading={this.isLoading} 
                    onDelete={this.handleDelete}
                    onEdit={this.handleEdit}
                    selectedKeys={this.selectedKeys}             // NEW
                    onSelectionChange={this.handleSelectionChange} // NEW
                />
            </div>
        );
    }

    protected onBeforeDetach(msg: Message): void {
        this.disposables.dispose();
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }

    storeState(): object { return {}; }
    restoreState(): void { }
}
