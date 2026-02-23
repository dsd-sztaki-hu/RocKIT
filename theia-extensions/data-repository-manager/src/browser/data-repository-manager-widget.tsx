import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { inject, injectable } from 'inversify';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { DataRepositoryToolbar } from './components/data-repository-toolbar';
import { DataRepositoryTable } from './components/data-repository-table';
import { DataRepositoryConfigDialog } from './components/data-repository-config-dialog';
import { DataRepositoryStoreService } from './services/data-repository-store-service';
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

    constructor(
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(DataRepositoryStoreService) protected readonly storeService: DataRepositoryStoreService
    ) {
        super();
        this.id = DATA_REPOSITORY_MANAGER_WIDGET_ID;
        this.title.label = DATA_REPOSITORY_MANAGER_LABEL;
        this.title.caption = DATA_REPOSITORY_MANAGER_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-database'; 
    }

    protected async loadData() {
        this.isLoading = true;
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

    protected handleImport = () => {
        this.messageService.info("Import placeholder clicked!", { timeout: 5000 });
    }

    protected handleExport = () => {
        this.messageService.info("Export placeholder clicked!", { timeout: 5000 });
    }

    protected handleAddRepository = async () => {
        const dialog = new DataRepositoryConfigDialog();
        const newConfig = await dialog.open();

        if (newConfig) {
            const updatedList = [...this.repositories, newConfig];
            await this.storeService.saveRepositories(updatedList);
            await this.loadData();
        }
    }

    protected handleEdit = async (repoToEdit: DataRepositoryConfig) => {
        const dialog = new DataRepositoryConfigDialog(repoToEdit);
        const updatedConfig = await dialog.open();

        if (updatedConfig) {
            const updatedList = this.repositories.map(repo => 
                repo.id === updatedConfig.id ? updatedConfig : repo
            );
            await this.storeService.saveRepositories(updatedList);
            await this.loadData();
        }
    }

    protected handleDelete = async (id: string) => {
        const updatedList = this.repositories.filter(repo => repo.id !== id);
        await this.storeService.saveRepositories(updatedList);
        await this.loadData();
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
                />
                <DataRepositoryTable 
                    repositories={this.repositories} 
                    isLoading={this.isLoading} 
                    onDelete={this.handleDelete}
                    onEdit={this.handleEdit}
                />
            </div>
        );
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }

    storeState(): object { return {}; }
    restoreState(): void { }
}