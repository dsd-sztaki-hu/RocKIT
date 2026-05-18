import { MenuPath } from '@theia/core'
import {
    ApplicationShell,
    CompositeTreeNode,
    ContextMenuRenderer,
    NodeProps,
    SelectableTreeNode,
    TreeModel,
    TreeNode,
    TreeProps,
    TreeWidget,
    Widget,
    WidgetManager,
    codicon,
} from '@theia/core/lib/browser'
import { ThemeService } from '@theia/core/lib/browser/theming'
import { FOCUS_CLASS, SELECTED_CLASS } from '@theia/core/lib/browser/widgets'
import { Disposable } from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'
import * as React from '@theia/core/shared/react'
import { Button, Select } from 'antd'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import {
    MetadataSchemaManager,
    RoCrateEntityDeleteService,
} from 'aroma2-common/lib/browser'
import { AntdThemeProvider } from 'aroma2-common/lib/browser/antd-theme-provider'
import { MultiEditDialogService } from 'multi-edit/lib/browser/multi-edit-dialog-service'
import * as mime from 'mime-types'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'
import '../../src/browser/styles/entities-overview-widget.css'
import { AdvancedFiltersDialog } from './entities-overview-advanced-filters-dialog'
import {
    AdvancedEntityMatcher,
    ALL_ENTITY_TYPES_OPTION,
    AdvancedFilterState,
    buildAdvancedEntityMatcher,
    buildAdvancedFilterCatalog,
    countActiveAdvancedRules,
} from './entities-overview-advanced-filtering'
import {
    EntitiesOverviewModel,
    ExampleTreeLeaf,
    ExampleTreeNode,
    ValidityFilter,
} from './entities-overview-model'

export const TREEVIEW_EXAMPLE_CONTEXT_MENU: MenuPath = [
    'theia-examples:treeview-example-context-menu',
]

type PersistedEntityFilters = {
    entityNameFilter: string
    selectedTypeFilters: string[]
    validityFilter: ValidityFilter
}

type EntitiesOverviewWidgetState = {
    version: 2
    filtersVisible?: boolean
    filterMode?: 'simple' | 'advanced'
    simpleFilters?: PersistedEntityFilters
    advancedFilters?: PersistedEntityFilters
}

type EntityOverviewDragPayload = {
    entityIds?: string[]
    entityNames?: string[]
    entityTypes?: string[][]
    source: 'entities-overview'
}

@injectable()
export class EntitiesOverviewWidget extends TreeWidget {
    static readonly ID = 'theia-examples:treeview-example-view'
    static readonly LABEL = 'Entities'
    static readonly STATE_VERSION = 2
    static readonly MAX_PERSISTED_STATE_BYTES = 16 * 1024
    static readonly MAX_FILTER_TEXT_LENGTH = 1024
    static readonly MAX_SELECTED_TYPES = 200
    static readonly MAX_TYPE_LABEL_LENGTH = 256
    static readonly ROOT_DATASET_ENTITY_ID = './'
    private static readonly ARCHIVE_FILE_SUFFIXES = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst']
    private static readonly ARCHIVE_EXTENSIONS = new Set([
        '.zip',
        '.gz',
        '.bz2',
        '.xz',
        '.zst',
        '.7z',
        '.rar',
        '.tgz',
        '.tar',
        '.jar',
        '.war',
    ])
    private static readonly MEDIA_EXTENSIONS = new Set([
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        '.svg',
        '.bmp',
        '.ico',
        '.tif',
        '.tiff',
        '.mp4',
        '.m4v',
        '.mov',
        '.avi',
        '.mkv',
        '.webm',
        '.mp3',
        '.wav',
        '.flac',
        '.ogg',
        '.m4a',
    ])
    private static readonly DOCUMENT_EXTENSIONS = new Set([
        '.md',
        '.mdx',
        '.rst',
        '.adoc',
        '.rtf',
    ])
    private static readonly DATA_EXTENSIONS = new Set([
        '.json',
        '.jsonc',
        '.yaml',
        '.yml',
        '.toml',
        '.xml',
        '.xsd',
        '.xsl',
        '.csv',
        '.tsv',
    ])
    private static readonly CODE_EXTENSIONS = new Set([
        '.c',
        '.cc',
        '.cpp',
        '.cxx',
        '.h',
        '.hh',
        '.hpp',
        '.hxx',
        '.java',
        '.kt',
        '.kts',
        '.scala',
        '.go',
        '.rs',
        '.swift',
        '.cs',
        '.php',
        '.py',
        '.rb',
        '.lua',
        '.pl',
        '.r',
        '.dart',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
        '.ts',
        '.tsx',
        '.vue',
        '.svelte',
        '.html',
        '.htm',
        '.css',
        '.scss',
        '.sass',
        '.less',
    ])
    private static readonly SCRIPT_EXTENSIONS = new Set([
        '.sh',
        '.bash',
        '.zsh',
        '.fish',
        '.ps1',
        '.psm1',
        '.bat',
        '.cmd',
    ])
    private static readonly DATABASE_EXTENSIONS = new Set([
        '.sql',
        '.sqlite',
        '.sqlite3',
        '.db',
        '.duckdb',
    ])
    private static readonly CONFIG_EXTENSIONS = new Set([
        '.ini',
        '.conf',
        '.config',
        '.cfg',
        '.properties',
        '.env',
        '.editorconfig',
    ])
    private static readonly CONFIG_FILE_NAMES = new Set([
        '.env',
        '.env.local',
        '.env.development',
        '.env.production',
        '.gitignore',
        '.gitattributes',
        '.npmrc',
        '.yarnrc',
        '.editorconfig',
        '.prettierrc',
        '.eslintrc',
        'dockerfile',
        'compose.yml',
        'compose.yaml',
        'docker-compose.yml',
        'docker-compose.yaml',
        'makefile',
    ])
    private static readonly FOLDER_MEDIA_NAMES = new Set([
        'images',
        'image',
        'img',
        'media',
        'assets',
        'videos',
        'video',
        'audio',
        'icons',
    ])
    private static readonly FOLDER_CODE_NAMES = new Set([
        'src',
        'source',
        'js',
        'javascript',
        'ts',
        'typescript',
        'scripts',
        'script',
        'lib',
        'app',
        'apps',
        'components',
    ])
    private static readonly FOLDER_DOC_NAMES = new Set(['docs', 'doc', 'documentation'])
    private static readonly FOLDER_DATA_NAMES = new Set([
        'data',
        'datasets',
        'dataset',
        'db',
        'database',
        'schemas',
        'schema',
    ])
    private static readonly FOLDER_CONFIG_NAMES = new Set([
        'config',
        'configs',
        'settings',
        '.github',
        '.gitlab',
        '.vscode',
    ])
    private static readonly FOLDER_PACKAGE_NAMES = new Set([
        'node_modules',
        'vendor',
        'packages',
        'plugins',
        'extensions',
    ])
    private static readonly FOLDER_TEST_NAMES = new Set([
        'test',
        'tests',
        '__tests__',
        'spec',
        'specs',
    ])

