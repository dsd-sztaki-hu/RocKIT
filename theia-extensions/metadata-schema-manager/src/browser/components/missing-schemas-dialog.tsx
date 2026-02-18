// src/browser/components/missing-schemas-dialog.tsx

import * as React from 'react';
import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';

// Icons
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

export class MissingSchemasDialog extends AbstractDialog<void> {

    private reactRoot: any; // Keep 'any' to avoid strict type issues with dynamic ReactDOM

    constructor(private readonly count: number) {
        super({
            title: 'Missing Metadata Schemas'
        });

        this.contentNode.style.width = '450px';
        this.contentNode.style.padding = '0';
    }

    get value(): void {
        return undefined;
    }

    protected handleAccept() {
        this.accept();
    }

    protected render(): void {
        if (!this.contentNode) return;

        const ReactDOM = require('react-dom/client');

        if (!this.reactRoot) {
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }

        this.reactRoot?.render(
            <InfoContent 
                count={this.count}
                onConfirm={() => this.handleAccept()}
            />
        );
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // Ensure rendering happens after attachment
        requestAnimationFrame(() => this.render());
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }
}

interface InfoContentProps {
    count: number;
    onConfirm: () => void;
}

const InfoContent: React.FC<InfoContentProps> = ({ count, onConfirm }) => {
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
                <InfoOutlinedIcon style={{ 
                    fontSize: '32px', 
                    color: 'var(--theia-infoForeground, #2196F3)' // Standard Info Blue
                }} />
                
                <div style={{ paddingTop: '4px' }}>
                    <h3 style={{ 
                        margin: '0 0 8px 0', 
                        fontSize: '14px', 
                        fontWeight: 600,
                        color: 'var(--theia-foreground)'
                    }}>
                        Missing Metadata Schemas
                    </h3>
                    <p style={{ 
                        margin: 0, 
                        fontSize: '13px', 
                        color: 'var(--theia-descriptionForeground)',
                        lineHeight: '1.5'
                    }}>
                        The RO-Crate references <strong>{count}</strong> missing schema{count !== 1 ? 's' : ''}.
                        <br/>
                        Downloading now...
                    </p>
                </div>
            </div>

            {/* Custom Footer */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'flex-end', 
                alignItems: 'center',
                padding: '15px 20px', 
                backgroundColor: 'var(--theia-layout-color2)', 
                borderTop: '1px solid var(--theia-panel-border)'
            }}>
                <button 
                    className="theia-button main"
                    onClick={onConfirm}
                    style={{ 
                        minWidth: '80px',
                        cursor: 'pointer'
                    }}
                >
                    OK
                </button>
            </div>
        </div>
    );
};