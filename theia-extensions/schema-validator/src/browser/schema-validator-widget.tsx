import * as React from 'react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import type { Disposable } from '@theia/core';
import { Message } from '@theia/core/lib/browser';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';

@injectable()
export class SchemaValidatorWidget extends ReactWidget {

    static readonly ID = 'schema-validator:widget';
    static readonly LABEL = 'Schema Validator Widget';

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(AppStateService)
    protected readonly appStateService!: AppStateService;

    protected validationErrorsDisposable?: Disposable;

    @postConstruct()
    protected init(): void {
        this.doInit()
    }

    protected async doInit(): Promise <void> {
        this.id = SchemaValidatorWidget.ID;
        this.title.label = SchemaValidatorWidget.LABEL;
        this.title.caption = SchemaValidatorWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-exclamation-triangle';
        this.validationErrorsDisposable = this.appStateService.onDidChangeSelector(s => s.validationErrors)((_) => this.update());
        this.update();
    }

    render(): React.ReactElement {
        const errors = this.appStateService.validationErrors ?? [];
        const hasErrors = errors.length > 0;
        const header = hasErrors ? `Validation Errors (${errors.length})` : 'No validation errors';
        return (
            <div id="widget-container">
                <AlertMessage type={hasErrors ? 'WARNING' : 'INFO'} header={header} />
                {hasErrors && (
                    <div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ textAlign: 'left' }}>Entity</th>
                                    <th style={{ textAlign: 'left' }}>Field</th>
                                    <th style={{ textAlign: 'left' }}>Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {errors.map((e, i) => (
                                    <tr key={i} style={{ borderTop: '1px solid var(--theia-editorWidget-border)' }}>
                                        <td>{e.entityType} ({e.entityId})</td>
                                        <td>{e.fieldLabel || e.fieldName}</td>
                                        <td>{e.error}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    }

    protected displayMessage(): void {
        this.messageService.info('Congratulations: SchemaValidator Widget Successfully Created!');
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        const htmlElement = document.getElementById('displayMessageButton');
        if (htmlElement) {
            htmlElement.focus();
        }
    }

    dispose(): void {
        this.validationErrorsDisposable?.dispose();
        super.dispose();
    }

}