    constructor(
        @inject(TreeProps) public override readonly props: TreeProps,
        @inject(TreeModel) public override readonly model: EntitiesOverviewModel,
        @inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer,
        @inject(AppStateService) private readonly appStateService: AppStateService,
        @inject(RoCrateHistoryService)
        private readonly roCrateHistoryService: RoCrateHistoryService,
        @inject(MetadataSchemaManager)
        private readonly schemaManagerService: MetadataSchemaManager,
        @inject(RoCrateEntityDeleteService)
        private readonly roCrateEntityDeleteService: RoCrateEntityDeleteService,
        @inject(WidgetManager) private readonly widgetManager: WidgetManager,
        @inject(ApplicationShell) private readonly shell: ApplicationShell,
        @inject(ThemeService) private readonly themeService: ThemeService,
        @inject(MultiEditDialogService)
        private readonly multiEditDialogService: MultiEditDialogService,
    ) {
        super(props, model, contextMenuRenderer)
        this.shouldScrollToRow = false

        this.id = EntitiesOverviewWidget.ID
        this.title.label = EntitiesOverviewWidget.LABEL
        this.title.caption = EntitiesOverviewWidget.LABEL
        this.title.closable = true
        this.title.iconClass = 'fa fa-list-ul'

        this.addClass('entities-overview-panel')
        this.filtersVisible = this.appStateService.entitiesOverviewFiltersVisible
        this.syncFiltersVisibleBodyClass()

        this.toDispose.push(
            Disposable.create(() => {
                document.body.classList.remove(this.filtersVisibleBodyClass)
            }),
        )

        this.toDispose.push(
            this.shell.onDidChangeCurrentWidget(({ newValue }) => {
                if (newValue && this.isRoCrateEditorWidget(newValue)) {
                    this.markEditorFocused(newValue.id)
                }
            }),
        )
    }

    protected readonly openingEntities = new Set<string>()

    protected readonly simpleFilters = {
        entityNameFilter: '',
        selectedTypeFilters: [] as string[],
        validityFilter: 'all' as ValidityFilter,
    }

    protected readonly advancedFilters = {
        entityNameFilter: '',
        selectedTypeFilters: [] as string[],
        validityFilter: 'all' as ValidityFilter,
    }

    protected filterMode: 'simple' | 'advanced' = 'simple'
    protected readonly entityNameInputRef = React.createRef<HTMLInputElement>()
    protected entityNameSelection:
        | { start: number | null; end: number | null }
        | undefined

    protected filtersVisible = true
    protected readonly filtersVisibleBodyClass = 'entities-overview-filters-visible'
    protected readonly editorFocusOrder: string[] = []
    protected advancedFilterState: AdvancedFilterState | undefined
    protected advancedEntityMatcher: AdvancedEntityMatcher | undefined
    protected advancedRuleCount = 0

    protected override renderIcon(node: TreeNode, props: NodeProps): React.ReactNode {
        const entityIcon = this.getEntityIconClass(node)
        if (entityIcon) {
            return <div className={entityIcon}></div>
        }

        const icon = this.getIconClass(this.toNodeIcon(node))
        if (icon) {
            return <div className={icon}></div>
        }
        return super.renderIcon(node, props)
    }

    protected getEntityIconClass(node: TreeNode): string | undefined {
        if (!ExampleTreeLeaf.is(node)) {
            return undefined
        }

        const types = node.data.entityTypes ?? []
        if (this.hasEntityType(types, 'Dataset')) {
            return this.getDatasetIconClass(node.data.name, node.data.entityId ?? '')
        }
        if (this.hasEntityType(types, 'File')) {
            return this.getFileIconClass(
                node.data.name,
                node.data.entityId ?? '',
                node.data.encodingFormat,
            )
        }

        return undefined
    }

    protected hasEntityType(types: string[], target: string): boolean {
        return types.some((type) => type === target || type.endsWith(`/${target}`))
    }

    protected getDatasetIconClass(displayName: string, entityId: string): string {
        const folderName = this.getEntityNameCandidate(displayName, entityId).toLowerCase()
        const folderGlyph = codicon('folder')
        if (!folderName) {
            return `${folderGlyph} entities-overview-entity-icon entities-overview-folder-icon`
        }

        if (EntitiesOverviewWidget.FOLDER_MEDIA_NAMES.has(folderName)) {
            return `${folderGlyph} entities-overview-entity-icon entities-overview-folder-icon entities-overview-folder-icon--media`
        }
        if (EntitiesOverviewWidget.FOLDER_CODE_NAMES.has(folderName)) {
            return `${folderGlyph} entities-overview-entity-icon entities-overview-folder-icon entities-overview-folder-icon--code`
        }
        if (EntitiesOverviewWidget.FOLDER_DOC_NAMES.has(folderName)) {
            return `${folderGlyph} entities-overview-entity-icon entities-overview-folder-icon entities-overview-folder-icon--document`
        }
        if (EntitiesOverviewWidget.FOLDER_DATA_NAMES.has(folderName)) {
            return `${folderGlyph} entities-overview-entity-icon entities-overview-folder-icon entities-overview-folder-icon--data`
        }
        if (EntitiesOverviewWidget.FOLDER_CONFIG_NAMES.has(folderName)) {
            return `${folderGlyph} entities-overview-entity-icon entities-overview-folder-icon entities-overview-folder-icon--config`
        }
        if (EntitiesOverviewWidget.FOLDER_PACKAGE_NAMES.has(folderName)) {
            return `${folderGlyph} entities-overview-entity-icon entities-overview-folder-icon entities-overview-folder-icon--package`
        }
        if (EntitiesOverviewWidget.FOLDER_TEST_NAMES.has(folderName)) {
            return `${folderGlyph} entities-overview-entity-icon entities-overview-folder-icon entities-overview-folder-icon--test`
        }

        return `${folderGlyph} entities-overview-entity-icon entities-overview-folder-icon`
    }

