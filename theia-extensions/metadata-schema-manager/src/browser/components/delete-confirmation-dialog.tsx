// src/browser/components/delete-confirmation-dialog.tsx

import * as React from 'react';
// We keep the type import but avoid using it as a value to prevent runtime issues if not present
import type * as ReactDOMTypes from 'react-dom/client';
import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';

// Icons
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

export class DeleteConfirmationDialog extends AbstractDialog<boolean> {

    private reactRoot: ReactDOMTypes.Root | undefined;
    private result: boolean = false; // Store the result here

    constructor(private readonly count: number) {
        super({
            title: 'Confirm Deletion'
        });

        this.contentNode.style.width = '400px';
        this.contentNode.style.padding = '0';
    }

    // Return the stored result
    get value(): boolean {
        return this.result;
    }

    protected handleAccept() {
        this.result = true; // Set result to true
        this.accept();      // Call accept without arguments
    }

    protected handleClose() {
        this.result = false; // Set result to false
        this.close();        // Close the dialog
    }

    protected render(): void {
        if (!this.contentNode) return;

        // Dynamic require to ensure compatibility
        const ReactDOM = require('react-dom/client');

        if (!this.reactRoot) {
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }

        // Use optional chaining for safety
        this.reactRoot?.render(
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
        <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            backgroundColor: 'var(--theia-editor-background)',
            color: 'var(--theia-foreground)',
            height: '100%'
        }}>
            {/* Body */}
            <div style={{ 
                padding: '20px', 
                display: 'flex', 
                alignItems: 'start', 
                gap: '15px',
                flex: 1
            }}>
                <WarningAmberIcon style={{ 
                    fontSize: '32px', 
                    color: 'var(--theia-warnForeground, #FF9800)' 
                }} />
                
                <div style={{ paddingTop: '4px' }}>
                    <h3 style={{ 
                        margin: '0 0 8px 0', 
                        fontSize: '14px', 
                        fontWeight: 600,
                        color: 'var(--theia-foreground)'
                    }}>
                        Delete {count} schema(s)?
                    </h3>
                    <p style={{ 
                        margin: 0, 
                        fontSize: '13px', 
                        color: 'var(--theia-descriptionForeground)',
                        lineHeight: '1.5'
                    }}>
                        Are you sure you want to delete the selected schemas? This action cannot be undone.
                    </p>
                </div>
            </div>

            {/* Custom Footer */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'flex-end', 
                alignItems: 'center',
                gap: '10px', 
                padding: '15px 20px', 
                backgroundColor: 'var(--theia-layout-color2)', 
                borderTop: '1px solid var(--theia-panel-border)'
            }}>
                <button 
                    className="theia-button secondary"
                    onClick={onCancel}
                    style={{ 
                        minWidth: '80px',
                        border: '1px solid var(--theia-button-border, #ccc)',
                        cursor: 'pointer'
                    }}
                >
                    Cancel
                </button>
                <button 
                    className="theia-button"
                    onClick={onConfirm}
                    style={{ 
                        minWidth: '80px',
                        backgroundColor: 'var(--theia-errorForeground)', // Red
                        borderColor: 'var(--theia-errorForeground)',
                        color: 'var(--theia-editor-background)', // Contrast text
                        cursor: 'pointer'
                    }}
                >
                    Delete
                </button>
            </div>
        </div>
    );
};