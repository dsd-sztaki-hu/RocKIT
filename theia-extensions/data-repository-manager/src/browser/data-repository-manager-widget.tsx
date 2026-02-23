import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { inject, injectable } from 'inversify';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { DataRepositoryToolbar } from './components/data-repository-toolbar';
import { DataRepositoryTable } from './components/data-repository-table';
import { DataRepositoryConfig } from './types';
import './styles/index.css';

export const DATA_REPOSITORY_MANAGER_WIDGET_ID = 'data-repository-manager:widget';
export const DATA_REPOSITORY_MANAGER_LABEL = 'Data Repository Manager';

@injectable()
export class DataRepositoryManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = DATA_REPOSITORY_MANAGER_WIDGET_ID;
    static readonly LABEL = DATA_REPOSITORY_MANAGER_LABEL;

    private reactRoot: Root | undefined;
    
    // Starting with an empty array
    protected repositories: DataRepositoryConfig[] = [];
    protected isLoading = false;

    constructor(
        @inject(MessageService) protected readonly messageService: MessageService
    ) {
        super();
        this.id = DATA_REPOSITORY_MANAGER_WIDGET_ID;
        this.title.label = DATA_REPOSITORY_MANAGER_LABEL;
        this.title.caption = DATA_REPOSITORY_MANAGER_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-database'; 
    }

    protected handleImport = () => {
        this.messageService.info("Import placeholder clicked!");
    }

    protected handleExport = () => {
        this.messageService.info("Export placeholder clicked!");
    }

    protected handleConfigure = () => {
        this.messageService.info("Configure Repositories placeholder clicked!");
    }

    protected handleDelete = (id: string) => {
        this.messageService.info(`Delete placeholder clicked for repo ID: ${id}`);
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.node.innerHTML = ''; // Clean slate for React 18
        this.render();
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
                    onConfigure={this.handleConfigure}
                />
                <DataRepositoryTable 
                    repositories={this.repositories} 
                    isLoading={this.isLoading} 
                    onDelete={this.handleDelete}
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