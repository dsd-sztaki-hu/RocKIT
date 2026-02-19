// src/browser/components/metadata-schema-import-from-url-dialog.tsx

import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import LinkIcon from '@mui/icons-material/Link';

import '../styles/metadata-schema-import-from-url-dialog.css';


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
            <div className="metadata-schema-import-url">
                {/* Content Area */}
                <div className="metadata-schema-import-url__content">
                    
                    {/* Header Section */}
                    <div className="metadata-schema-import-url__header">
                        <div className="metadata-schema-import-url__icon-wrapper">
                            <LinkIcon className="metadata-schema-import-url__icon" />
                        </div>
                        
                        <div className="metadata-schema-import-url__text-wrapper">
                            <div className="metadata-schema-import-url__title">
                                Enter Metadata Schema URL
                            </div>
                            <div className="metadata-schema-import-url__description">
                                Paste the direct link to the JSON schema file. We'll handle the authentication if a provider matches.
                            </div>
                        </div>
                    </div>
                    
                    {/* Input Section */}
                    <div className="metadata-schema-import-url__input-wrapper">
                        <input
                            id={this.inputId}
                            type="text"
                            className="theia-input metadata-schema-import-url__input" 
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
                <div className="metadata-schema-import-url__footer">
                    <button 
                        className="theia-button secondary metadata-schema-import-url__button metadata-schema-import-url__button--secondary"
                        onClick={() => this.handleCancel()}
                    >
                        Cancel
                    </button>
                    <button 
                        className="theia-button main metadata-schema-import-url__button metadata-schema-import-url__button--main"
                        onClick={() => this.handleImport()}
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