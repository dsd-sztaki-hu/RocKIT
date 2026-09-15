// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

// src/browser/metadata-schema-manager-widget.tsx

import { BaseWidget } from '@theia/core/lib/browser'
import { ApplicationShell } from '@theia/core/lib/browser'
import type { Message, StatefulWidget } from '@theia/core/lib/browser'
import { ThemeService } from '@theia/core/lib/browser/theming'
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables'
import { MessageService } from '@theia/core/lib/common/message-service'
import { nls } from '@theia/core/lib/common/nls'
import { URI } from '@theia/core/lib/common/uri'
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog'
import type { Key } from 'antd/es/table/interface'
import { inject, injectable } from 'inversify'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'

import { SchemaManagerService } from './services/metadata-schema-manager-service'
import { MetadataSchemaTable } from './components/metadata-schema-table'
import { MetadataSchemaToolbar } from './components/metadata-schema-toolbar'
import { RemoteSchemaProviderListDialog } from './components/remote-schema-provider-list-dialog'
import { RemoteSchemaProviderSelectorDialog } from './components/remote-schema-provider-selector-dialog'
import { MetadataSchemaImportFromUrlDialog } from './components/metadata-schema-import-from-url-dialog'
import { DeleteConfirmationDialog } from './components/delete-confirmation-dialog'
import type { SchemaInfo } from './types'
import { AntdThemeProvider } from 'rockit-common/lib/browser/antd-theme-provider'
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service'

import './styles/index.css'

export const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager'
export const METADATA_SCHEMA_MANAGER_LABEL = nls.localize(
    'rockit/schemaManager/title',
    'Metadata Schema Manager',
)

const MSG_TIMEOUT = 5000