    protected getFileIconClass(
        displayName: string,
        entityId: string,
        encodingFormat?: string,
    ): string {
        const fileName = this.getEntityNameCandidate(displayName, entityId).toLowerCase()
        const ext = this.resolveEntityFileExtension(fileName, encodingFormat)
        const normalizedEncoding = `${encodingFormat ?? ''}`.trim().toLowerCase()

        if (
            normalizedEncoding.startsWith('image/') ||
            normalizedEncoding.startsWith('video/') ||
            normalizedEncoding.startsWith('audio/')
        ) {
            return `${codicon('file-media')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--media`
        }

        if (normalizedEncoding === 'text/plain' || normalizedEncoding.startsWith('text/plain;')) {
            return `${codicon('file-text')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--text`
        }

        if (ext === '.pdf') {
            return `${codicon('file-pdf')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--document`
        }
        if (ext === '.txt') {
            return `${codicon('file-text')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--text`
        }
        if (
            EntitiesOverviewWidget.ARCHIVE_EXTENSIONS.has(ext) ||
            EntitiesOverviewWidget.ARCHIVE_FILE_SUFFIXES.some((suffix) =>
                fileName.endsWith(suffix),
            )
        ) {
            return `${codicon('file-zip')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--archive`
        }
        if (EntitiesOverviewWidget.MEDIA_EXTENSIONS.has(ext)) {
            return `${codicon('file-media')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--media`
        }
        if (EntitiesOverviewWidget.DATABASE_EXTENSIONS.has(ext)) {
            return `${codicon('database')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--database`
        }
        if (
            EntitiesOverviewWidget.CONFIG_EXTENSIONS.has(ext) ||
            EntitiesOverviewWidget.CONFIG_FILE_NAMES.has(fileName)
        ) {
            return `${codicon('settings-gear')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--config`
        }
        if (EntitiesOverviewWidget.DATA_EXTENSIONS.has(ext)) {
            return `${codicon('json')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--data`
        }
        if (EntitiesOverviewWidget.DOCUMENT_EXTENSIONS.has(ext)) {
            return `${codicon('markdown')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--document`
        }
        if (EntitiesOverviewWidget.SCRIPT_EXTENSIONS.has(ext)) {
            return `${codicon('terminal')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--script`
        }
        if (EntitiesOverviewWidget.CODE_EXTENSIONS.has(ext)) {
            return `${codicon('file-code')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--code`
        }
        if (ext === '.bin' || ext === '.dat') {
            return `${codicon('file-binary')} entities-overview-entity-icon entities-overview-file-icon entities-overview-file-icon--binary`
        }

        return `${codicon('file')} entities-overview-entity-icon entities-overview-file-icon`
    }

    protected resolveEntityFileExtension(fileName: string, encodingFormat?: string): string {
        const normalizedFileName = `${fileName ?? ''}`.trim().toLowerCase()
        if (normalizedFileName.includes('.')) {
            const suffix = normalizedFileName.slice(normalizedFileName.lastIndexOf('.'))
            if (suffix) {
                return suffix
            }
        }

        const normalizedEncoding = `${encodingFormat ?? ''}`.trim().toLowerCase()
        if (!normalizedEncoding) {
            return ''
        }

        const extension = mime.extension(normalizedEncoding)
        if (typeof extension === 'string' && extension.trim()) {
            return `.${extension.trim().toLowerCase()}`
        }

        return ''
    }

    protected getEntityNameCandidate(displayName: string, entityId: string): string {
        const name = `${displayName ?? ''}`.trim()
        if (name) {
            return name
        }
        const id = `${entityId ?? ''}`.trim()
        const withoutSlash = id.endsWith('/') ? id.slice(0, -1) : id
        const slashIndex = withoutSlash.lastIndexOf('/')
        return slashIndex >= 0 ? withoutSlash.slice(slashIndex + 1) : withoutSlash
    }

    protected override renderCaption(node: TreeNode, props: NodeProps): React.ReactNode {
        const attrs = this.getCaptionAttributes(node, props)
        const children = this.getCaptionChildren(node, props)

        const isLeafInvalid = ExampleTreeLeaf.is(node) && node.data.valid === false
        const isNodeInvalid = ExampleTreeNode.is(node) && this.hasInvalidDescendant(node)
        const showInvalidIcon = isLeafInvalid || isNodeInvalid

        if (showInvalidIcon) {
            const className =
                `${attrs.className ?? ''} entities-overview-invalid-caption`.trim()
            const containerTitle = isLeafInvalid ? 'Invalid entity' : 'Contains invalid entity'

            return (
                <div {...attrs} className={className} title={containerTitle}>
          <span
              className="entities-overview-invalid-icon fa fa-exclamation-triangle"
              role="img"
              aria-label={containerTitle}
              title={containerTitle}
          />
                    {children}
                </div>
            )
        }

        return React.createElement('div', attrs, children)
    }

    protected hasInvalidDescendant(node: ExampleTreeNode): boolean {
        for (const child of node.children) {
            if (ExampleTreeLeaf.is(child)) {
                if (child.data.valid === false) {
                    return true
                }
                continue
            }

            if (ExampleTreeNode.is(child) && this.hasInvalidDescendant(child)) {
                return true
            }
        }

        return false
    }

    protected override scrollToSelected(): void {
        // Selection visuals are driven by entity ids.
    }

    override storeState(): object {
        const safeState: EntitiesOverviewWidgetState = {
            version: EntitiesOverviewWidget.STATE_VERSION,
            filtersVisible: this.filtersVisible,
            filterMode: this.filterMode,
            simpleFilters: this.sanitizeFiltersForStorage(this.simpleFilters),
            advancedFilters: this.sanitizeFiltersForStorage(this.advancedFilters),
        }

        const serializedSize = this.getSerializedSizeInBytes(safeState)

        if (
            serializedSize === undefined ||
            serializedSize > EntitiesOverviewWidget.MAX_PERSISTED_STATE_BYTES
        ) {
            console.warn(
                'EntitiesOverviewWidget: skipping large/invalid widget state persistence',
                { serializedSize },
            )

            return {
                version: EntitiesOverviewWidget.STATE_VERSION,
                filtersVisible: this.filtersVisible,
            }
        }

        return safeState
    }

