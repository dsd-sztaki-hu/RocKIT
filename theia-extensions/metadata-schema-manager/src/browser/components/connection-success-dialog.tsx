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

export class ConnectionSuccessDialog extends AbstractDialog<boolean> {

    private reactRoot: ReactDOM.Root | undefined;

    constructor(
        private providerName: string,
        private schemaNames: string[]
    ) {
        super({
            title: 'Connection Successful'
        });
        
        this.contentNode.style.width = '500px';
        this.contentNode.style.height = '400px'; // Consistent height
        this.contentNode.style.display = 'flex';
        this.contentNode.style.flexDirection = 'column';
        this.contentNode.style.padding = '0'; // Handle padding in React

        // Removed standard buttons to use custom footer
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
            <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                height: '100%',
                backgroundColor: 'var(--theia-editor-background)',
                color: 'var(--theia-foreground)'
            }}>
                
                {/* Scrollable Content */}
                <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    
                    {/* Success Header */}
                    <div style={{ 
                        display: 'flex', 
                        gap: '15px', 
                        alignItems: 'center', 
                        marginBottom: '20px',
                        padding: '15px',
                        backgroundColor: 'rgba(76, 175, 80, 0.08)', // Very subtle green bg
                        borderRadius: '4px',
                        border: '1px solid rgba(76, 175, 80, 0.3)'
                    }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0
                        }}>
                            <CheckCircleOutlineIcon style={{ color: '#4caf50', fontSize: '32px' }} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 'var(--theia-ui-font-size1)', color: 'var(--theia-foreground)' }}>
                                Connection Established
                            </div>
                            <div style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)', marginTop: '2px' }}>
                                Successfully authenticated with <strong>{this.providerName}</strong>.
                            </div>
                        </div>
                    </div>

                    {/* List Label */}
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        marginBottom: '8px', 
                        fontSize: 'var(--theia-ui-font-size0)',
                        color: 'var(--theia-foreground)',
                        fontWeight: 600
                    }}>
                        <FolderOpenIcon style={{ fontSize: '16px', color: 'var(--theia-textLink-foreground)' }} />
                        <span>Available Templates ({this.schemaNames.length})</span>
                    </div>

                    {/* List Container */}
                    <div style={{ 
                        flex: 1, 
                        border: '1px solid var(--theia-panel-border)', 
                        borderRadius: '4px',
                        overflowY: 'auto',
                        backgroundColor: 'var(--theia-input-background)'
                    }}>
                        {this.schemaNames.length > 0 ? (
                            this.schemaNames.map((name, i) => (
                                <div 
                                    key={i} 
                                    style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        padding: '10px 12px', 
                                        borderBottom: i < this.schemaNames.length - 1 ? '1px solid var(--theia-panel-border)' : 'none',
                                        fontSize: 'var(--theia-ui-font-size1)',
                                        color: 'var(--theia-foreground)',
                                        backgroundColor: 'var(--theia-editor-background)'
                                    }}
                                >
                                    <span style={{ marginRight: '10px', display: 'flex', alignItems: 'center' }}>
                                        <File /> 
                                    </span>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {name}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--theia-descriptionForeground)', fontStyle: 'italic' }}>
                                No templates found in the root folder.
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Section */}
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end', 
                    gap: '10px', 
                    padding: '15px 20px',
                    backgroundColor: 'var(--theia-layout-color2)', 
                    borderTop: '1px solid var(--theia-panel-border)'
                }}>
                    <button 
                        className="theia-button secondary"
                        onClick={() => this.handleCancel()}
                        style={{ 
                            minWidth: '80px',
                            border: '1px solid var(--theia-button-border, #ccc)'
                        }}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main"
                        onClick={() => this.handleSave()}
                        style={{ 
                            minWidth: '80px',
                            color: 'var(--theia-button-foreground)'
                        }}
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