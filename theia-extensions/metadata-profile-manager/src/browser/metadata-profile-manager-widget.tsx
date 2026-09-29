// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// src/browser/metadata-profile-manager-widget.tsx

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

import { ProfileManagerService } from './services/metadata-profile-manager-service'
import { MetadataSchemaTable } from './components/metadata-schema-table'
import { MetadataSchemaToolbar } from './components/metadata-schema-toolbar'
import { RemoteSchemaProviderListDialog } from './components/remote-schema-provider-list-dialog'
import { RemoteSchemaProviderSelectorDialog } from './components/remote-schema-provider-selector-dialog'
import { MetadataSchemaImportFromUrlDialog } from './components/metadata-schema-import-from-url-dialog'
import { DeleteConfirmationDialog } from './components/delete-confirmation-dialog'
import type { ProfileInfo } from './types'
import { AntdThemeProvider } from 'rockit-common/lib/browser/antd-theme-provider'
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service'

import './styles/index.css'

export const METADATA_PROFILE_MANAGER_WIDGET_ID = 'metadata-profile-manager'
export const METADATA_PROFILE_MANAGER_LABEL = nls.localize(
    'rockit/profileManager/title',
    'Metadata Profile Manager',
)

const MSG_TIMEOUT = 5000

@injectable()
export class MetadataProfileManagerWidget extends BaseWidget implements StatefulWidget {
    static readonly ID = METADATA_PROFILE_MANAGER_WIDGET_ID
    static readonly LABEL = METADATA_PROFILE_MANAGER_LABEL

    protected profiles: ProfileInfo[] = []
    protected isLoading = true
    protected selectedSchemaKeys: Key[] = []

    private reactRoot: Root | undefined
    protected lastFocusedElement: HTMLElement | undefined

    constructor(
        @inject(FileDialogService) protected readonly fileDialogService: FileDialogService,
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer,
        @inject(ProfileManagerService) protected readonly profileManagerService: ProfileManagerService,
        @inject(ThemeService) protected readonly themeService: ThemeService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(LoadMaskService) protected readonly loadMaskService: LoadMaskService,
    ) {
        super()

        this.id = METADATA_PROFILE_MANAGER_WIDGET_ID
        this.title.label = METADATA_PROFILE_MANAGER_LABEL
        this.title.caption = METADATA_PROFILE_MANAGER_LABEL
        this.title.closable = true
        this.title.iconClass = 'fa fa-table'
        this.node.tabIndex = 0

        this.toDispose.push(this.profileManagerService.onDidChangeProfiles(() => this.loadProfiles()))
    }