    override restoreState(oldState: object): void {
        if (!oldState || typeof oldState !== 'object') {
            return
        }

        const rawState = oldState as Record<string, unknown>

        if ('root' in rawState || 'model' in rawState || 'decorations' in rawState) {
            console.warn(
                'EntitiesOverviewWidget: discarded legacy persisted tree snapshot state',
            )
            return
        }

        const serializedSize = this.getSerializedSizeInBytes(rawState)

        if (
            serializedSize === undefined ||
            serializedSize > EntitiesOverviewWidget.MAX_PERSISTED_STATE_BYTES
        ) {
            console.warn(
                'EntitiesOverviewWidget: discarded oversized persisted widget state',
                { serializedSize },
            )
            return
        }

        if (typeof rawState.filtersVisible === 'boolean') {
            this.filtersVisible = rawState.filtersVisible
            this.appStateService.entitiesOverviewFiltersVisible = rawState.filtersVisible
            this.syncFiltersVisibleBodyClass()
        }

        if (rawState.filterMode === 'simple' || rawState.filterMode === 'advanced') {
            this.filterMode = rawState.filterMode
        }

        const simple = this.readFiltersFromStorage(rawState.simpleFilters)
        if (simple) {
            this.simpleFilters.entityNameFilter = simple.entityNameFilter
            this.simpleFilters.selectedTypeFilters = simple.selectedTypeFilters
            this.simpleFilters.validityFilter = simple.validityFilter
        }

        const advanced = this.readFiltersFromStorage(rawState.advancedFilters)
        if (advanced) {
            this.advancedFilters.entityNameFilter = advanced.entityNameFilter
            this.advancedFilters.selectedTypeFilters = advanced.selectedTypeFilters
            this.advancedFilters.validityFilter = advanced.validityFilter
        }

        this.applyFilters()
    }

    protected sanitizeFiltersForStorage(filters: {
        entityNameFilter: string
        selectedTypeFilters: string[]
        validityFilter: ValidityFilter
    }): PersistedEntityFilters {
        const entityNameFilter =
            typeof filters.entityNameFilter === 'string'
                ? filters.entityNameFilter.slice(0, EntitiesOverviewWidget.MAX_FILTER_TEXT_LENGTH)
                : ''

        const selectedTypeFilters = Array.from(
            new Set(
                (Array.isArray(filters.selectedTypeFilters) ? filters.selectedTypeFilters : [])
                    .filter((type): type is string => typeof type === 'string')
                    .map((type) => type.trim())
                    .filter((type) => type.length > 0)
                    .map((type) => type.slice(0, EntitiesOverviewWidget.MAX_TYPE_LABEL_LENGTH)),
            ).values(),
        ).slice(0, EntitiesOverviewWidget.MAX_SELECTED_TYPES)

        const validityFilter =
            filters.validityFilter === 'valid' ||
            filters.validityFilter === 'invalid' ||
            filters.validityFilter === 'all'
                ? filters.validityFilter
                : 'all'

        return { entityNameFilter, selectedTypeFilters, validityFilter }
    }

    protected readFiltersFromStorage(value: unknown): PersistedEntityFilters | undefined {
        if (!value || typeof value !== 'object') {
            return undefined
        }

        const raw = value as Partial<PersistedEntityFilters>

        return this.sanitizeFiltersForStorage({
            entityNameFilter: raw.entityNameFilter ?? '',
            selectedTypeFilters: raw.selectedTypeFilters ?? [],
            validityFilter: raw.validityFilter ?? 'all',
        })
    }

    protected getSerializedSizeInBytes(value: unknown): number | undefined {
        try {
            const serialized = JSON.stringify(value)
            return serialized ? serialized.length * 2 : 0
        } catch {
            return undefined
        }
    }

