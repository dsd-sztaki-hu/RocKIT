import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { RoCrateEditorMessageService } from './ro-crate-editor-message-service';
export declare class RoCrateEditorWidget extends ReactWidget {
    protected readonly messageService: RoCrateEditorMessageService;
    static readonly ID = "rocrate-editor-widget";
    protected instanceId: string;
    constructor(messageService: RoCrateEditorMessageService);
    initialize(options?: any): void;
    protected render(): React.ReactNode;
}
//# sourceMappingURL=ro-crate-editor-widget.d.ts.map