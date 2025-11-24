import * as React from 'react';
import { injectable } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';

@injectable()
export class RoCrateEditorWidget extends ReactWidget {

    static readonly ID = 'rocrate-editor-widget';

    protected instanceId: string = '';

    constructor() {
        super();
        this.addClass('rocrate-editor');
        this.title.closable = true;
    }

    initialize(options: any = {}): void {
        this.instanceId =
            options.instanceId ??
            `${RoCrateEditorWidget.ID}:${Math.random().toString(36).substring(2)}`;

        this.id = this.instanceId;
        this.title.label = `Editor ${this.instanceId}`;

        this.update();
    }

    render(): React.ReactNode {
        return (
            <div style={{ padding: '1rem' }}>
                <h3>Panel ID:</h3>
                <pre>{this.instanceId}</pre>
            </div>
        );
    }
}
