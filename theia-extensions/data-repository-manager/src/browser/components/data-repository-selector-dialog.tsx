import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';
import DatasetIcon from '@mui/icons-material/Dataset';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import EditIcon from '@mui/icons-material/Edit';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import {
    DataRepositoryConfig,
    DataRepositoryExportTarget,
    DataRepositorySelection,
    RepositorySyncMode
} from '../types';
import { DataRepositoryConfigDialog } from './data-repository-config-dialog';
import { DataRepositoryStoreService } from '../services/data-repository-store-service';
import { DataverseService } from '../services/dataverse-service';
import { DataverseCapabilityService } from '../services/dataverse-capability-service';
import '../styles/data-repository-selector-dialog.css';
import { nls } from '@theia/core/lib/common/nls';
import { ExportDeleteAction } from './data-repository-export-delete-dialog';

export type DeleteExportTargetHandler = (
    repository: DataRepositoryConfig,
    target: DataRepositoryExportTarget,
    action: ExportDeleteAction
) => Promise<boolean>;

export class DataRepositorySelectorDialog extends AbstractDialog<DataRepositorySelection | undefined> {

    private reactRoot: Root | undefined;
    private result: DataRepositorySelection | undefined;
    private openSyncMenuKey: string | undefined;
    private openDeleteMenuKey: string | undefined;
    private syncMenuOpensUpward = false;
    private deleteMenuOpensUpward = false;

    constructor(
        private repositories: DataRepositoryConfig[],
        private readonly storeService: DataRepositoryStoreService,
        private readonly dataverseService: DataverseService,
        private readonly capabilityService: DataverseCapabilityService,
        private readonly hasWorkspace: boolean = true,
        private readonly exportTargetsByRepositoryId: Record<string, DataRepositoryExportTarget[]> = {},
        private readonly onShowRecentValidationResponse?: () => void,
        private readonly onDeleteExportTarget?: DeleteExportTargetHandler
    ) {
        super({
            title: nls.localize('rockit/dataRepository/selectRepository', 'Select Data Repository')
        });

        this.contentNode.style.width = '720px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.height = '560px';
        this.contentNode.style.maxHeight = '85vh';
        this.contentNode.style.padding = '0';

        if (this.onShowRecentValidationResponse) {
            const validationButton = this.appendButton(nls.localize('rockit/dataRepository/lastValidationError', 'Last Validation Error'), false);
            validationButton.classList.add('data-repo-selector__validation-error-button');
            validationButton.addEventListener('click', () => this.onShowRecentValidationResponse?.());
        }
        const linkButton = this.appendButton(nls.localize('rockit/dataRepository/linkToRemoteShort', 'Link to Remote'), false);
        linkButton.classList.add('data-repo-selector__link-button');
        linkButton.disabled = !this.hasWorkspace;
        if (!this.hasWorkspace) {
            linkButton.title = nls.localize(
                'rockit/dataRepository/workspaceRequiredForExportOrLink',
                'Open a workspace before exporting or linking a local dataset.'
            );
        }
        linkButton.addEventListener('click', () => this.handleLinkLocalToRemote());
        const addButton = this.appendButton(nls.localize('rockit/dataRepository/addRepository', 'Add Repository'), true);
        addButton.addEventListener('click', () => void this.handleAddRepository());
        const cancelButton = this.appendCloseButton();
        cancelButton.classList.add('data-repo-selector__cancel-button');

        // Automatically refresh list when store changes
        const listener = this.storeService.onDidChange(() => this.loadRepositories());
        this.toDispose.push(listener);
    }

    get value(): DataRepositorySelection | undefined {
        return this.result;
    }

    protected async loadRepositories() {
        try {
            this.repositories = await this.storeService.loadRepositories();
            this.render();
        } catch (error) {
            console.error("Failed to load repositories:", error);
        }
    }

    protected async handleSelect(
        repo: DataRepositoryConfig,
        exportTarget?: DataRepositoryExportTarget,
        action: 'export' | 'sync' | 'import' = 'export',
        syncMode?: RepositorySyncMode
    ) {
        const capabilities = await this.capabilityService.detectRepositoryCapabilities(repo.baseUrl, repo.apiKey);
        this.result = { repository: repo, capabilities, exportTarget, action, syncMode };
        this.accept();
    }

