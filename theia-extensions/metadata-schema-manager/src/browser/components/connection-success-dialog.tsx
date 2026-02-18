// src/browser/components/connection-success-dialog.tsx

import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

// MUI Icons
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';

// Reuse consistency
import { File } from './icons';

// Import CSS
import '../styles/connection-success-dialog.css';

export class ConnectionSuccessDialog extends AbstractDialog<boolean> {

    private reactRoot: ReactDOM.Root | undefined;

    constructor(
        private providerName: string,
        private schemaNames: string[]
    ) {
        super({
            title: 'Connection Successful'
        });
        
        // Layout sizing via JS for the dialog container, content via CSS
        this.contentNode.style.width = '500px';
        this.contentNode.style.height = '400px'; 
        this.contentNode.style.padding = '0'; 
    }

    get value(): boolean {
        return true; 
    }

    protected handleSave() {
        this.accept();
    }

    protected handleCancel() {
        this.close();
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div className="connection-success">
                
                {/* Scrollable Content */}
                <div className="connection-success__content">
                    
                    {/* Success Header */}
                    <div className="connection-success__header">
                        <div className="connection-success__header-icon-wrapper">
                            <CheckCircleOutlineIcon className="connection-success__header-icon" />
                        </div>
                        <div>
                            <div className="connection-success__title">
                                Connection Established
                            </div>
                            <div className="connection-success__message">
                                Successfully authenticated with <strong>{this.providerName}</strong>.
                            </div>
                        </div>
                    </div>

                    {/* List Label */}
                    <div className="connection-success__list-label">
                        <FolderOpenIcon style={{ fontSize: '16px', color: 'var(--theia-textLink-foreground)' }} />
                        <span>Available Templates ({this.schemaNames.length})</span>
                    </div>

                    {/* List Container */}
                    <div className="connection-success__list-container">
                        {this.schemaNames.length > 0 ? (
                            this.schemaNames.map((name, i) => (
                                <div key={i} className="connection-success__list-item">
                                    <span className="connection-success__list-item-icon">
                                        <File /> 
                                    </span>
                                    <span className="connection-success__list-item-text">
                                        {name}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <div className="connection-success__empty">
                                No templates found in the root folder.
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Section */}
                <div className="connection-success__footer">
                    <button 
                        className="theia-button secondary connection-success__btn-cancel"
                        onClick={() => this.handleCancel()}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main connection-success__btn-save"
                        onClick={() => this.handleSave()}
                    >
                        Save
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