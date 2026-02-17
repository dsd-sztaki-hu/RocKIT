import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

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

        this.appendCloseButton('Cancel');
        this.appendAcceptButton('Save');
    }

    get value(): boolean {
        return true; 
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = ReactDOM.createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#4caf50', fontSize: '1.1em' }}>
                    <i className="codicon codicon-check" style={{ fontSize: '1.5em' }}/>
                    <strong>Successfully connected to {this.providerName}</strong>
                </div>

                <div style={{ opacity: 0.8 }}>
                    We found {this.schemaNames.length} available metadata templates.
                </div>

                {this.schemaNames.length > 0 && (
                    <div style={{ 
                        marginTop: '10px',
                        border: '1px solid var(--theia-panel-border)',
                        backgroundColor: 'var(--theia-input-background)',
                        maxHeight: '150px',
                        overflowY: 'auto',
                        padding: '5px'
                    }}>
                        {this.schemaNames.map((name, i) => (
                            <div key={i} style={{ padding: '4px', borderBottom: '1px solid var(--theia-panel-border)' }}>
                                <i className="codicon codicon-file-code" style={{ marginRight: '6px', opacity: 0.7 }}/>
                                {name}
                            </div>
                        ))}
                    </div>
                )}
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