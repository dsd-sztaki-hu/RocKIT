// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import UploadFileIcon from '@mui/icons-material/UploadFile'
import { MessageService, nls } from '@theia/core'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { ThemeService } from '@theia/core/lib/browser/theming'
import URI from '@theia/core/lib/common/uri'
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { Message } from '@lumino/messaging'
import { AntdThemeProvider } from 'rockit-common/lib/browser/antd-theme-provider'
import { CrosswalkTable } from './components/crosswalk-table'
import { CrosswalkRegistryService } from './crosswalk-registry-service'
import { CrosswalkRegistryEntry } from './crosswalk-manager-types'

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

@injectable()
export class CrosswalkManagerWidget extends ReactWidget {
    static readonly ID = 'crosswalk-manager:widget'
    static readonly LABEL = nls.localize('rockit/crosswalkManager/title', 'Crosswalk Manager')

    @inject(MessageService)
    protected readonly messageService: MessageService

    @inject(ThemeService)
    protected readonly themeService: ThemeService

    @inject(FileDialogService)
    protected readonly fileDialogService: FileDialogService

    @inject(CrosswalkRegistryService)
    protected readonly registryService: CrosswalkRegistryService

    protected entries: CrosswalkRegistryEntry[] = []
    protected loading = true
    protected importing = false
    protected deletingId?: string

    @postConstruct()
    protected init(): void {
        this.id = CrosswalkManagerWidget.ID
        this.title.label = CrosswalkManagerWidget.LABEL
        this.title.caption = CrosswalkManagerWidget.LABEL
        this.title.closable = true
        this.title.iconClass = 'fa fa-random'
        this.addClass('crosswalk-manager-widget')
        this.toDispose.push(this.registryService.onDidChange(entries => {
            this.entries = entries
            this.update()
        }))
        void this.loadEntries()
    }

    protected async loadEntries(): Promise<void> {
        this.loading = true
        this.update()
        try {
            this.entries = await this.registryService.list()
        } catch (error) {
            console.error('[CrosswalkManager] Failed to load crosswalks:', error)
            this.messageService.error(nls.localize(
                'rockit/crosswalkManager/loadFailed',
                'Failed to load the crosswalk registry: {0}',
                messageOf(error),
            ))
        } finally {
            this.loading = false
            this.update()
        }
    }

    protected readonly importCrosswalks = async (): Promise<void> => {
        const selected = await this.fileDialogService.showOpenDialog({
            title: nls.localize('rockit/crosswalkManager/import', 'Import Crosswalk'),
            filters: { JSON: ['json'] },
            canSelectFiles: true,
            canSelectMany: true,
        })
        if (!selected) return

        const uris: URI[] = Array.isArray(selected) ? selected : [selected]
        this.importing = true
        this.update()
        let imported = 0
        const failures: string[] = []
        for (const uri of uris) {
            try {
                await this.registryService.importFile(uri)
                imported += 1
            } catch (error) {
                failures.push(`${uri.path.base}: ${messageOf(error)}`)
            }
        }
        this.importing = false
        this.update()

        if (imported) {
            this.messageService.info(nls.localize(
                'rockit/crosswalkManager/importedCount',
                'Successfully imported {0} crosswalk(s).',
                imported,
            ))
        }
        for (const failure of failures) {
            this.messageService.error(nls.localize(
                'rockit/crosswalkManager/importFailed',
                'Failed to import crosswalk: {0}',
                failure,
            ))
        }
    }

    protected readonly deleteCrosswalk = async (entry: CrosswalkRegistryEntry): Promise<void> => {
        this.deletingId = entry.id
        this.update()
        try {
            await this.registryService.delete(entry.id)
            this.messageService.info(nls.localize(
                'rockit/crosswalkManager/deleted',
                'Deleted crosswalk \"{0}\".',
                entry.name,
            ))
        } catch (error) {
            this.messageService.error(nls.localize(
                'rockit/crosswalkManager/deleteFailed',
                'Failed to delete crosswalk: {0}',
                messageOf(error),
            ))
        } finally {
            this.deletingId = undefined
            this.update()
        }
    }

    protected render(): React.ReactNode {
        return <AntdThemeProvider themeService={this.themeService}>
            <div className='crosswalk-manager-content'>
                <div className='crosswalk-manager-toolbar'>
                    <span className='crosswalk-manager-toolbar-spacer' />
                    <button
                        className='crosswalk-manager-import-button'
                        disabled={this.importing}
                        onClick={this.importCrosswalks}
                    >
                        <span className='crosswalk-manager-button-icon'>
                            <UploadFileIcon fontSize='small' />
                        </span>
                        {nls.localize('rockit/crosswalkManager/import', 'Import Crosswalk')}
                    </button>
                </div>
                <CrosswalkTable
                    crosswalks={this.entries}
                    isLoading={this.loading}
                    deletingId={this.deletingId}
                    onDelete={this.deleteCrosswalk}
                />
            </div>
        </AntdThemeProvider>
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg)
        void this.loadEntries()
    }
}
