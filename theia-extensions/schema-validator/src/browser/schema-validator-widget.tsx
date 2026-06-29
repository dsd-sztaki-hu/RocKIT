import * as React from 'react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import type { Disposable } from '@theia/core';
import { Message } from '@theia/core/lib/browser';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget';

@injectable()
export class SchemaValidatorWidget extends ReactWidget {

    static readonly ID = 'validation-errors:widget';
    static readonly LABEL = 'Validation Errors';

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(AppStateService)
    protected readonly appStateService!: AppStateService;

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    protected readonly openingEntities = new Set<string>();

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
                                    <tr key={i} style={{ borderTop: '1px solid var(--theia-editorWidget-border)', cursor: 'pointer' }} onClick={() => this.handleErrorRowClick(e)}>
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

    protected handleErrorRowClick(error: { entityId?: string; fieldName?: string }): void {
        const entityId = error?.entityId;
        const fieldName = error?.fieldName;
        if (!entityId) {
            return;
        }
        this.appStateService.selectedEntityId = entityId;
        void this.openRoCrateEditorForEntity(entityId).then((widget) => {
            if (fieldName) {
                widget?.scrollToValidationField(entityId, fieldName);
            }
        });
    }

    protected async openRoCrateEditorForEntity(entityId: string): Promise<RoCrateEditorWidget | undefined> {
        if (this.openingEntities.has(entityId)) {
            return undefined;
        }
        this.openingEntities.add(entityId);
        try {
            const existingWidgetId = this.findWidgetIdForEntity(entityId);
            if (existingWidgetId) {
                const existingWidget = this.widgetManager.tryGetWidget(existingWidgetId);
                await this.shell.activateWidget(existingWidgetId);
                return existingWidget instanceof RoCrateEditorWidget
                    ? existingWidget
                    : undefined;
            }
            const instanceId = `${RoCrateEditorWidget.ID}:${Math.random().toString(36).slice(2)}`;
            const widget = await this.widgetManager.getOrCreateWidget(RoCrateEditorWidget.ID, {
                instanceId,
                entityId,
            });
            await this.shell.addWidget(widget, { area: 'main' });
            this.appStateService.registerEntityEditor(widget.id, entityId);
            await this.shell.activateWidget(widget.id);
            return widget instanceof RoCrateEditorWidget
                ? widget
                : undefined;
        } finally {
            this.openingEntities.delete(entityId);
        }
    }

    protected findWidgetIdForEntity(entityId: string): string | undefined {
        return this.appStateService.getEntityEditorWidgetId(entityId);
    }

    dispose(): void {
        this.validationErrorsDisposable?.dispose();
        super.dispose();
    }

}