    protected override render(): React.ReactNode {
        const availableTypes = this.model.getAvailableTypes()
        const activeFilters = this.getActiveFilters()
        const selectedTypes = this.normalizeSelectedTypes(availableTypes, activeFilters)
        const isAdvanced = this.filterMode === 'advanced'
        const showFilters = this.filtersVisible

        const isSimpleClearDisabled =
            activeFilters.entityNameFilter.trim() === '' &&
            selectedTypes.length === 0 &&
            activeFilters.validityFilter === 'all'

        const isAdvancedClearDisabled =
            !this.advancedEntityMatcher &&
            this.advancedFilters.selectedTypeFilters.length === 0 &&
            this.advancedFilters.entityNameFilter.trim() === '' &&
            this.advancedFilters.validityFilter === 'all'

        return (
            <AntdThemeProvider themeService={this.themeService}>
                <div className="entities-overview-panel-content">
                    <div
                        className={`entities-overview-filters${showFilters ? '' : ' is-hidden'}`}
                        aria-hidden={!showFilters}
                    >
                        <div className="entities-overview-filter-header">
                            <div className="entities-overview-filter-toggle">
                                <Button.Group size="small">
                                    <Button
                                        type={this.filterMode === 'simple' ? 'primary' : 'default'}
                                        onClick={() => this.setFilterMode('simple')}
                                    >
                                        Simple
                                    </Button>
                                    <Button
                                        type={this.filterMode === 'advanced' ? 'primary' : 'default'}
                                        onClick={() => this.setFilterMode('advanced')}
                                    >
                                        Advanced
                                    </Button>
                                </Button.Group>
                            </div>
                        </div>

                        <div
                            className={`entities-overview-filter-fields${
                                isAdvanced ? ' is-hidden' : ''
                            }`}
                            aria-hidden={isAdvanced}
                        >
                            <label className="entities-overview-filter-row">
                                <span className="entities-overview-filter-label">Entity name</span>
                                <input
                                    className="entities-overview-filter-input"
                                    type="text"
                                    placeholder="Search entity name"
                                    ref={this.entityNameInputRef}
                                    value={activeFilters.entityNameFilter}
                                    onChange={(event) => this.onEntityNameFilterChange(event)}
                                    onKeyDownCapture={(event) => this.stopFilterKeyEvents(event)}
                                />
                            </label>

                            <label className="entities-overview-filter-row">
                                <span className="entities-overview-filter-label">Validity</span>
                                <div onKeyDownCapture={(event) => this.stopFilterKeyEvents(event)}>
                                    <Select
                                        className="entities-overview-validity-select"
                                        value={activeFilters.validityFilter}
                                        options={[
                                            { value: 'all', label: 'All entities' },
                                            { value: 'valid', label: 'Only valid' },
                                            { value: 'invalid', label: 'Only invalid' },
                                        ]}
                                        classNames={{ popup: { root: 'entities-overview-filter-dropdown' } }}
                                        onChange={(value) =>
                                            this.onValidityFilterChange(value as ValidityFilter)
                                        }
                                        size="small"
                                    />
                                </div>
                            </label>

                            <div className="entities-overview-filter-row">
                                <span className="entities-overview-filter-label">Entity type</span>
                                <div onKeyDownCapture={(event) => this.stopFilterKeyEvents(event)}>
                                    <Select
                                        className="entities-overview-type-select"
                                        mode="multiple"
                                        placeholder="All types"
                                        value={selectedTypes}
                                        options={availableTypes.map((type) => ({ value: type, label: type }))}
                                        classNames={{ popup: { root: 'entities-overview-filter-dropdown' } }}
                                        onChange={(values) => this.onTypeFiltersChange(values)}
                                        maxTagCount="responsive"
                                        size="small"
                                        disabled={availableTypes.length === 0}
                                    />
                                </div>
                            </div>
                        </div>

                        <div
                            className={`entities-overview-filter-actions${
                                isAdvanced ? ' is-advanced' : ''
                            }`}
                        >
                            <div
                                className={`entities-overview-advanced-button-wrap${
                                    isAdvanced ? ' is-visible' : ''
                                }`}
                            >
                                <Button
                                    className="entities-overview-advanced-button"
                                    type="default"
                                    onClick={() => this.openAdvancedDialog()}
                                    onKeyDownCapture={(event: React.KeyboardEvent) =>
                                        this.stopFilterKeyEvents(event)
                                    }
                                >
                                    {this.advancedRuleCount > 0
                                        ? `Advanced filters (${this.advancedRuleCount})`
                                        : 'Advanced filters'}
                                </Button>
                            </div>

                            <Button
                                className="entities-overview-filter-clear"
                                danger
                                ghost
                                disabled={isAdvanced ? isAdvancedClearDisabled : isSimpleClearDisabled}
                                onClick={() => this.clearFilters()}
                                onKeyDownCapture={(event: React.KeyboardEvent) =>
                                    this.stopFilterKeyEvents(event)
                                }
                            >
                                Clear filters
                            </Button>
                        </div>
                    </div>

                    <div
                        className="entities-overview-edit-row"
                        onClick={(event) => this.handleEditRowClick(event)}
                    >
                        <Button
                            className="entities-overview-edit-button"
                            type="default"
                            onClick={() => this.openMultiEditDialog()}
                            onKeyDownCapture={(event: React.KeyboardEvent) =>
                                this.stopFilterKeyEvents(event)
                            }
                        >
                            Edit
                        </Button>
                    </div>

                    <div {...this.createContainerAttributes()}>{this.renderTree(this.model)}</div>
                </div>
            </AntdThemeProvider>
        )
    }

    isFiltersVisible(): boolean {
        return this.filtersVisible
    }

    toggleFiltersVisibility(): void {
        this.filtersVisible = !this.filtersVisible
        this.appStateService.entitiesOverviewFiltersVisible = this.filtersVisible
        this.syncFiltersVisibleBodyClass()
        this.update()
    }

    hasExpandedEntityNodes(): boolean {
        const root = this.model.root
        if (!root || !CompositeTreeNode.is(root)) {
            return false
        }
        return this.hasExpandedEntityNodeDescendants(root)
    }

    async collapseAllEntityNodes(): Promise<void> {
        const root = this.model.root
        if (!root || !CompositeTreeNode.is(root)) {
            return
        }

        for (const child of root.children) {
            if (ExampleTreeNode.is(child)) {
                await this.model.collapseAll(child)
            }
        }
    }

    async expandAllEntityNodes(): Promise<void> {
        const root = this.model.root
        if (!root || !CompositeTreeNode.is(root)) {
            return
        }
        for (const child of root.children) {
            if (ExampleTreeNode.is(child)) {
                await this.expandEntityNode(child)
            }
        }
    }

    protected hasExpandedEntityNodeDescendants(node: CompositeTreeNode): boolean {
        for (const child of node.children) {
            if (!ExampleTreeNode.is(child)) {
                continue
            }
            if (child.expanded) {
                return true
            }
        }
        return false
    }

    protected async expandEntityNode(node: ExampleTreeNode): Promise<void> {
        let expandedNode = node
        if (!node.expanded) {
            const maybeExpanded = await this.model.expandNode(node)
            if (maybeExpanded && ExampleTreeNode.is(maybeExpanded)) {
                expandedNode = maybeExpanded
            }
        }
        for (const child of expandedNode.children) {
            if (ExampleTreeNode.is(child)) {
                await this.expandEntityNode(child)
            }
        }
    }

    protected syncFiltersVisibleBodyClass(): void {
        document.body.classList.toggle(this.filtersVisibleBodyClass, this.filtersVisible)
    }

    protected override createContainerAttributes(): React.HTMLAttributes<HTMLElement> {
        const attributes = super.createContainerAttributes()
        const existingOnClick = attributes.onClick
        const existingOnKeyDown = attributes.onKeyDown

        return {
            ...attributes,
            onClick: (event) => {
                if (typeof existingOnClick === 'function') {
                    existingOnClick(event)
                }

                const target = event.target as HTMLElement
                if (target.closest('.theia-TreeNode')) {
                    return
                }

                this.model.clearSelection()
            },
            onKeyDown: (event) => {
                if (typeof existingOnKeyDown === 'function') {
                    existingOnKeyDown(event)
                }

                if (event.defaultPrevented || event.key !== 'Delete') {
                    return
                }

                if (this.shouldIgnoreDeleteKeyEvent(event.target as HTMLElement | null)) {
                    return
                }

                event.preventDefault()
                event.stopPropagation()
                void this.deleteSelectedEntities()
            },
        }
    }

