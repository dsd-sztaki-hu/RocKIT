import { AbstractDialog, Message } from '@theia/core/lib/browser';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { DataRepositoryExportTarget, DataRepositoryKind } from '../types';
import '../styles/data-repository-export-delete-dialog.css';

export type ExportDeleteAction = 'unlink' | 'delete';

export class DataRepositoryExportDeleteDialog extends AbstractDialog<boolean> {
    private reactRoot: Root | undefined;

    constructor(
        private readonly target: DataRepositoryExportTarget,
        private readonly action: ExportDeleteAction,
        private readonly repositoryKind: DataRepositoryKind
    ) {
        super({ title: action === 'unlink' ? 'Unlink exported dataset' : 'Delete remote dataset' });
        this.contentNode.style.width = '440px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.padding = '0';

        const unlink = action === 'unlink';
        const dataverse = repositoryKind === 'dataverse' || repositoryKind === 'arp-dataverse';
        const cancelButton = this.appendCloseButton('Cancel');
        cancelButton.classList.add('export-delete-confirm__cancel-button');
        const acceptButton = this.appendAcceptButton(
            unlink ? 'Unlink' : dataverse ? 'Delete draft' : 'Delete deposition'
        );
        if (!unlink) {
            acceptButton.classList.add('export-delete-confirm__danger-button');
        }
    }

    get value(): boolean {
        return true;
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }
        const unlink = this.action === 'unlink';
        const dataverse = this.repositoryKind === 'dataverse' || this.repositoryKind === 'arp-dataverse';
        this.reactRoot.render(
            <div className="export-delete-confirm">
                <div className={`export-delete-confirm__icon${unlink ? '' : ' export-delete-confirm__icon--danger'}`}>
                    {unlink ? <LinkOffIcon /> : <DeleteOutlineIcon />}
                </div>
                <div className="export-delete-confirm__content">
                    <h3>{unlink ? 'Unlink this export?' : 'Delete this remote dataset?'}</h3>
                    <div className="export-delete-confirm__dataset">{this.target.datasetName || this.target.pid}</div>
                    <p>
                        {unlink
                            ? 'This removes the local export link and mapping. The remote dataset will not be changed.'
                            : dataverse
                                ? 'Dataverse will delete the latest draft, then the local export link will be removed.'
                                : 'The Zenodo deposition will be deleted, then the local export link will be removed.'}
                    </p>
                    {!unlink && dataverse && (
                        <div className="export-delete-confirm__warning">
                            <WarningAmberIcon />
                            <span>
                                Published datasets cannot normally be deleted. A regular user can usually delete
                                only the latest draft version.
                            </span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.render();
    }

    protected onBeforeDetach(msg: Message): void {
        this.reactRoot?.unmount();
        this.reactRoot = undefined;
        super.onBeforeDetach(msg);
    }
}

export class DataRepositoryExportDeleteErrorDialog extends AbstractDialog<void> {
    private reactRoot: Root | undefined;

    constructor(private readonly errorMessage: string) {
        super({ title: 'Export deletion failed' });
        this.contentNode.style.width = '440px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.padding = '0';
        const closeButton = this.appendCloseButton('Close');
        closeButton.classList.add('export-delete-confirm__cancel-button');
    }

    get value(): void {
        return undefined;
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }
        this.reactRoot.render(
            <div className="export-delete-confirm">
                <div className="export-delete-confirm__icon export-delete-confirm__icon--danger">
                    <ErrorOutlineIcon />
                </div>
                <div className="export-delete-confirm__content">
                    <h3>The export could not be deleted</h3>
                    <p className="export-delete-confirm__error-message">{this.errorMessage}</p>
                    <p>The operation stopped at the failing step. Review the error and try again.</p>
                </div>
            </div>
        );
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.render();
    }

    protected onBeforeDetach(msg: Message): void {
        this.reactRoot?.unmount();
        this.reactRoot = undefined;
        super.onBeforeDetach(msg);
    }
}
