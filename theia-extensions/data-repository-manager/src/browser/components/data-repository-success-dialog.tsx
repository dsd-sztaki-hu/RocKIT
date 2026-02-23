import { AbstractDialog, Message } from '@theia/core/lib/browser';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';

import '../styles/data-repository-success-dialog.css';

export class DataRepositorySuccessDialog extends AbstractDialog<boolean> {

    private reactRoot: Root | undefined;

    constructor(
        private readonly repositoryName: string,
        private readonly expirationDate?: string
    ) {
        super({
            title: 'Connection Successful'
        });
        
        // UI Enhancement: Responsive sizing limits
        this.contentNode.style.width = '450px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.maxHeight = '90vh';
        this.contentNode.style.padding = '0'; 
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';
    }

    get value(): boolean {
        return true; 
    }

    protected handleSave() {
        this.accept();
    }

    protected handleCancel() {
        this.close(); // Returns undefined/false
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div className="data-repo-success">
                
                <div className="data-repo-success__content">
                    
                    {/* Success Header Banner */}
                    <div className="data-repo-success__header">
                        <div className="data-repo-success__header-icon-wrapper">
                            <CheckCircleOutlineIcon className="data-repo-success__header-icon" />
                        </div>
                        <div>
                            <div className="data-repo-success__title">
                                Connection Established
                            </div>
                            <div className="data-repo-success__message">
                                Successfully authenticated with <strong>{this.repositoryName}</strong>.
                            </div>
                        </div>
                    </div>

                    {/* Expiration Info (if available) */}
                    {this.expirationDate && (
                        <div className="data-repo-success__info-box">
                            <div className="data-repo-success__info-icon-wrapper">
                                <EventAvailableIcon className="data-repo-success__info-icon" />
                            </div>
                            <div className="data-repo-success__info-text">
                                <span>API Key Expiration:</span>
                                <strong>{this.expirationDate}</strong>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Section */}
                <div className="data-repo-success__footer">
                    <button 
                        className="theia-button secondary data-repo-success__btn-cancel"
                        onClick={() => this.handleCancel()}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main data-repo-success__btn-save"
                        onClick={() => this.handleSave()}
                    >
                        Confirm & Save
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