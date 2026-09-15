// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { AbstractDialog, Message } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
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
        super({
            title: action === 'unlink'
                ? nls.localize('rockit/dataRepository/unlinkExportedDataset', 'Unlink exported dataset')
                : nls.localize('rockit/dataRepository/deleteRemoteDataset', 'Delete remote dataset')
        });
        this.contentNode.style.width = '440px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.padding = '0';

        const unlink = action === 'unlink';
        const dataverse = repositoryKind === 'dataverse' || repositoryKind === 'arp-dataverse';
        const cancelButton = this.appendCloseButton(nls.localize('rockit/common/cancel', 'Cancel'));
        cancelButton.classList.add('export-delete-confirm__cancel-button');
        const acceptButton = this.appendAcceptButton(
            unlink
                ? nls.localize('rockit/dataRepository/unlink', 'Unlink')
                : dataverse
                    ? nls.localize('rockit/dataRepository/deleteDraft', 'Delete draft')
                    : nls.localize('rockit/dataRepository/deleteDeposition', 'Delete deposition')
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
                    <h3>
                        {unlink
                            ? nls.localize('rockit/dataRepository/unlinkExportQuestion', 'Unlink this export?')
                            : nls.localize('rockit/dataRepository/deleteRemoteDatasetQuestion', 'Delete this remote dataset?')}
                    </h3>
                    <div className="export-delete-confirm__dataset">{this.target.datasetName || this.target.pid}</div>
                    <p>
                        {unlink
                            ? nls.localize(
                                'rockit/dataRepository/unlinkExportDescription',
                                'This removes the local export link and mapping. The remote dataset will not be changed.'
                            )
                            : dataverse
                                ? nls.localize(
                                    'rockit/dataRepository/deleteDataverseDraftDescription',
                                    'Dataverse will delete the latest draft, then the local export link will be removed.'
                                )
                                : nls.localize(
                                    'rockit/dataRepository/deleteZenodoDepositionDescription',
                                    'The Zenodo deposition will be deleted, then the local export link will be removed.'
                                )}
                    </p>
                    {!unlink && dataverse && (
                        <div className="export-delete-confirm__warning">
                            <WarningAmberIcon />
                            <span>
                                {nls.localize(
                                    'rockit/dataRepository/publishedDatasetDeleteWarning',
                                    'Published datasets cannot normally be deleted. A regular user can usually delete only the latest draft version.'
                                )}
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
        super({
            title: nls.localize('rockit/dataRepository/exportDeletionFailed', 'Export deletion failed')
        });
        this.contentNode.style.width = '440px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.padding = '0';
        const closeButton = this.appendCloseButton(nls.localize('rockit/dataRepository/close', 'Close'));
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
                    <h3>
                        {nls.localize(
                            'rockit/dataRepository/exportCouldNotBeDeleted',
                            'The export could not be deleted'
                        )}
                    </h3>
                    <p className="export-delete-confirm__error-message">{this.errorMessage}</p>
                    <p>
                        {nls.localize(
                            'rockit/dataRepository/exportDeletionStopped',
                            'The operation stopped at the failing step. Review the error and try again.'
                        )}
                    </p>
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