    protected override createNodeClassNames(node: TreeNode, props: NodeProps): string[] {
        const classNames = super
            .createNodeClassNames(node, props)
            .concat('theia-example-tree-node')

        if (ExampleTreeNode.is(node)) {
            return classNames.filter(
                (className) => className !== SELECTED_CLASS && className !== FOCUS_CLASS,
            )
        }

        if (ExampleTreeLeaf.is(node) && node.data.selected) {
            classNames.push('entities-overview-leaf-selected')
            classNames.push(SELECTED_CLASS)
        }

        return classNames
    }

    protected override rowIsSelected(node: TreeNode, props: NodeProps): boolean {
        if (ExampleTreeNode.is(node)) {
            return false
        }

        return super.rowIsSelected(node, props)
    }

    protected override handleContextMenuEvent(
        node: TreeNode | undefined,
        event: React.MouseEvent<HTMLElement>,
    ): void {
        if (node && ExampleTreeLeaf.is(node)) {
            const entityId = node.data.entityId
            if (entityId) {
                const selectedIds = new Set(this.model.getSelectedEntityIds())
                if (!selectedIds.has(entityId)) {
                    this.model.selectSingle(entityId)
                }
            }

            this.renderNodeContextMenu(node, event)
            return
        }

        if (node && ExampleTreeNode.is(node)) {
            this.renderNodeContextMenu(node, event)
            return
        }

        super.handleContextMenuEvent(node, event)
    }

    protected renderNodeContextMenu(
        node: TreeNode,
        event: React.MouseEvent<HTMLElement>,
    ): void {
        const contextMenuPath = this.props.contextMenuPath

        if (contextMenuPath) {
            const { x, y } = event.nativeEvent
            const args = SelectableTreeNode.is(node) ? this.toContextMenuArgs(node) : [node]
            const target = event.currentTarget

            setTimeout(
                () =>
                    this.contextMenuRenderer.render({
                        menuPath: contextMenuPath,
                        context: target,
                        anchor: { x, y },
                        args,
                    }),
                10,
            )
        }

        event.stopPropagation()
        event.preventDefault()
    }

    protected override createNodeAttributes(
        node: TreeNode,
        props: NodeProps,
    ): React.Attributes & React.HTMLAttributes<HTMLElement> {
        const baseAttributes = super.createNodeAttributes(node, props)
        const payload = this.getDraggableEntityPayload(node)
        const className = `${baseAttributes.className ?? ''}${
            payload ? ' entities-overview-draggable-entity' : ''
        }`.trim()

        return {
            ...baseAttributes,
            className: className || undefined,
            draggable: Boolean(payload),
            onClick: (event) => this.handleNodeClick(node, event),
            onDoubleClick: (event) => this.handleNodeDoubleClick(node, event),
            onDragStart: (event) => {
                const selectedIds = this.model.getSelectedEntityIds()

                const candidateEntityIds =
                    selectedIds.length > 0 && ExampleTreeLeaf.is(node)
                        ? selectedIds
                        : ExampleTreeLeaf.is(node)
                            ? [node.data.entityId]
                            : []
                const entityIds = candidateEntityIds.filter(
                    (id): id is string => Boolean(id),
                )

                const entityNames: string[] = []
                const entityTypes: string[][] = []

                for (const id of entityIds) {
                    const entity = this.findCrateEntityById(id)
                    if (!entity) {
                        continue
                    }

                    const types = this.getEntityTypeNames(entity)

                    entityNames.push(entity['name'] ?? id)
                    entityTypes.push(types)
                }

                const dragPayload: EntityOverviewDragPayload = {
                    entityIds,
                    entityNames,
                    entityTypes,
                    source: 'entities-overview',
                }

                event.dataTransfer?.setData(
                    'application/x-aroma-entity-drag',
                    JSON.stringify(dragPayload),
                )

                event.dataTransfer?.setData('text/plain', JSON.stringify(dragPayload))

                ;(globalThis as any).__aromaEntityDragPayload = dragPayload
            },
            onDragEnd: (event) => {
                event.stopPropagation()
                ;(globalThis as any).__aromaEntityDragPayload = undefined
            },
        }
    }

    protected handleNodeClick(node: TreeNode, event: React.MouseEvent<HTMLElement>): void {
        if (ExampleTreeNode.is(node)) {
            void this.model.toggleNodeExpansion(node)
            return
        }

        if (ExampleTreeLeaf.is(node)) {
            const entityId = node.data.entityId

            if (!entityId) {
                console.warn('EntitiesOverviewWidget: missing entityId for selection')
                return
            }

            event.stopPropagation()
            event.preventDefault()

            if (event.shiftKey) {
                this.model.selectRangeTo(entityId)
                return
            }

            if (event.ctrlKey || event.metaKey) {
                this.model.toggleSelection(entityId)
                return
            }

            this.model.selectSingle(entityId)

            if (event.altKey) {
                void this.openRoCrateEditorForEntity(entityId, { forceNewWindow: true })
            }
        }
    }

    protected handleNodeDoubleClick(
        node: TreeNode,
        event: React.MouseEvent<HTMLElement>,
    ): void {
        if (!ExampleTreeLeaf.is(node)) {
            return
        }

        const entityId = node.data.entityId

        if (!entityId) {
            console.warn('EntitiesOverviewWidget: missing entityId for open')
            return
        }

        event.stopPropagation()
        event.preventDefault()

        if (event.altKey || event.shiftKey) {
            return
        }

        this.model.selectSingle(entityId)
        void this.openRoCrateEditorForEntity(entityId)
    }

    protected handleEditRowClick(event: React.MouseEvent<HTMLElement>): void {
        const target = event.target as HTMLElement | null

        if (target?.closest('.entities-overview-edit-button')) {
            return
        }

        this.model.clearSelection()
    }

