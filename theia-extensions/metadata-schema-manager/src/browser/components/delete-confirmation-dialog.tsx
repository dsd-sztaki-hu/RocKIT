// src/browser/components/delete-confirmation-dialog.tsx

import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';

import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import '../styles/delete-confirmation-dialog.css';

export class DeleteConfirmationDialog extends AbstractDialog<boolean> {

    private reactRoot: Root | undefined;
    private result: boolean = false; 

    constructor(private readonly count: number) {
        super({
            title: 'Confirm Deletion'
        });

        this.contentNode.style.width = '400px';
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
        if (!this.contentNode) return;

        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <DeleteContent 
                count={this.count}
                onConfirm={() => this.handleAccept()}
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

interface DeleteContentProps {
    count: number;
    onConfirm: () => void;
    onCancel: () => void;
}

const DeleteContent: React.FC<DeleteContentProps> = ({ count, onConfirm, onCancel }) => {
    return (
        <div className="delete-confirmation">
            {/* Body */}
            <div className="delete-confirmation__body">
                <WarningAmberIcon className="delete-confirmation__icon" />
                
                <div className="delete-confirmation__text-container">
                    <h3 className="delete-confirmation__title">
                        Delete {count} schema(s)?
                    </h3>
                    <p className="delete-confirmation__message">
                        Are you sure you want to delete the selected schemas? This action cannot be undone.
                    </p>
                </div>
            </div>

            {/* Custom Footer */}
            <div className="delete-confirmation__footer">
                <button 
                    className="theia-button secondary delete-confirmation__btn-cancel"
                    onClick={onCancel}
                >
                    Cancel
                </button>
                <button 
                    className="theia-button delete-confirmation__btn-delete"
                    onClick={onConfirm}
                >
                    Delete
                </button>
            </div>
        </div>
    );
};