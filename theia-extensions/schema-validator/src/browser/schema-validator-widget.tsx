// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import * as React from 'react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { nls } from '@theia/core/lib/common/nls';
import type { Disposable } from '@theia/core';
import { Message } from '@theia/core/lib/browser';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget';
import {
    localizeRoCrateEntityType,
    localizeValidationErrorMessage,
} from 'rockit-common/lib/browser';

type ValidationError = {
    entityId?: string
    entityType?: string
    fieldName?: string
    fieldLabel?: string
    error?: string
    error_hu?: string
}

const ERROR_ROW_HEIGHT = 94;
const ERROR_ROW_GAP = 8;
const ERROR_ROW_OVERSCAN = 8;

const formatCount = (value: number): string => new Intl.NumberFormat().format(value);

const getErrorKey = (error: ValidationError, index: number): string => [
    error.entityId ?? '',
    error.entityType ?? '',
    error.fieldName ?? '',
    error.fieldLabel ?? '',
    error.error ?? '',
    error.error_hu ?? '',
    index,
].join(':');

const ValidationErrorList = ({
    errors,
    onSelect,
}: {
    errors: ValidationError[]
    onSelect: (error: ValidationError) => void
}) => {
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(420);

    React.useLayoutEffect(() => {
        const node = viewportRef.current;
        if (!node) {
            return;
        }

        const updateHeight = () => {
            setViewportHeight(node.clientHeight || 420);
        };
        updateHeight();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateHeight);
            return () => window.removeEventListener('resize', updateHeight);
        }

        const observer = new ResizeObserver(updateHeight);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
        setScrollTop(0);
        if (viewportRef.current) {
            viewportRef.current.scrollTop = 0;
        }
    }, [errors]);

    const totalHeight = errors.length * ERROR_ROW_HEIGHT;
    const startIndex = Math.max(0, Math.floor(scrollTop / ERROR_ROW_HEIGHT) - ERROR_ROW_OVERSCAN);
    const visibleCount = Math.ceil(viewportHeight / ERROR_ROW_HEIGHT) + ERROR_ROW_OVERSCAN * 2;
    const endIndex = Math.min(errors.length, startIndex + visibleCount);
    const visibleErrors = errors.slice(startIndex, endIndex);

    return (
        <div className="schema-validator-error-list">
            <div
                ref={viewportRef}
                className="schema-validator-error-viewport"
                onScroll={(event: React.UIEvent<HTMLDivElement>) => {
                    setScrollTop(event.currentTarget.scrollTop);
                }}
            >
                <div
                    className="schema-validator-error-spacer"
                    style={{ height: totalHeight }}
                >
                    {visibleErrors.map((error, visibleIndex) => {
                        const index = startIndex + visibleIndex;
                        const entityType = error.entityType
                            ? localizeRoCrateEntityType(error.entityType)
                            : nls.localize('rockit/validation/unknown', 'Unknown');
                        const entityId = error.entityId || nls.localize('rockit/validation/unknown', 'Unknown');
                        const field = error.fieldLabel || error.fieldName || nls.localize('rockit/validation/unknownField', 'Unknown field');
                        const message = localizeValidationErrorMessage(error)
                            || nls.localize('rockit/validation/unknownError', 'Unknown error');
                        return (
                            <button
                                key={getErrorKey(error, index)}
                                type="button"
                                className="schema-validator-error-row"
                                style={{
                                    height: ERROR_ROW_HEIGHT - ERROR_ROW_GAP,
                                    transform: `translateY(${index * ERROR_ROW_HEIGHT}px)`,
                                }}
                                onClick={() => onSelect(error)}
                                disabled={!error.entityId}
                            >
                                <span className="schema-validator-error-row-top">
                                    <span className="schema-validator-error-type">{entityType}</span>
                                    <span className="schema-validator-error-id">{entityId}</span>
                                </span>
                                <span className="schema-validator-error-field" title={field}>{field}</span>
                                <span className="schema-validator-error-message" title={message}>
                                    {message}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

@injectable()
export class SchemaValidatorWidget extends ReactWidget {

    static readonly ID = 'validation-errors:widget';
    static readonly LABEL = nls.localize('rockit/validation/title', 'Validation Errors');

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
        const header = hasErrors
            ? nls.localize(
                'rockit/validation/errorCount',
                'Validation Errors ({0})',
                formatCount(errors.length),
            )
            : nls.localize('rockit/validation/noErrors', 'No validation errors');
        return (
            <div id="widget-container" className="schema-validator-widget">
                <div className="schema-validator-toolbar">
                    <AlertMessage type={hasErrors ? 'WARNING' : 'INFO'} header={header} />
                </div>
                {hasErrors && (
                    <ValidationErrorList
                        errors={errors}
                        onSelect={(error) => this.handleErrorRowClick(error)}
                    />
                )}
            </div>
        );
    }

    protected displayMessage(): void {
        this.messageService.info(
            nls.localize(
                'rockit/validation/widgetCreated',
                'Validation Errors view created successfully.',
            ),
        );
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        const htmlElement = document.getElementById('displayMessageButton');
        if (htmlElement) {
            htmlElement.focus();
        }
    }

    protected handleErrorRowClick(error: ValidationError): void {
        const entityId = error?.entityId;
        const fieldName = error?.fieldName;
        if (!entityId) {
            return;
        }
        if (this.appStateService.selectedEntityId !== entityId) {
            this.appStateService.selectedEntityId = entityId;
        }
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
                if (existingWidget instanceof RoCrateEditorWidget) {
                    await this.shell.activateWidget(existingWidgetId);
                    return existingWidget;
                }
            }

            const preferredWidget = this.getPreferredRoCrateEditorWidget();
            if (preferredWidget) {
                this.appStateService.registerEntityEditor(preferredWidget.id, entityId);
                await this.shell.activateWidget(preferredWidget.id);
                return preferredWidget;
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

    protected getPreferredRoCrateEditorWidget(): RoCrateEditorWidget | undefined {
        const active = this.shell.activeWidget ?? this.shell.currentWidget;
        if (active instanceof RoCrateEditorWidget) {
            return active;
        }

        for (const widget of this.shell.getWidgets('main')) {
            if (widget instanceof RoCrateEditorWidget) {
                return widget;
            }
        }

        return undefined;
    }

    dispose(): void {
        this.validationErrorsDisposable?.dispose();
        super.dispose();
    }

}
