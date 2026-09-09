import { MessageService, nls } from '@theia/core'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { ThemeService } from '@theia/core/lib/browser/theming'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { AntdThemeProvider } from 'rockit-common/lib/browser/antd-theme-provider'
import { GlobalEntityLibraryStore, getPrimaryEntityType, sortGlobalEntityCollection } from './global-entity-library-store'
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

    @inject(GlobalEntityLibraryStore)
    protected readonly store: GlobalEntityLibraryStore

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
        void this.loadCollection()
    }

    protected async loadCollection(): Promise<void> {
        this.loading = true
        this.update()
        try {
            this.collection = await this.store.load()
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
        const next: GlobalEntityCollection = {}
        for (const [type, records] of Object.entries(this.collection)) {
            const remaining = records.filter(candidate => candidate.recordId !== record.recordId)
            if (remaining.length) next[type] = remaining
        }

        const type = getPrimaryEntityType(record.entity)
        next[type] = [...(next[type] ?? []), record]
        try {
            this.collection = await this.store.save(sortGlobalEntityCollection(next))
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

    protected readonly deleteRecord = async (recordId: string): Promise<void> => {
        const next: GlobalEntityCollection = {}
        for (const [type, records] of Object.entries(this.collection)) {
            const remaining = records
                .filter(record => record.recordId !== recordId)
                .map(record => {
                    const relationships = Object.fromEntries(
                        Object.entries(record.relationships ?? {})
                            .map(([property, targets]) => [
                                property,
                                targets.filter(target => target !== recordId),
                            ])
                            .filter(([, targets]) => (targets as string[]).length),
                    )
                    return { ...record, relationships }
                })
            if (remaining.length) next[type] = remaining
        }

        try {
            this.collection = await this.store.save(next)
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

    protected render(): React.ReactNode {
        return <AntdThemeProvider themeService={this.themeService}>
            <GlobalEntityLibraryTable
                collection={this.collection}
                loading={this.loading}
                onSave={this.saveRecord}
                onDelete={this.deleteRecord}
            />
        </AntdThemeProvider>
    }

    protected onActivateRequest(): void {
        this.node.querySelector<HTMLInputElement>('#global-entity-library-search')?.focus()
    }
}
