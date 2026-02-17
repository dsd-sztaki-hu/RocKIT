// src/browser/components/metadata-schema-import-from-url-dialog.tsx

import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import LinkIcon from '@mui/icons-material/Link';

export class MetadataSchemaImportFromUrlDialog extends AbstractDialog<string> {

    private readonly inputId = 'metadata-schema-url-input';
    private inputValue: string = '';
    private reactRoot: ReactDOM.Root | undefined;

    constructor() {
        super({
            title: 'Import Schema from URL'
        });

        this.contentNode.style.width = '500px';
        this.contentNode.style.padding = '0';

        // Removed standard buttons to render custom styled ones in React
        // this.appendCloseButton('Cancel');
        // this.appendAcceptButton('Import');
    }

    get value(): string {
        return this.inputValue;
    }

    protected handleImport() {
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
                {/* Content Area */}
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    
                    {/* Header Section */}
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '40px',
                            height: '40px',
                            backgroundColor: 'var(--theia-list-hoverBackground)',
                            borderRadius: '50%',
                            flexShrink: 0,
                            border: '1px solid var(--theia-contrastBorder, transparent)'
                        }}>
                            <LinkIcon style={{ color: 'var(--theia-textLink-foreground)', fontSize: '24px' }} />
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ 
                                fontWeight: 600, 
                                fontSize: 'var(--theia-ui-font-size1)',
                                lineHeight: '1.4'
                            }}>
                                Enter Metadata Schema URL
                            </div>
                            <div style={{ 
                                fontSize: 'var(--theia-ui-font-size0)', 
                                color: 'var(--theia-descriptionForeground)',
                                lineHeight: '1.4'
                            }}>
                                Paste the direct link to the JSON schema file. We'll handle the authentication if a provider matches.
                            </div>
                        </div>
                    </div>
                    
                    {/* Input Section */}
                    <div>
                        <input
                            id={this.inputId}
                            type="text"
                            className="theia-input" 
                            style={{ 
                                width: '100%', 
                                boxSizing: 'border-box',
                                padding: '8px 10px',
                                height: '32px',
                                fontSize: '13px',
                                border: '1px solid var(--theia-input-border, #ccc)', 
                                backgroundColor: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                borderRadius: '2px',
                                outline: 'none'
                            }}
                            placeholder="https://repo.schema.researchdata.hu/templates/..."
                            defaultValue={this.inputValue}
                            onChange={(e) => this.inputValue = e.target.value}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.stopPropagation(); 
                                    this.handleImport();
                                }
                            }}
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </div>
                </div>

                {/* Footer / Button Area */}
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end', 
                    gap: '10px', 
                    padding: '15px 20px',
                    backgroundColor: 'var(--theia-layout-color2)', // Slightly darker/lighter background for contrast
                    borderTop: '1px solid var(--theia-panel-border)'
                }}>
                    <button 
                        className="theia-button secondary"
                        onClick={() => this.handleCancel()}
                        style={{ 
                            minWidth: '80px',
                            // Ensure border is visible in light themes
                            border: '1px solid var(--theia-button-border, #ccc)' 
                        }}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main"
                        onClick={() => this.handleImport()}
                        style={{ 
                            minWidth: '80px',
                            color: 'var(--theia-button-foreground)'
                        }}
                    >
                        Import
                    </button>
                </div>
            </div>
        );
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.render();
        
        requestAnimationFrame(() => {
            const input = document.getElementById(this.inputId);
            if (input) {
                input.focus();
            }
        });
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }
}