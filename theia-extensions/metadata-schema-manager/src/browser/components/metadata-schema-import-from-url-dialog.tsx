import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

export class MetadataSchemaImportFromUrlDialog extends AbstractDialog<string> {

    private readonly inputId = 'metadata-schema-url-input';
    private inputValue: string = '';
    private reactRoot: ReactDOM.Root | undefined;

    constructor() {
        super({
            title: 'Import Schema from URL'
        });

        this.contentNode.style.width = '500px';

        this.appendCloseButton('Cancel');
        this.appendAcceptButton('Import');
    }

    get value(): string {
        return this.inputValue;
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ 
                    color: 'var(--theia-foreground)',
                    lineHeight: '1.5',
                    fontSize: 'var(--theia-ui-font-size1)'
                }}>
                    Enter the direct link to the metadata schema (JSON).
                </div>
                
                <div style={{ 
                    color: 'var(--theia-descriptionForeground)',
                    fontSize: 'var(--theia-ui-font-size0)',
                    marginBottom: '5px'
                }}>
                    We will automatically check your configured providers for the necessary API keys.
                </div>
                
                <input
                    id={this.inputId}
                    type="text"
                    className="theia-input" 
                    style={{ 
                        width: '100%', 
                        boxSizing: 'border-box',
                        padding: '6px'
                    }}
                    placeholder="https://repo.schema.researchdata.hu/templates/..."
                    defaultValue={this.inputValue}
                    onChange={(e) => this.inputValue = e.target.value}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.stopPropagation(); 
                            this.accept();
                        }
                    }}
                    autoComplete="off"
                    spellCheck={false}
                />
            </div>
        );
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.render();
        
        // Defer focus to ensure DOM is ready
        requestAnimationFrame(() => {
            const input = document.getElementById(this.inputId);
            if (input) input.focus();
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