// src/browser/components/missing-schemas-dialog.tsx

import * as React from 'react';
import { AbstractDialog } from '@theia/core/lib/browser';
import { Message } from '@lumino/messaging';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import '../styles/missing-schemas-dialog.css';


export class MissingSchemasDialog extends AbstractDialog<void> {

    private reactRoot: any; 

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
        <div className="missing-schemas">
            {/* Body */}
            <div className="missing-schemas__body">
                <InfoOutlinedIcon className="missing-schemas__icon" />
                
                <div className="missing-schemas__text-container">
                    <h3 className="missing-schemas__title">
                        Missing Metadata Schemas
                    </h3>
                    <p className="missing-schemas__message">
                        The RO-Crate references <strong>{count}</strong> missing schema{count !== 1 ? 's' : ''}.
                        <br/>
                        Downloading now...
                    </p>
                </div>
            </div>

            {/* Custom Footer */}
            <div className="missing-schemas__footer">
                <button 
                    className="theia-button main missing-schemas__btn-ok"
                    onClick={onConfirm}
                >
                    OK
                </button>
            </div>
        </div>
    );
};