    protected handleLinkLocalToRemote(): void {
        this.result = { action: 'link' };
        this.accept();
    }

    protected async handleAddRepository() {
        const dialog = new DataRepositoryConfigDialog(this.dataverseService);
        const result = await dialog.open();
        if (result) {
            await this.storeService.saveRepository(result);
        }
    }

    protected async handleEditRepository(repo: DataRepositoryConfig) {
        const dialog = new DataRepositoryConfigDialog(this.dataverseService, repo);
        const result = await dialog.open();
        if (result) {
            await this.storeService.saveRepository(result);
        }
    }

    protected showExportError(target: DataRepositoryExportTarget): void {
        const dialog = new ConfirmDialog({
            title: nls.localize('rockit/dataRepository/exportErrorDetails', 'Export error details'),
            msg: target.errorMessage || nls.localize(
                'rockit/dataRepository/noErrorDetailsAvailable',
                'No error details are available.'
            ),
        });
        void dialog.open();
    }

    protected async handleDeleteExport(
        repo: DataRepositoryConfig,
        target: DataRepositoryExportTarget,
        action: ExportDeleteAction
    ): Promise<void> {
        this.openDeleteMenuKey = undefined;
        this.deleteMenuOpensUpward = false;
        this.render();
        if (await this.onDeleteExportTarget?.(repo, target, action)) {
            this.exportTargetsByRepositoryId[repo.id] =
                (this.exportTargetsByRepositoryId[repo.id] ?? []).filter(candidate =>
                    candidate.mappingFile !== target.mappingFile
                );
            this.render();
        }
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div
                className="data-repo-selector"
                onClick={() => {
                    if (this.openSyncMenuKey) {
                        this.openSyncMenuKey = undefined;
                        this.syncMenuOpensUpward = false;
                        this.render();
                    }
                    if (this.openDeleteMenuKey) {
                        this.openDeleteMenuKey = undefined;
                        this.deleteMenuOpensUpward = false;
                        this.render();
                    }
                }}
            >
                <div className="data-repo-selector__content">
                    <div className="data-repo-selector__header">
                        <div className="data-repo-selector__icon-wrapper">
                            <DnsIcon className="data-repo-selector__header-icon" />
                        </div>
                        <div>
                            <div className="data-repo-selector__title">{nls.localize('rockit/dataRepository/chooseRepository', 'Choose Repository')}</div>
                            <div className="data-repo-selector__description">
                                {nls.localize('rockit/dataRepository/chooseRepositoryDescription', 'Select a remote repository to browse collections.')}
                            </div>
                        </div>
                    </div>

                    <div className="data-repo-selector__body">
                        {this.repositories.length === 0 ? (
                            <div className="data-repo-selector__state-msg">
                                <div className="data-repo-selector__empty-box">
                                    <StorageIcon className="data-repo-selector__empty-icon" />
                                    <div className="data-repo-selector__empty-title">{nls.localize('rockit/dataRepository/noRepositoriesFound', 'No Repositories Found')}</div>
                                    <p className="data-repo-selector__empty-desc">
                                        {nls.localize('rockit/dataRepository/noRepositoriesConfigured', 'No data repositories have been configured yet.')}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            this.repositories.map(repo => this.renderRepository(repo))
                        )}
                    </div>
                </div>
            </div>
        );
    }

    protected renderRepository(repo: DataRepositoryConfig): React.ReactNode {
        const exportTargets = this.exportTargetsByRepositoryId[repo.id] ?? [];
        return (
            <div key={repo.id} className="data-repo-selector__repo-group">
                <div
                    className="data-repo-selector__item"
                    title={repo.baseUrl}
                >
                    <div className="data-repo-selector__item-content">
                        <div className="data-repo-selector__item-icon-box">
                            <StorageIcon className="data-repo-selector__item-icon" />
                        </div>
                        <div className="data-repo-selector__item-details">
                            <div className="data-repo-selector__item-title-row">
                                <div className="data-repo-selector__item-title">{repo.title}</div>
                                <button
                                    className="data-repo-selector__edit-repository"
                                    title={nls.localize('rockit/dataRepository/editRepository', 'Edit Repository')}
                                    aria-label={nls.localize(
                                        'rockit/dataRepository/editRepositoryNamed',
                                        'Edit repository {0}',
                                        repo.title
                                    )}
                                    onClick={event => {
                                        event.stopPropagation();
                                        void this.handleEditRepository(repo);
                                    }}
                                >
                                    <EditIcon />
                                </button>
                            </div>
                            <div className="data-repo-selector__item-url">{repo.baseUrl}</div>
                        </div>
                    </div>
                    <div
                        className="data-repo-selector__export-actions data-repo-selector__repo-actions"
                    >
                        <button
                            className="data-repo-selector__export-action"
                            title={nls.localize('rockit/dataRepository/importFromRemote', 'Import from remote')}
                            aria-label={nls.localize(
                                'rockit/dataRepository/importFromRepository',
                                'Import from {0}',
                                repo.title
                            )}
                            onClick={() => void this.handleSelect(repo, undefined, 'import')}
                        >
                            <FileDownloadOutlinedIcon className="data-repo-selector__export-update-icon" />
                        </button>
                        <button
                            className="data-repo-selector__export-action"
                            title={this.hasWorkspace
                                ? nls.localize('rockit/dataRepository/newExport', 'New export')
                                : nls.localize(
                                    'rockit/dataRepository/workspaceRequiredForExportOrLink',
                                    'Open a workspace before exporting or linking a local dataset.'
                                )}
                            aria-label={nls.localize(
                                'rockit/dataRepository/exportToRepository',
                                'Export to {0}',
                                repo.title
                            )}
                            disabled={!this.hasWorkspace}
                            onClick={() => void this.handleSelect(repo)}
                        >
                            <FileUploadOutlinedIcon className="data-repo-selector__export-update-icon" />
                        </button>
                    </div>
                </div>
                {exportTargets.length > 0 && (
                    <div className="data-repo-selector__exports">
                        {exportTargets.map(target => {
                            const menuKey = `${repo.id}:${target.mappingFile}`;
                            return (
                            <div
                                key={menuKey}
                                className="data-repo-selector__export-item"
                            >
                                <div className="data-repo-selector__export-icon-box">
                                    <DatasetIcon className="data-repo-selector__export-icon" />
                                </div>
                                <div className="data-repo-selector__export-details">
                                    <div className="data-repo-selector__export-title">
                                        {target.datasetName || target.pid}
                                    </div>
                                    <a
                                        className="data-repo-selector__export-url"
                                        href={target.target}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={target.target}
                                        onClick={event => event.stopPropagation()}
                                    >
                                        {this.formatTargetLinkLabel(target)}
                                    </a>
                                    <div className="data-repo-selector__export-meta">
                                        {target.lastSuccessfulActionAt
                                            ? nls.localize(
                                                'rockit/dataRepository/lastSuccessfullyModified',
                                                'Last successfully modified {0}',
                                                this.formatDate(target.lastSuccessfulActionAt)
                                            )
                                            : ''}
                                    </div>
                                    {(target.status === 'failed' || target.status === 'cancelled') && (
                                        <div className="data-repo-selector__export-failure-row">
                                            <span className="data-repo-selector__export-failure-status">
                                                {target.status === 'failed'
                                                    ? nls.localize('rockit/dataRepository/exportFailedStatus', 'Failed')
                                                    : nls.localize('rockit/dataRepository/exportCancelledStatus', 'Cancelled')}
                                            </span>
                                            {target.status === 'failed' && (
                                                <button
                                                    className="data-repo-selector__export-error-details"
                                                    title={nls.localize('rockit/dataRepository/showErrorDetails', 'Show error details')}
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        this.showExportError(target);
                                                    }}
                                                >
                                                    <ErrorOutlineIcon />
                                                    {nls.localize('rockit/dataRepository/details', 'Details')}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="data-repo-selector__export-actions">
                                    <div className="data-repo-selector__sync-control">
                                        <button
                                            className="data-repo-selector__export-action"
                                            title={nls.localize('rockit/dataRepository/syncOptions', 'Sync options')}
                                            aria-label={nls.localize(
                                                'rockit/dataRepository/syncOptionsFor',
                                                'Sync options for {0}',
                                                target.datasetName || target.pid
                                            )}
                                            aria-expanded={this.openSyncMenuKey === menuKey}
                                            onClick={event => {
                                                event.stopPropagation();
                                                if (this.openSyncMenuKey === menuKey) {
                                                    this.openSyncMenuKey = undefined;
                                                    this.syncMenuOpensUpward = false;
                                                } else {
                                                    this.openDeleteMenuKey = undefined;
                                                    this.deleteMenuOpensUpward = false;
                                                    this.syncMenuOpensUpward = this.shouldMenuOpenUpward(event.currentTarget, 184);
                                                    this.openSyncMenuKey = menuKey;
                                                }
                                                this.render();
                                            }}
                                        >
                                            <FileDownloadOutlinedIcon className="data-repo-selector__export-update-icon" />
                                        </button>
                                        {this.openSyncMenuKey === menuKey && (
                                            <div
                                                className={`data-repo-selector__options-menu data-repo-selector__sync-menu${
                                                    this.syncMenuOpensUpward ? ' data-repo-selector__options-menu--upward' : ''
                                                }`}
                                                role="menu"
                                                onClick={event => event.stopPropagation()}
                                            >
                                                {this.renderSyncMenuItem(repo, target, 'complete',
                                                    nls.localize('rockit/dataRepository/completeSync', 'Complete sync'),
                                                    nls.localize('rockit/dataRepository/completeSyncShort', 'Use remote metadata and structure'))}
                                                {this.renderSyncMenuItem(repo, target, 'remote-additions',
                                                    nls.localize('rockit/dataRepository/keepRemoteAdditions', 'Download remote additions'),
                                                    nls.localize('rockit/dataRepository/keepRemoteAdditionsShort', 'Keep local edits, add remote entities'))}
                                                {this.renderSyncMenuItem(repo, target, 'local-additions',
                                                    nls.localize('rockit/dataRepository/keepLocalAdditions', 'Keep only local additions'),
                                                    nls.localize('rockit/dataRepository/keepLocalAdditionsShort', 'Use remote edits, retain new local entities'))}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        className="data-repo-selector__export-action"
                                        title={nls.localize('rockit/dataRepository/uploadUpdates', 'Upload updates')}
                                        aria-label={nls.localize(
                                            'rockit/dataRepository/uploadUpdatesTo',
                                            'Upload updates to {0}',
                                            target.datasetName || target.pid
                                        )}
                                        onClick={() => void this.handleSelect(repo, target)}
                                    >
                                        <FileUploadOutlinedIcon className="data-repo-selector__export-update-icon" />
                                    </button>
                                    {this.onDeleteExportTarget && (
                                        <div className="data-repo-selector__delete-control">
                                            <button
                                                className="data-repo-selector__export-action data-repo-selector__export-action--delete"
                                                title={nls.localize('rockit/dataRepository/deleteOptions', 'Delete options')}
                                                aria-label={nls.localize(
                                                    'rockit/dataRepository/deleteOptionsFor',
                                                    'Delete options for {0}',
                                                    target.datasetName || target.pid
                                                )}
                                                aria-expanded={this.openDeleteMenuKey === menuKey}
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        this.openSyncMenuKey = undefined;
                                                        this.syncMenuOpensUpward = false;
                                                        if (this.openDeleteMenuKey === menuKey) {
                                                        this.openDeleteMenuKey = undefined;
                                                        this.deleteMenuOpensUpward = false;
                                                    } else {
                                                        const buttonRect = event.currentTarget.getBoundingClientRect();
                                                        const scrollViewport = event.currentTarget.closest(
                                                            '.data-repo-selector__body'
                                                        )?.getBoundingClientRect();
                                                        const menuHeight = 112;
                                                        const spaceBelow = scrollViewport
                                                            ? scrollViewport.bottom - buttonRect.bottom
                                                            : window.innerHeight - buttonRect.bottom;
                                                        const spaceAbove = scrollViewport
                                                            ? buttonRect.top - scrollViewport.top
                                                            : buttonRect.top;
                                                        this.deleteMenuOpensUpward =
                                                            spaceBelow < menuHeight && spaceAbove > spaceBelow;
                                                        this.openDeleteMenuKey = menuKey;
                                                    }
                                                    this.render();
                                                }}
                                            >
                                                <DeleteOutlineIcon />
                                            </button>
                                            {this.openDeleteMenuKey === menuKey && (
                                                <div
                                                    className={`data-repo-selector__delete-menu${
                                                        this.deleteMenuOpensUpward
                                                            ? ' data-repo-selector__delete-menu--upward'
                                                            : ''
                                                    }`}
                                                    role="menu"
                                                    onClick={event => event.stopPropagation()}
                                                >
                                                    <button
                                                        role="menuitem"
                                                        onClick={() => void this.handleDeleteExport(repo, target, 'unlink')}
                                                    >
                                                        <LinkOffIcon />
                                                        <span>
                                                            <strong>{nls.localize('rockit/dataRepository/unlink', 'Unlink')}</strong>
                                                            <small>{nls.localize('rockit/dataRepository/keepRemoteDataset', 'Keep remote dataset')}</small>
                                                        </span>
                                                    </button>
                                                    <button
                                                        className="data-repo-selector__delete-menu-danger"
                                                        role="menuitem"
                                                        onClick={() => void this.handleDeleteExport(repo, target, 'delete')}
                                                    >
                                                        <DeleteOutlineIcon />
                                                        <span>
                                                            <strong>{nls.localize('rockit/dataRepository/delete', 'Delete')}</strong>
                                                            <small>{nls.localize('rockit/dataRepository/removeFromRepository', 'Remove from repository')}</small>
                                                        </span>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )})}
                    </div>
                )}
            </div>
        );
    }

    protected renderSyncMenuItem(
        repo: DataRepositoryConfig,
        target: DataRepositoryExportTarget,
        mode: RepositorySyncMode,
        label: string,
        description: string
    ): React.ReactNode {
        return (
            <button role="menuitem" onClick={() => void this.handleSelect(repo, target, 'sync', mode)}>
                <FileDownloadOutlinedIcon />
                <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                </span>
            </button>
        );
    }

    protected shouldMenuOpenUpward(button: HTMLElement, menuHeight: number): boolean {
        const buttonRect = button.getBoundingClientRect();
        const scrollViewport = button.closest('.data-repo-selector__body')?.getBoundingClientRect();
        const spaceBelow = scrollViewport
            ? scrollViewport.bottom - buttonRect.bottom
            : window.innerHeight - buttonRect.bottom;
        const spaceAbove = scrollViewport
            ? buttonRect.top - scrollViewport.top
            : buttonRect.top;
        return spaceBelow < menuHeight && spaceAbove > spaceBelow;
    }

    protected formatDate(value: string): string {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        const languageId = nls.localization?.languageId ?? nls.locale ?? nls.defaultLocale;
        return date.toLocaleString(languageId.toLowerCase().startsWith('hu') ? 'hu-HU' : 'en-US');
    }

    protected formatTargetLinkLabel(target: DataRepositoryExportTarget): string {
        return target.pid || this.extractPersistentId(target.target) || target.target;
    }

    protected extractPersistentId(value: string): string | undefined {
        try {
            const url = new URL(value);
            const persistentId = url.searchParams.get('persistentId');
            if (persistentId?.trim()) {
                return persistentId.trim();
            }
            if (url.hostname.toLowerCase() === 'hdl.handle.net') {
                const handle = decodeURIComponent(url.pathname).replace(/^\/+/, '');
                return handle ? `hdl:${handle}` : undefined;
            }
        } catch {
            // Keep fallback label.
        }
        return undefined;
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