    protected async loadProfiles(): Promise<void> {
        this.isLoading = true
        const currentSelection = [...this.selectedSchemaKeys];
        this.update()

        try {
            this.profiles = await this.profileManagerService.loadAllProfiles()
            this.selectedSchemaKeys = currentSelection.filter(key => 
                this.profiles.some(profile => profile.id === key)
            );
        } catch (err) {
            this.messageService.error(
                nls.localize(
                    'rockit/profileManager/loadFailed',
                    'Error loading profiles: {0}',
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

    protected async deleteProfiles(ids: string[]): Promise<void> {
        if (ids.length === 0) return

        const hasPersistedItems = this.profiles
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
            const deletedCount = await this.profileManagerService.deleteProfiles(ids)
            if (deletedCount > 0) {
                const message = hasPersistedItems
                    ? nls.localize(
                        'rockit/profileManager/deletedCount',
                        'Deleted {0} profile(s).',
                        deletedCount,
                    )
                    : nls.localize(
                        'rockit/profileManager/abortedCount',
                        'Aborted {0} task(s).',
                        deletedCount,
                    );
                this.messageService.info(message, { timeout: MSG_TIMEOUT })
            }
        } catch (err) {
            console.error('Failed to delete profiles:', err)
            this.messageService.error(
                nls.localize('rockit/profileManager/deleteFailed', 'Failed to delete profiles.'),
                { timeout: MSG_TIMEOUT },
            )
        } finally {
            this.isLoading = false
            this.update()
        }
    }

    protected async importProfileFromFile(): Promise<void> {
        const fileUriOrUris = await this.fileDialogService.showOpenDialog({
            title: nls.localize('rockit/profileManager/importSchema', 'Import Profile'),
            filters: { JSON: ['json'] },
            canSelectFiles: true,
            canSelectMany: true,
        })

        if (!fileUriOrUris) return
        const fileUris: URI[] = Array.isArray(fileUriOrUris) ? fileUriOrUris : [fileUriOrUris]

        this.loadMaskService
            .showProgress({
                text: nls.localize('rockit/profileManager/importingSchemas', 'Importing Profiles...'),
            })
            .then(async (progress) => {
                try {
                    const results = await this.profileManagerService.importFiles(fileUris, progress)

                    if (results.success > 0) {
                        this.messageService.info(nls.localize(
                            'rockit/profileManager/importedCount',
                            'Successfully imported {0} profile(s).',
                            results.success,
                        ), {
                            timeout: MSG_TIMEOUT,
                        })
                    }
                    if (results.fail > 0) {
                        this.messageService.warn(nls.localize(
                            'rockit/profileManager/importFailedCount',
                            'Failed to import {0} profile(s).',
                            results.fail,
                        ), {
                            timeout: MSG_TIMEOUT,
                        })
                    }
                } catch (err) {
                    console.error(err)
                    this.messageService.error(
                        nls.localize(
                            'rockit/profileManager/unexpectedImportError',
                            'Unexpected error during import.',
                        ),
                        { timeout: MSG_TIMEOUT },
                    )
                } finally {
                    progress.cancel()
                }
            })
    }

    protected async importProfileFromUrl(): Promise<void> {
        const dialog = new MetadataSchemaImportFromUrlDialog()
        const url = await dialog.open()
        if (url) {
            await this.handleImportUrl(url)
        }
    }

    protected async handleImportUrl(url: string): Promise<void> {
        this.loadMaskService
            .showProgress({
                text: nls.localize('rockit/profileManager/importingFromUrl', 'Importing from URL...'),
            })
            .then(async (progress) => {
                try {
                    const profileName = await this.profileManagerService.importFromUrl(url, progress)
                    this.messageService.info(nls.localize(
                        'rockit/profileManager/importedName',
                        'Successfully imported: {0}',
                        profileName,
                    ), { timeout: MSG_TIMEOUT })
                } catch (error: any) {
                    if (error.message !== 'Aborted') {
                        this.messageService.error(
                            nls.localize(
                                'rockit/profileManager/importFailed',
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

    protected async refreshProfiles(): Promise<void> {
        this.profileManagerService.clearFailedPendingProfiles();
        await this.loadProfiles()
    }

    protected async openProviderList(): Promise<void> {
        const dialog = new RemoteSchemaProviderListDialog(
            this.profileManagerService.providerStoreService,
        )
        await dialog.open()
    }

    protected async browseRemoteProfiles(): Promise<void> {
        const dialog = new RemoteSchemaProviderSelectorDialog(
            this.profileManagerService.providerStoreService,
        )
        const provider = await dialog.open()
        if (provider) {
            await this.profileManagerService.browseRemoteProfiles(provider)
        }
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg)
        this.node.addEventListener('focusin', this.handleFocusIn, true)
        this.node.addEventListener('mousedown', this.handleMouseDown, true)
        this.node.innerHTML = ''
        this.render()
        this.loadProfiles()
    }

    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg)
        this.render()
    }

    protected render(): void {
        if (!this.isAttached) return

        this.node.classList.add('metadata-profile-manager-widget')

        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.node)
        }

        const selectedSchemaIds = this.selectedSchemaKeys as string[];

        this.reactRoot.render(
            <AntdThemeProvider themeService={this.themeService}>
                <div className="metadata-schema-layout-container">
                    <MetadataSchemaToolbar
                        onImportFile={() => this.importProfileFromFile()}
                        onImportUrl={() => this.importProfileFromUrl()}
                        onBrowse={() => this.browseRemoteProfiles()}
                        onRefresh={() => this.refreshProfiles()}
                        onDelete={() => this.deleteProfiles(selectedSchemaIds)}
                        onConfigureProviders={() => this.openProviderList()}
                        selectedCount={this.selectedSchemaKeys.length}
                    />

                    <div className="metadata-schema-table-wrapper">
                        <MetadataSchemaTable
                            profiles={this.profiles}
                            isLoading={this.isLoading}
                            selectionType="checkbox"
                            selectedKeys={this.selectedSchemaKeys}
                            allowDeleteValidSchemas={true}
                            onSelectionChange={this.onSelectionChange}
                            onDelete={(ids) => this.deleteProfiles(ids)}
                            onRetry={(id) => this.profileManagerService.retryProfile(id)}
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