    protected async openRoCrateEditorForEntity(
        entityId: string,
        options?: { forceNewWindow?: boolean },
    ): Promise<void> {
        if (!entityId) {
            console.warn('EntitiesOverviewWidget: attempted to open editor without entityId')
            return
        }

        const forceNewWindow = options?.forceNewWindow === true
        const dedupeByEntity = !forceNewWindow

        if (dedupeByEntity && this.openingEntities.has(entityId)) {
            return
        }

        if (dedupeByEntity) {
            this.openingEntities.add(entityId)
        }

        const prevSelected = this.appStateService.selectedEntityId
        if (prevSelected !== entityId) {
            this.appStateService.selectedEntityId = entityId
        }

        try {
            if (!forceNewWindow) {
                const existingWidgetId = this.findWidgetIdForEntity(entityId)

                if (existingWidgetId) {
                    this.appStateService.registerEntityEditor(existingWidgetId, entityId)
                    await this.shell.activateWidget(existingWidgetId)
                    this.markEditorFocused(existingWidgetId)
                    return
                }

                const lastFocusedEditor = this.getPreferredRoCrateEditorWidget()

                if (lastFocusedEditor) {
                    this.appStateService.registerEntityEditor(lastFocusedEditor.id, entityId)
                    await this.shell.activateWidget(lastFocusedEditor.id)
                    this.markEditorFocused(lastFocusedEditor.id)
                    return
                }
            }

            const instanceId = `${RoCrateEditorWidget.ID}:${Math.random()
                .toString(36)
                .slice(2)}`

            const widget = await this.widgetManager.getOrCreateWidget(RoCrateEditorWidget.ID, {
                instanceId,
                entityId,
            })

            const addOptions: {
                area: 'main'
                mode?: 'split-right' | 'tab-after'
                ref?: Widget
            } = { area: 'main' }

            const referenceEditor = this.getPreferredRoCrateEditorWidget()

            if (referenceEditor) {
                if (forceNewWindow) {
                    const rightmostInRecentContainer =
                        this.getRightmostWidgetInSameTabBar(referenceEditor) ?? referenceEditor
                    addOptions.mode = 'tab-after'
                    addOptions.ref = rightmostInRecentContainer
                } else {
                    addOptions.mode = 'split-right'
                    addOptions.ref = referenceEditor
                }
            }

            await this.shell.addWidget(widget, addOptions)
            this.appStateService.registerEntityEditor(widget.id, entityId)
            await this.shell.activateWidget(widget.id)
            this.markEditorFocused(widget.id)
        } catch (error) {
            console.error('EntitiesOverviewWidget: failed to open editor', { entityId, error })
        } finally {
            if (dedupeByEntity) {
                this.openingEntities.delete(entityId)
            }
        }
    }

    protected findWidgetIdForEntity(entityId: string): string | undefined {
        const mapping = this.appStateService.EIRCEIA ?? {}

        const matchingIds = Object.entries(mapping)
            .filter(([, mappedEntityId]) => mappedEntityId === entityId)
            .map(([widgetId]) => widgetId)
            .filter((widgetId) => Boolean(this.shell.getWidgetById(widgetId)))

        if (matchingIds.length === 0) {
            return undefined
        }

        for (let index = this.editorFocusOrder.length - 1; index >= 0; index -= 1) {
            const widgetId = this.editorFocusOrder[index]

            if (matchingIds.includes(widgetId)) {
                return widgetId
            }
        }

        return matchingIds[0]
    }

    protected isRoCrateEditorWidget(widget: Widget): boolean {
        return widget.id.startsWith(RoCrateEditorWidget.ID)
    }

    protected markEditorFocused(widgetId: string): void {
        const index = this.editorFocusOrder.indexOf(widgetId)

        if (index >= 0) {
            this.editorFocusOrder.splice(index, 1)
        }

        this.editorFocusOrder.push(widgetId)
    }

    protected getPreferredRoCrateEditorWidget(): Widget | undefined {
        for (let index = this.editorFocusOrder.length - 1; index >= 0; index -= 1) {
            const widgetId = this.editorFocusOrder[index]
            const widget = this.shell.getWidgetById(widgetId)

            if (widget && this.isRoCrateEditorWidget(widget)) {
                return widget
            }

            this.editorFocusOrder.splice(index, 1)
        }

        const active = this.shell.activeWidget ?? this.shell.currentWidget

        if (active && this.isRoCrateEditorWidget(active)) {
            return active
        }

        for (const widget of this.shell.getWidgets('main')) {
            if (this.isRoCrateEditorWidget(widget)) {
                return widget
            }
        }

        return undefined
    }

    protected getRightmostWidgetInSameTabBar(widget: Widget): Widget | undefined {
        const tabBar = this.shell.getTabBarFor(widget)

        if (!tabBar || tabBar.titles.length === 0) {
            return undefined
        }

        return tabBar.titles[tabBar.titles.length - 1].owner
    }

    protected onEntityNameFilterChange(event: React.ChangeEvent<HTMLInputElement>): void {
        this.entityNameSelection = {
            start: event.target.selectionStart,
            end: event.target.selectionEnd,
        }

        this.getActiveFilters().entityNameFilter = event.target.value
        this.applyFilters()
        this.restoreInputSelection(this.entityNameInputRef, this.entityNameSelection)
    }

    protected applyFilters(): void {
        const availableTypes = this.model.getAvailableTypes()
        const activeFilters = this.getActiveFilters()
        const selectedTypes = this.normalizeSelectedTypes(availableTypes, activeFilters)

        this.model.setFilters(
            activeFilters.entityNameFilter,
            selectedTypes,
            activeFilters.validityFilter,
        )

        this.model.setAdvancedEntityMatcher(
            this.filterMode === 'advanced' ? this.advancedEntityMatcher : undefined,
        )

        this.update()
    }

    protected normalizeSelectedTypes(
        availableTypes: string[],
        filters: {
            selectedTypeFilters: string[]
        },
    ): string[] {
        if (availableTypes.length === 0) {
            return []
        }

        const availableSet = new Set(availableTypes)

        const filteredSelections = filters.selectedTypeFilters.filter((type) =>
            availableSet.has(type),
        )

        if (filteredSelections.length !== filters.selectedTypeFilters.length) {
            filters.selectedTypeFilters = [...filteredSelections]
        }

        return availableTypes.filter((type) => filters.selectedTypeFilters.includes(type))
    }

