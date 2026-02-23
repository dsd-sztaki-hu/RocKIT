import { AbstractDialog, Message } from '@theia/core/lib/browser';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import '../styles/data-repository-delete-dialog.css';

export class DataRepositoryDeleteDialog extends AbstractDialog<boolean> {
    private reactRoot: Root | undefined;
    private result: boolean = false; 

    constructor(private readonly count: number) {
        super({
            title: 'Confirm Deletion'
        });

        // Responsive sizing
        this.contentNode.style.width = '400px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.padding = '0';
    }

    get value(): boolean {
        return this.result;
    }

    protected handleAccept() {
        this.result = true;
        this.accept();      
    }

    protected handleClose() {
        this.result = false; 
        this.close();        
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div className="data-repo-delete-dialog">
                <div className="data-repo-delete-dialog__body">
                    <WarningAmberIcon className="data-repo-delete-dialog__icon" />
                    <div className="data-repo-delete-dialog__text-container">
                        <h3 className="data-repo-delete-dialog__title">
                            Delete {this.count} repository{this.count > 1 ? 'ies' : ''}?
                        </h3>
                        <p className="data-repo-delete-dialog__message">
                            Are you sure you want to delete the selected repositories? This action cannot be undone.
                        </p>
                    </div>
                </div>

                <div className="data-repo-delete-dialog__footer">
                    <button 
                        className="theia-button secondary data-repo-delete-dialog__btn-cancel"
                        onClick={() => this.handleClose()}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button data-repo-delete-dialog__btn-delete"
                        onClick={() => this.handleAccept()}
                    >
                        Delete
                    </button>
                </div>
            </div>
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