@injectable()
export class MetadataSchemaManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = METADATA_SCHEMA_MANAGER_WIDGET_ID
    static readonly LABEL = METADATA_SCHEMA_MANAGER_LABEL

    protected schemas: SchemaInfo[] = []
    protected isLoading = true
    protected selectedSchemaKeys: Key[] = []

    private reactRoot: Root | undefined
    protected lastFocusedElement: HTMLElement | undefined

    constructor(
        @inject(FileDialogService) protected readonly fileDialogService: FileDialogService,
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer,
        @inject(SchemaManagerService) protected readonly schemaManagerService: SchemaManagerService,
        @inject(ThemeService) protected readonly themeService: ThemeService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(LoadMaskService) protected readonly loadMaskService: LoadMaskService,
    ) {
        super()

        this.id = METADATA_SCHEMA_MANAGER_WIDGET_ID
        this.title.label = METADATA_SCHEMA_MANAGER_LABEL
        this.title.caption = METADATA_SCHEMA_MANAGER_LABEL
        this.title.closable = true
        this.title.iconClass = 'fa fa-table'
        this.node.tabIndex = 0

        this.toDispose.push(this.schemaManagerService.onDidChangeSchemas(() => this.loadSchemas()))
    }

    protected async loadSchemas(): Promise<void> {
        this.isLoading = true
        const currentSelection = [...this.selectedSchemaKeys];
        this.update()

        try {
            this.schemas = await this.schemaManagerService.loadAllSchemas()
            this.selectedSchemaKeys = currentSelection.filter(key => 
                this.schemas.some(s => s.id === key)
            );
        } catch (err) {
            this.messageService.error(
                nls.localize(
                    'rockit/schemaManager/loadFailed',
                    'Error loading schemas: {0}',
                    err instanceof Error ? err.message : String(err),
                ),
                { timeout: MSG_TIMEOUT },
            )
        } finally {
            this.isLoading = false
            this.update()
        }
    }

    protected onSelectionChange = (selectedRowKeys: Key[]): void => {
        this.selectedSchemaKeys = selectedRowKeys
        this.update()
    }

    protected async deleteSchemas(ids: string[]): Promise<void> {
        if (ids.length === 0) return

        const hasPersistedItems = this.schemas
            .filter(s => ids.includes(s.id))
            .some(s => s.status === 'ok');

        if (hasPersistedItems) {
            const dialog = new DeleteConfirmationDialog(ids.length)
            const confirmed = await dialog.open()
            if (!confirmed) return
        }

        this.isLoading = true
        this.update()

        try {
            const deletedCount = await this.schemaManagerService.deleteSchemas(ids)
            if (deletedCount > 0) {
                const message = hasPersistedItems
                    ? nls.localize(
                        'rockit/schemaManager/deletedCount',
                        'Deleted {0} schema(s).',
                        deletedCount,
                    )
                    : nls.localize(
                        'rockit/schemaManager/abortedCount',
                        'Aborted {0} task(s).',
                        deletedCount,
                    );
                this.messageService.info(message, { timeout: MSG_TIMEOUT })
            }
        } catch (err) {
            console.error('Failed to delete schemas:', err)
            this.messageService.error(
                nls.localize('rockit/schemaManager/deleteFailed', 'Failed to delete schemas.'),
                { timeout: MSG_TIMEOUT },
            )
        } finally {
            this.isLoading = false
            this.update()
        }
    }

    protected async importSchemaFromFile(): Promise<void> {
        const fileUriOrUris = await this.fileDialogService.showOpenDialog({
            title: nls.localize('rockit/schemaManager/importSchema', 'Import Schema'),
            filters: { JSON: ['json'] },
            canSelectFiles: true,
            canSelectMany: true,
        })

        if (!fileUriOrUris) return
        const fileUris: URI[] = Array.isArray(fileUriOrUris) ? fileUriOrUris : [fileUriOrUris]

        this.loadMaskService
            .showProgress({
                text: nls.localize('rockit/schemaManager/importingSchemas', 'Importing Schemas...'),
            })
            .then(async (progress) => {
                try {
                    const results = await this.schemaManagerService.importFiles(fileUris, progress)

                    if (results.success > 0) {
                        this.messageService.info(nls.localize(
                            'rockit/schemaManager/importedCount',
                            'Successfully imported {0} schema(s).',
                            results.success,
                        ), {
                            timeout: MSG_TIMEOUT,
                        })
                    }
                    if (results.fail > 0) {
                        this.messageService.warn(nls.localize(
                            'rockit/schemaManager/importFailedCount',
                            'Failed to import {0} schema(s).',
                            results.fail,
                        ), {
                            timeout: MSG_TIMEOUT,
                        })
                    }
                } catch (err) {
                    console.error(err)
                    this.messageService.error(
                        nls.localize(
                            'rockit/schemaManager/unexpectedImportError',
                            'Unexpected error during import.',
                        ),
                        { timeout: MSG_TIMEOUT },
                    )
                } finally {
                    progress.cancel()
                }
            })
    }

    protected async importSchemaFromUrl(): Promise<void> {
        const dialog = new MetadataSchemaImportFromUrlDialog()
        const url = await dialog.open()
        if (url) {
            await this.handleImportUrl(url)
        }
    }

    protected async handleImportUrl(url: string): Promise<void> {
        this.loadMaskService
            .showProgress({
                text: nls.localize('rockit/schemaManager/importingFromUrl', 'Importing from URL...'),
            })
            .then(async (progress) => {
                try {
                    const schemaName = await this.schemaManagerService.importFromUrl(url, progress)
                    this.messageService.info(nls.localize(
                        'rockit/schemaManager/importedName',
                        'Successfully imported: {0}',
                        schemaName,
                    ), { timeout: MSG_TIMEOUT })
                } catch (error: any) {
                    if (error.message !== 'Aborted') {
                        this.messageService.error(
                            nls.localize(
                                'rockit/schemaManager/importFailed',
                                'Import failed: {0}',
                                error instanceof Error ? error.message : String(error),
                            ),
                            { timeout: MSG_TIMEOUT },
                        )
                    }
                } finally {
                    progress.cancel()
                }
            })
    }

    protected async refreshSchemas(): Promise<void> {
        this.schemaManagerService.clearFailedPendingSchemas();
        await this.loadSchemas()
    }

    protected async openProviderList(): Promise<void> {
        const dialog = new RemoteSchemaProviderListDialog(
            this.schemaManagerService.providerStoreService,
        )
        await dialog.open()
    }

    protected async browseRemoteSchemas(): Promise<void> {
        const dialog = new RemoteSchemaProviderSelectorDialog(
            this.schemaManagerService.providerStoreService,
        )
        const provider = await dialog.open()
        if (provider) {
            await this.schemaManagerService.browseRemoteSchemas(provider)
        }
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg)
        this.node.addEventListener('focusin', this.handleFocusIn, true)
        this.node.addEventListener('mousedown', this.handleMouseDown, true)
        this.node.innerHTML = ''
        this.render()
        this.loadSchemas()
    }

    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg)
        this.render()
    }

    protected render(): void {
        if (!this.isAttached) return

        this.node.classList.add('metadata-schema-manager-widget')

        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.node)
        }

        const selectedSchemaIds = this.selectedSchemaKeys as string[];

        this.reactRoot.render(
            <AntdThemeProvider themeService={this.themeService}>
                <div className="metadata-schema-layout-container">
                    <MetadataSchemaToolbar
                        onImportFile={() => this.importSchemaFromFile()}
                        onImportUrl={() => this.importSchemaFromUrl()}
                        onBrowse={() => this.browseRemoteSchemas()}
                        onRefresh={() => this.refreshSchemas()}
                        onDelete={() => this.deleteSchemas(selectedSchemaIds)}
                        onConfigureProviders={() => this.openProviderList()}
                        selectedCount={this.selectedSchemaKeys.length}
                    />

                    <div className="metadata-schema-table-wrapper">
                        <MetadataSchemaTable
                            schemas={this.schemas}
                            isLoading={this.isLoading}
                            selectionType="checkbox"
                            selectedKeys={this.selectedSchemaKeys}
                            allowDeleteValidSchemas={true}
                            onSelectionChange={this.onSelectionChange}
                            onDelete={(ids) => this.deleteSchemas(ids)}
                            onRetry={(id) => this.schemaManagerService.retrySchema(id)}
                        />
                    </div>

                </div>
            </AntdThemeProvider>,
        )
    }

    protected onBeforeDetach(msg: Message): void {
        this.node.removeEventListener('focusin', this.handleFocusIn, true)
        this.node.removeEventListener('mousedown', this.handleMouseDown, true)
        if (this.reactRoot) {
            this.reactRoot.unmount()
            this.reactRoot = undefined
        }
        super.onBeforeDetach(msg)
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg)
        if (this.lastFocusedElement && this.node.contains(this.lastFocusedElement)) {
            this.lastFocusedElement.focus()
            return
        }
        this.node.focus()
    }

    protected readonly handleFocusIn = (event: FocusEvent): void => {
        const target = event.target
        if (target instanceof HTMLElement) {
            this.lastFocusedElement = target
        }
        if (this.shell.currentWidget?.id !== this.id) {
            void this.shell.activateWidget(this.id)
        }
    }

    protected readonly handleMouseDown = (_event: MouseEvent): void => {
        if (this.shell.currentWidget?.id !== this.id) {
            void this.shell.activateWidget(this.id)
        }
    }

    storeState(): object {
        return {}
    }
    restoreState(): void {}
}