    protected onTypeFiltersChange(values: string[]): void {
        this.getActiveFilters().selectedTypeFilters = [...values]
        this.applyFilters()
    }

    protected onValidityFilterChange(value: ValidityFilter): void {
        this.getActiveFilters().validityFilter = value
        this.applyFilters()
    }

    protected clearFilters(): void {
        const activeFilters = this.getActiveFilters()

        activeFilters.entityNameFilter = ''
        activeFilters.selectedTypeFilters = []
        activeFilters.validityFilter = 'all'

        if (this.filterMode === 'advanced') {
            this.advancedFilterState = undefined
            this.advancedEntityMatcher = undefined
            this.advancedRuleCount = 0
        }

        this.applyFilters()
    }

    protected setFilterMode(mode: 'simple' | 'advanced'): void {
        if (this.filterMode === mode) {
            return
        }

        this.filterMode = mode
        this.applyFilters()
    }

    protected async openAdvancedDialog(): Promise<void> {
        const profile = this.appStateService.completeProfile ?? this.appStateService.profile
        const catalog = buildAdvancedFilterCatalog(this.appStateService.roCrate, profile)
        const availableTypes = this.model.getAvailableTypes()

        const dialog = new AdvancedFiltersDialog(
            catalog,
            this.advancedFilterState,
            availableTypes,
            this.appStateService.roCrate,
        )

        const result = await dialog.open()

        if (result) {
            this.advancedFilterState = result
            this.advancedFilters.selectedTypeFilters =
                result.selectedEntityType === ALL_ENTITY_TYPES_OPTION
                    ? []
                    : [result.selectedEntityType]

            this.advancedEntityMatcher = buildAdvancedEntityMatcher(
                result,
                catalog,
                this.appStateService.roCrate,
            )

            this.advancedRuleCount = countActiveAdvancedRules(result, catalog)
            this.applyAdvancedFilters()
        }
    }

    protected async openMultiEditDialog(): Promise<void> {
        const selectedEntityIds = this.model.getSelectedEntityIds()
        const entityIds =
            selectedEntityIds.length > 0 ? selectedEntityIds : this.model.getVisibleEntityIds()

        await this.multiEditDialogService.open(entityIds, this.schemaManagerService)
    }

    public canOpenEditFromContextMenu(): boolean {
        return this.model.getSelectedEntityIds().length > 0
    }

    public async openEditFromContextMenu(): Promise<void> {
        if (!this.canOpenEditFromContextMenu()) {
            return
        }

        await this.openMultiEditDialog()
    }

    public canDeleteFromContextMenu(): boolean {
        return this.getDeletableSelectedEntityIds().length > 0
    }

    public async deleteFromContextMenu(): Promise<void> {
        await this.deleteSelectedEntities()
    }

    protected async deleteSelectedEntities(): Promise<void> {
        const result = await this.roCrateEntityDeleteService.deleteSelectedEntities({
            selectedEntityIds: this.model.getSelectedEntityIds(),
            rootEntityId: EntitiesOverviewWidget.ROOT_DATASET_ENTITY_ID,
            appStateService: this.appStateService,
            roCrateHistoryService: this.roCrateHistoryService,
            shell: this.shell,
        })

        if (!result.changed) {
            return
        }

        this.model.clearSelection()
    }

    protected getDeletableSelectedEntityIds(): string[] {
        return Array.from(
            this.roCrateEntityDeleteService.getDeletableEntityIds(
                this.model.getSelectedEntityIds(),
                EntitiesOverviewWidget.ROOT_DATASET_ENTITY_ID,
            ),
        )
    }

    protected shouldIgnoreDeleteKeyEvent(target: HTMLElement | null): boolean {
        if (!target) {
            return false
        }

        return Boolean(
            target.closest(
                'input, textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
            ),
        )
    }

    protected applyAdvancedFilters(): void {
        this.applyFilters()
    }

    protected getActiveFilters(): {
        entityNameFilter: string
        selectedTypeFilters: string[]
        validityFilter: ValidityFilter
    } {
        return this.filterMode === 'simple' ? this.simpleFilters : this.advancedFilters
    }

    protected stopFilterKeyEvents(event: React.KeyboardEvent): void {
        event.stopPropagation()

        if (typeof event.nativeEvent.stopImmediatePropagation === 'function') {
            event.nativeEvent.stopImmediatePropagation()
        }
    }

    protected getDraggableEntityPayload(
        node: TreeNode,
    ): EntityOverviewDragPayload | undefined {
        if (!ExampleTreeLeaf.is(node)) {
            return undefined
        }

        const entityId = node.data.entityId

        if (!entityId) {
            return undefined
        }

        const entity = this.findCrateEntityById(entityId)

        if (!entity) {
            return undefined
        }

        const entityTypes = this.getEntityTypeNames(entity)
        const isAllowed = entityTypes.includes('file') || entityTypes.includes('dataset')

        if (!isAllowed) {
            return undefined
        }

        return {
            entityIds: [entityId],
            entityNames: [node.data.name],
            entityTypes: [entityTypes],
            source: 'entities-overview',
        }
    }

    protected findCrateEntityById(entityId: string): Record<string, any> | undefined {
        const graph = Array.isArray(this.appStateService.roCrate?.['@graph'])
            ? (this.appStateService.roCrate?.['@graph'] as Record<string, any>[])
            : []

        return graph.find(
            (entry) => entry && typeof entry === 'object' && String(entry['@id']) === entityId,
        )
    }

    protected getEntityTypeNames(entity: Record<string, any>): string[] {
        const rawTypes = entity?.['@type']
        const typeList = Array.isArray(rawTypes) ? rawTypes : [rawTypes]

        return typeList
            .map((type) => String(type ?? '').trim())
            .filter((type) => type.length > 0)
            .map((type) => {
                const tail = type.split(/[\/#]/).pop() || type
                return tail.toLowerCase()
            })
    }

    protected restoreInputSelection(
        inputRef: React.RefObject<HTMLInputElement>,
        selection?: { start: number | null; end: number | null },
    ): void {
        if (!selection) {
            return
        }

        requestAnimationFrame(() => {
            const input = inputRef.current

            if (!input) {
                return
            }

            const { start, end } = selection

            if (start === null || end === null) {
                return
            }

            input.setSelectionRange(start, end)
        })
    }
}
