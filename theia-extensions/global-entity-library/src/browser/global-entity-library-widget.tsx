import { MessageService, nls } from '@theia/core'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { ThemeService } from '@theia/core/lib/browser/theming'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { AntdThemeProvider } from 'rockit-common/lib/browser/antd-theme-provider'
import { GlobalEntityLibraryService } from './global-entity-library-service'
import { GlobalEntityLibraryTable } from './global-entity-library-table'
import type { GlobalEntityCollection, GlobalEntityRecord } from './global-entity-library-types'

@injectable()
export class GlobalEntityLibraryWidget extends ReactWidget {
    static readonly ID = 'global-entity-library:widget'
    static readonly VERSION = '1.0.0'
    static readonly LABEL = nls.localize('rockit/globalEntities/title', 'Global Entity Library')

    @inject(MessageService)
    protected readonly messageService: MessageService

    @inject(ThemeService)
    protected readonly themeService: ThemeService

    @inject(GlobalEntityLibraryService)
    protected readonly libraryService: GlobalEntityLibraryService

    protected collection: GlobalEntityCollection = {}
    protected loading = true

    @postConstruct()
    protected init(): void {
        this.id = GlobalEntityLibraryWidget.ID
        this.title.label = GlobalEntityLibraryWidget.LABEL
        this.title.caption = GlobalEntityLibraryWidget.LABEL
        this.title.closable = true
        this.title.iconClass = 'fa fa-address-book'
        this.addClass('global-entity-library-widget')
        this.toDispose.push(this.libraryService.onDidChangeCollection(collection => {
            this.collection = collection
            this.loading = false
            this.update()
        }))
        void this.loadCollection()
    }

    protected async loadCollection(): Promise<void> {
        this.loading = true
        this.update()
        try {
            this.collection = await this.libraryService.getCollection()
        } catch (error) {
            console.error('[GlobalEntityLibrary] Failed to load global entities:', error)
            this.messageService.error(nls.localize(
                'rockit/globalEntities/loadFailed',
                'Failed to load the global entity library: {0}',
                error instanceof Error ? error.message : String(error),
            ))
        } finally {
            this.loading = false
            this.update()
        }
    }

    protected readonly saveRecord = async (record: GlobalEntityRecord): Promise<void> => {
        try {
            this.collection = await this.libraryService.saveRecord(record)
            this.update()
        } catch (error) {
            this.messageService.error(nls.localize(
                'rockit/globalEntities/saveFailed',
                'Failed to save the global entity library: {0}',
                error instanceof Error ? error.message : String(error),
            ))
            throw error
        }
    }

    protected readonly deleteRecords = async (recordIds: string[]): Promise<void> => {
        if (!recordIds.length) return
        try {
            this.collection = await this.libraryService.deleteRecords(recordIds)
            this.update()
        } catch (error) {
            this.messageService.error(nls.localize(
                'rockit/globalEntities/deleteFailed',
                'Failed to delete the global entity: {0}',
                error instanceof Error ? error.message : String(error),
            ))
            throw error
        }
    }

    protected readonly deleteRecord = async (recordId: string): Promise<void> =>
        this.deleteRecords([recordId])

    protected render(): React.ReactNode {
        return <AntdThemeProvider themeService={this.themeService}>
            <GlobalEntityLibraryTable
                collection={this.collection}
                loading={this.loading}
                onSave={this.saveRecord}
                onDelete={this.deleteRecord}
                onDeleteMany={this.deleteRecords}
            />
        </AntdThemeProvider>
    }

    protected onActivateRequest(): void {
        this.node.querySelector<HTMLInputElement>('#global-entity-library-search')?.focus()
    }
}
