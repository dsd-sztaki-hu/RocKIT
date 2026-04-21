// *****************************************************************************
// Copyright (C) 2017-2018 TypeFox and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import {
    CommonCommands,
    CompositeTreeNode,
    FrontendApplication,
    FrontendApplicationContribution,
    KeybindingRegistry,
    OpenerService,
    SelectableTreeNode,
    Widget,
    NavigatableWidget,
    SHELL_TABBAR_CONTEXT_MENU,
    OpenWithService
} from '@theia/core/lib/browser';
import { FileDownloadCommands } from '@theia/filesystem/lib/browser/download/file-download-command-contribution';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import {
    CommandRegistry,
    isOSX,
    MenuModelRegistry,
    MenuPath,
    Mutable,
    PreferenceScope,
    PreferenceService,
    QuickInputService,
} from '@theia/core/lib/common';
import {
    DidCreateNewResourceEvent,
    WorkspaceCommandContribution,
    WorkspaceCommands,
    WorkspaceService
} from '@theia/workspace/lib/browser';
import { FileSearchService } from '@theia/file-search/lib/common/file-search-service';
import { EXPLORER_VIEW_CONTAINER_ID, EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS } from './navigator-widget-factory';
import { FILE_NAVIGATOR_ID, FileNavigatorWidget } from './navigator-widget';
import { FileNavigatorPreferences } from '../common/navigator-preferences';
import { FileNavigatorFilter } from './navigator-filter';
import { WorkspaceNode } from './navigator-tree';
import { NavigatorContextKeyService } from './navigator-context-key-service';
import {
    RenderedToolbarAction,
    TabBarToolbarContribution,
    TabBarToolbarRegistry
} from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { FileSystemCommands } from '@theia/filesystem/lib/browser/filesystem-frontend-contribution';
import { NavigatorDiff, NavigatorDiffCommands } from './navigator-diff';
import { DirNode, FileNode, FileStatNode } from '@theia/filesystem/lib/browser';
import { FileNavigatorModel } from './navigator-model';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import URI from '@theia/core/lib/common/uri';
import { UriAwareCommandHandler } from '@theia/core/lib/common/uri-command-handler';
import { FileNavigatorCommands } from './file-navigator-commands';
import { WorkspacePreferences } from '@theia/workspace/lib/common';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { AddDataSourceCommand } from 'data-sources/lib/browser';
import { RoCrateIgnoredFilesService } from './ro-crate-ignored-files-service';
import {
    IncludeResourcesResult,
    OmitResourcesResult,
    RoCrateDescriptionOperationsService,
    RoCrateWorkspaceResource
} from './ro-crate-description-operations-service';
export { FileNavigatorCommands };

/**
 * Navigator `More Actions...` toolbar item groups.
 * Used in order to group items present in the toolbar.
 */
export namespace NavigatorMoreToolbarGroups {
    export const NEW_OPEN = '1_navigator_new_open';
    export const TOOLS = '2_navigator_tools';
    export const WORKSPACE = '3_navigator_workspace';
}

export const NAVIGATOR_CONTEXT_MENU: MenuPath = ['navigator-context-menu'];
export const SHELL_TABBAR_CONTEXT_REVEAL: MenuPath = [...SHELL_TABBAR_CONTEXT_MENU, '2_reveal'];

/**
 * Navigator context menu default groups should be aligned
 * with VS Code default groups: https://code.visualstudio.com/api/references/contribution-points#contributes.menus
 */
export namespace NavigatorContextMenu {
    export const NAVIGATION = [...NAVIGATOR_CONTEXT_MENU, 'navigation'];
    /** @deprecated use NAVIGATION */
    export const OPEN = NAVIGATION;
    /** @deprecated use NAVIGATION */
    export const NEW = NAVIGATION;

    export const WORKSPACE = [...NAVIGATOR_CONTEXT_MENU, '2_workspace'];

    export const COMPARE = [...NAVIGATOR_CONTEXT_MENU, '3_compare'];
    /** @deprecated use COMPARE */
    export const DIFF = COMPARE;

    export const SEARCH = [...NAVIGATOR_CONTEXT_MENU, '4_search'];
    export const CLIPBOARD = [...NAVIGATOR_CONTEXT_MENU, '5_cutcopypaste'];

    export const MODIFICATION = [...NAVIGATOR_CONTEXT_MENU, '7_modification'];
    /** @deprecated use MODIFICATION */
    export const MOVE = MODIFICATION;
    /** @deprecated use MODIFICATION */
    export const ACTIONS = MODIFICATION;

    /** @deprecated use the `FileNavigatorCommands.OPEN_WITH` command */
    export const OPEN_WITH = [...NAVIGATION, 'open_with'];
    export const RO_CRATE_DESCRIPTION = [...NAVIGATOR_CONTEXT_MENU, '6_ro_crate_description'];
}

export const FILE_NAVIGATOR_TOGGLE_COMMAND_ID = 'fileNavigator:toggle';

export interface RoCrateDescriptionActionResource {
    path: string;
    isDirectory: boolean;
    uri?: URI | string;
}

export interface RoCrateDescriptionActionOptions {
    /**
     * Optional explicit resources.
     * If omitted, the current file-navigator selection is used.
     */
    resources?: ReadonlyArray<RoCrateDescriptionActionResource>;
    /**
     * Suppresses toasts and interactive confirmation.
     */
    silent?: boolean;
}

@injectable()
export class FileNavigatorContribution extends AbstractViewContribution<FileNavigatorWidget> implements FrontendApplicationContribution, TabBarToolbarContribution {
    protected syncingIgnoredRulesToMetadata = false;
    protected startupIgnoredConsistencyCheckRunning = false;
    protected startupIgnoredConsistencyCheckDone = false;

    @inject(ClipboardService)
    protected readonly clipboardService: ClipboardService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(TabBarToolbarRegistry)
    protected readonly tabbarToolbarRegistry: TabBarToolbarRegistry;

    @inject(NavigatorContextKeyService)
    protected readonly contextKeyService: NavigatorContextKeyService;

    @inject(MenuModelRegistry)
    protected readonly menuRegistry: MenuModelRegistry;

    @inject(NavigatorDiff)
    protected readonly navigatorDiff: NavigatorDiff;

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @inject(SelectionService)
    protected readonly selectionService: SelectionService;

    @inject(AppStateService)
    protected readonly appStateService: AppStateService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(RoCrateIgnoredFilesService)
    protected readonly roCrateIgnoredFilesService: RoCrateIgnoredFilesService;

    @inject(RoCrateDescriptionOperationsService)
    protected readonly roCrateDescriptionOperationsService: RoCrateDescriptionOperationsService;

    @inject(WorkspaceCommandContribution)
    protected readonly workspaceCommandContribution: WorkspaceCommandContribution;

    @inject(OpenWithService)
    protected readonly openWithService: OpenWithService;

    @inject(FileSearchService)
    protected readonly fileSearchService: FileSearchService;

    @inject(QuickInputService) @optional()
    protected readonly quickInputService: QuickInputService;

    constructor(
        @inject(FileNavigatorPreferences) protected readonly fileNavigatorPreferences: FileNavigatorPreferences,
        @inject(OpenerService) protected readonly openerService: OpenerService,
        @inject(FileNavigatorFilter) protected readonly fileNavigatorFilter: FileNavigatorFilter,
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
        @inject(WorkspacePreferences) protected readonly workspacePreferences: WorkspacePreferences
    ) {
        super({
            viewContainerId: EXPLORER_VIEW_CONTAINER_ID,
            widgetId: FILE_NAVIGATOR_ID,
            widgetName: EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS.label,
            defaultWidgetOptions: {
                area: 'left',
                rank: 100
            },
            toggleCommandId: FILE_NAVIGATOR_TOGGLE_COMMAND_ID,
            toggleKeybinding: 'ctrlcmd+shift+e'
        });
    }

    @postConstruct()
    protected init(): void {
        this.doInit();
    }

    protected async doInit(): Promise<void> {
        await this.fileNavigatorPreferences.ready;
        await this.roCrateIgnoredFilesService.ensureIgnoreStoreExists();
        this.appStateService.onDidChangeSelector((state) => state.roCrate)(() => {
            void this.checkStartupIgnoredConsistency();
        });
        void this.checkStartupIgnoredConsistency();
        this.roCrateIgnoredFilesService.onDidChangeIgnoredPaths(() => {
            void this.syncRoCrateDescriptionsFromIgnoredRules();
        });
        this.shell.onDidChangeCurrentWidget(() => this.onCurrentWidgetChangedHandler());

        const updateFocusContextKeys = () => {
            const hasFocus = this.shell.activeWidget instanceof FileNavigatorWidget;
            this.contextKeyService.explorerViewletFocus.set(hasFocus);
            this.contextKeyService.filesExplorerFocus.set(hasFocus);
        };
        updateFocusContextKeys();
        this.shell.onDidChangeActiveWidget(updateFocusContextKeys);
        this.workspaceCommandContribution.onDidCreateNewFile(async event => this.onDidCreateNewResource(event));
        this.workspaceCommandContribution.onDidCreateNewFolder(async event => this.onDidCreateNewResource(event));
        this.workspaceService.onWorkspaceChanged(() => {
            this.startupIgnoredConsistencyCheckDone = false;
            void this.roCrateIgnoredFilesService.ensureIgnoreStoreExists();
            void this.checkStartupIgnoredConsistency();
        });
    }

    protected async checkStartupIgnoredConsistency(): Promise<void> {
        if (this.startupIgnoredConsistencyCheckDone || this.startupIgnoredConsistencyCheckRunning) {
            return;
        }

        const crate = this.appStateService.roCrate;
        if (!crate || !Array.isArray(crate['@graph'])) {
            return;
        }

        this.startupIgnoredConsistencyCheckRunning = true;
        try {
            const mismatchCount = await this.roCrateDescriptionOperationsService.getIgnoredDescriptionMismatchCount({
                ignoreDefaultEntries: true,
            });
            if (mismatchCount === 0) {
                this.startupIgnoredConsistencyCheckDone = true;
                return;
            }

            const itemLabel = mismatchCount === 1
                ? '1 RO-Crate description'
                : `${mismatchCount} RO-Crate descriptions`;
            const apply = await new ConfirmDialog({
                title: 'Apply ignore list changes to RO-Crate?',
                msg: `Found ${itemLabel} that conflict with ignore rules. Apply ignore rules to RO-Crate now?`,
                ok: 'Apply Changes',
                cancel: 'Keep Current',
            }).open();

            if (apply) {
                const result = await this.roCrateDescriptionOperationsService.syncIgnoredDescriptionsFromRules({
                    ignoreDefaultEntries: true,
                });
                if (result.removedDescriptionCount > 0) {
                    this.messageService.info(
                        result.removedDescriptionCount === 1
                            ? 'Applied ignore rules and removed 1 RO-Crate description.'
                            : `Applied ignore rules and removed ${result.removedDescriptionCount} RO-Crate descriptions.`,
                    );
                }
            }

            this.startupIgnoredConsistencyCheckDone = true;
        } finally {
            this.startupIgnoredConsistencyCheckRunning = false;
        }
    }

    protected async syncRoCrateDescriptionsFromIgnoredRules(): Promise<void> {
        if (this.syncingIgnoredRulesToMetadata) {
            return;
        }
        this.syncingIgnoredRulesToMetadata = true;
        try {
            await this.roCrateDescriptionOperationsService.syncIgnoredDescriptionsFromRules();
        } finally {
            this.syncingIgnoredRulesToMetadata = false;
        }
    }

    private async onDidCreateNewResource(event: DidCreateNewResourceEvent): Promise<void> {
        const navigator = this.tryGetWidget();
        if (!navigator || !navigator.isVisible) {
            return;
        }
        const model: FileNavigatorModel = navigator.model;
        const parent = await model.revealFile(event.parent);
        if (DirNode.is(parent)) {
            await model.refresh(parent);
        }
        const node = await model.revealFile(event.uri);
        if (SelectableTreeNode.is(node)) {
            model.selectNode(node);
            if (DirNode.is(node)) {
                this.openView({ activate: true });
            }
        }
    }

    async initializeLayout(app: FrontendApplication): Promise<void> {
        await this.openView();
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(FileNavigatorCommands.FOCUS, {
            execute: () => this.openView({ activate: true })
        });
        registry.registerCommand(FileNavigatorCommands.REVEAL_IN_NAVIGATOR, UriAwareCommandHandler.MonoSelect(this.selectionService, {
            execute: async uri => {
                if (await this.selectFileNode(uri)) {
                    this.openView({ activate: false, reveal: true });
                }
            },
            isEnabled: uri => !!this.workspaceService.getWorkspaceRootUri(uri),
            isVisible: uri => !!this.workspaceService.getWorkspaceRootUri(uri),
        }));
        registry.registerCommand(FileNavigatorCommands.TOGGLE_HIDDEN_FILES, {
            execute: () => {
                this.fileNavigatorFilter.toggleHiddenFiles();
            },
            isEnabled: () => true,
            isVisible: () => true
        });
        registry.registerCommand(FileNavigatorCommands.TOGGLE_AUTO_REVEAL, {
            isEnabled: widget => this.withWidget(widget, () => this.workspaceService.opened),
            isVisible: widget => this.withWidget(widget, () => this.workspaceService.opened),
            execute: () => {
                const autoReveal = !this.fileNavigatorPreferences['explorer.autoReveal'];
                this.preferenceService.set('explorer.autoReveal', autoReveal, PreferenceScope.User);
                if (autoReveal) {
                    this.selectWidgetFileNode(this.shell.currentWidget);
                }
            },
            isToggled: () => this.fileNavigatorPreferences['explorer.autoReveal']
        });
        registry.registerCommand(FileNavigatorCommands.COLLAPSE_ALL, {
            execute: widget => this.withWidget(widget, () => this.collapseFileNavigatorTree()),
            isEnabled: widget => this.withWidget(widget, () => this.workspaceService.opened),
            isVisible: widget => this.withWidget(widget, () => this.workspaceService.opened)
        });
        registry.registerCommand(FileNavigatorCommands.TOGGLE_SEARCH, {
            execute: widget => this.withWidget(widget, navigator => navigator.toggleSearch()),
            isEnabled: widget => this.withWidget(widget, () => this.workspaceService.opened),
            isVisible: widget => this.withWidget(widget, () => this.workspaceService.opened),
            isToggled: widget => this.withWidget(widget, navigator => navigator.isSearchVisible())
        });
        registry.registerCommand(FileNavigatorCommands.ADD_DATA_SOURCE_TOOLBAR, {
            execute: (...args) => registry.executeCommand(AddDataSourceCommand.id, ...args),
            isEnabled: widget => this.withWidget(widget, () => this.workspaceService.opened),
            isVisible: widget => this.withWidget(widget, () => this.workspaceService.opened)
        });
        registry.registerCommand(FileNavigatorCommands.REFRESH_NAVIGATOR, {
            execute: widget => this.withWidget(widget, () => this.refreshWorkspace()),
            isEnabled: widget => this.withWidget(widget, () => this.workspaceService.opened),
            isVisible: widget => this.withWidget(widget, () => this.workspaceService.opened)
        });
        registry.registerCommand(FileNavigatorCommands.ADD_ROOT_FOLDER, {
            execute: (...args) => registry.executeCommand(WorkspaceCommands.ADD_FOLDER.id, ...args),
            isEnabled: (...args) => registry.isEnabled(WorkspaceCommands.ADD_FOLDER.id, ...args),
            isVisible: (...args) => {
                if (!registry.isVisible(WorkspaceCommands.ADD_FOLDER.id, ...args)) {
                    return false;
                }
                const navigator = this.tryGetWidget();
                const selection = navigator?.model.getFocusedNode();
                // The node that is selected when the user clicks in empty space.
                const root = navigator?.getContainerTreeNode();
                return selection === root;
            }
        });

        registry.registerCommand(NavigatorDiffCommands.COMPARE_FIRST, {
            execute: () => {
                this.navigatorDiff.addFirstComparisonFile();
            },
            isEnabled: () => true,
            isVisible: () => true
        });
        registry.registerCommand(NavigatorDiffCommands.COMPARE_SECOND, {
            execute: () => {
                this.navigatorDiff.compareFiles();
            },
            isEnabled: () => this.navigatorDiff.isFirstFileSelected,
            isVisible: () => this.navigatorDiff.isFirstFileSelected
        });
        registry.registerCommand(FileNavigatorCommands.OPEN, {
            isEnabled: () => this.getSelectedFileNodes().length > 0,
            isVisible: () => this.getSelectedFileNodes().length > 0,
            execute: () => {
                this.getSelectedFileNodes().forEach(async node => {
                    const opener = await this.openerService.getOpener(node.uri);
                    opener.open(node.uri);
                });
            }
        });
        registry.registerCommand(FileNavigatorCommands.OPEN_WITH, UriAwareCommandHandler.MonoSelect(this.selectionService, {
            isEnabled: uri => this.openWithService.getHandlers(uri).length > 0,
            isVisible: uri => this.openWithService.getHandlers(uri).length > 0,
            execute: uri => this.openWithService.openWith(uri)
        }));
        registry.registerCommand(FileNavigatorCommands.INCLUDE_IN_RO_CRATE_DESCRIPTION, {
            execute: (options?: RoCrateDescriptionActionOptions) => this.includeSelectedFilesInRoCrateDescription(options),
            isEnabled: () => this.canIncludeSelectedFiles(),
            isVisible: () => this.getSelectedFileStatNodes().length > 0,
        });
        registry.registerCommand(FileNavigatorCommands.OMIT_FROM_RO_CRATE_DESCRIPTION, {
            execute: (options?: RoCrateDescriptionActionOptions) => this.omitSelectedFilesFromRoCrateDescription(options),
            isEnabled: () => this.canOmitSelectedFiles(),
            isVisible: () => this.getSelectedFileStatNodes().length > 0,
        });

        registry.registerCommand(FileNavigatorCommands.NEW_FILE_TOOLBAR, {
            execute: (...args) => registry.executeCommand(WorkspaceCommands.NEW_FILE.id, ...args),
            isEnabled: widget => this.withWidget(widget, () => this.workspaceService.opened),
            isVisible: widget => this.withWidget(widget, () => this.workspaceService.opened)
        });
        registry.registerCommand(FileNavigatorCommands.NEW_FOLDER_TOOLBAR, {
            execute: (...args) => registry.executeCommand(WorkspaceCommands.NEW_FOLDER.id, ...args),
            isEnabled: widget => this.withWidget(widget, () => this.workspaceService.opened),
            isVisible: widget => this.withWidget(widget, () => this.workspaceService.opened)
        });
    }

    protected getSelectedFileNodes(): FileNode[] {
        return this.tryGetWidget()?.model.selectedNodes.filter(FileNode.is) || [];
    }

    protected getSelectedFileStatNodes(): FileStatNode[] {
        return this.tryGetWidget()?.model.selectedNodes.filter(FileStatNode.is) || [];
    }

    protected canIncludeSelectedFiles(): boolean {
        const selectedResources = this.getSelectedWorkspaceResources();
        if (!selectedResources.length) {
            return false;
        }
        const crate = this.appStateService.roCrate;
        const graph = crate && Array.isArray(crate['@graph'])
            ? (crate['@graph'] as Record<string, any>[])
            : [];
        const ignoredEntries = [...this.roCrateIgnoredFilesService.getIgnoredPaths()];

        return selectedResources.some(resource => this.canIncludeResource(resource, graph, ignoredEntries));
    }

    protected canOmitSelectedFiles(): boolean {
        const selectedResources = this.getSelectedWorkspaceResources();
        if (!selectedResources.length) {
            return false;
        }
        return selectedResources.some(resource => !this.roCrateIgnoredFilesService.isIgnoredPath(resource.path));
    }

    protected canIncludeResource(
        resource: { path: string; isDirectory: boolean; uri: URI },
        graph: ReadonlyArray<Record<string, any>>,
        ignoredEntries: readonly string[],
    ): boolean {
        const normalizedPath = this.normalizeRelativePath(resource.path).toLowerCase();
        if (!normalizedPath) {
            return false;
        }

        if (!resource.isDirectory) {
            if (this.roCrateIgnoredFilesService.isIgnoredPath(normalizedPath)) {
                return true;
            }
            return this.findFileEntityMatchesByRelativePath([...graph], normalizedPath).length === 0;
        }

        if (this.hasIgnoredChildrenInDirectory(normalizedPath, ignoredEntries)) {
            return true;
        }

        return this.findDatasetEntityMatchesByRelativePath([...graph], normalizedPath).length === 0;
    }

    protected hasIgnoredChildrenInDirectory(
        directoryPath: string,
        ignoredEntries: readonly string[],
    ): boolean {
        const normalizedDirectory = this.normalizeRelativePath(directoryPath).toLowerCase();
        if (!normalizedDirectory) {
            return false;
        }

        if (this.roCrateIgnoredFilesService.isIgnoredPath(normalizedDirectory)) {
            return true;
        }

        const directoryPrefix = `${normalizedDirectory}/`;
        for (const rawEntry of ignoredEntries) {
            const trimmed = (rawEntry || '').trim();
            if (!trimmed || trimmed.startsWith('!')) {
                continue;
            }

            const directoryOnly = trimmed.endsWith('/');
            const entryBody = directoryOnly ? trimmed.slice(0, -1) : trimmed;
            if (!entryBody) {
                continue;
            }

            if (!this.hasGlobMagic(entryBody)) {
                if (
                    entryBody === normalizedDirectory ||
                    entryBody.startsWith(directoryPrefix)
                ) {
                    return true;
                }
                continue;
            }

            if (!entryBody.includes('/')) {
                return true;
            }

            const staticPrefix = entryBody.split(/[*?[\]{}]/, 1)[0];
            const normalizedPrefix = this.normalizeRelativePath(staticPrefix).toLowerCase();
            if (!normalizedPrefix) {
                return true;
            }
            if (
                normalizedPrefix === normalizedDirectory ||
                normalizedPrefix.startsWith(directoryPrefix) ||
                normalizedDirectory.startsWith(`${normalizedPrefix}/`)
            ) {
                return true;
            }
        }

        return false;
    }

    protected hasGlobMagic(value: string): boolean {
        return /[*?[\]{}]/.test(value);
    }

    protected async includeSelectedFilesInRoCrateDescription(
        options?: RoCrateDescriptionActionOptions,
    ): Promise<IncludeResourcesResult | undefined> {
        const selectedResources = this.resolveResourcesForRoCrateAction(options);
        const silent = Boolean(options?.silent);
        if (!selectedResources.length) {
            if (!silent) {
                this.messageService.info('No eligible file or folder selected.');
            }
            return undefined;
        }
        const result = await this.roCrateDescriptionOperationsService.includeResources(selectedResources);
        if (silent) {
            return result;
        }

        if (!result.metadataLoaded) {
            this.messageService.info('Updated include rules in memory. Save to persist changes to .aroma/ignored.txt.');
            return result;
        }

        if (result.addedFiles === 0 && result.addedDatasets === 0 && result.linkedReferences === 0) {
            this.messageService.info('Updated include rules in memory. RO-Crate descriptions were already up to date.');
            return result;
        }

        const fileLabel = result.addedFiles === 1 ? '1 file' : `${result.addedFiles} files`;
        const datasetLabel = result.addedDatasets === 1 ? '1 dataset' : `${result.addedDatasets} datasets`;
        this.messageService.info(`Included ${fileLabel} and ${datasetLabel} in RO-Crate description.`);
        return result;
    }

    protected async omitSelectedFilesFromRoCrateDescription(
        options?: RoCrateDescriptionActionOptions,
    ): Promise<OmitResourcesResult | undefined> {
        const selectedResources = this.resolveResourcesForRoCrateAction(options);
        const silent = Boolean(options?.silent);
        if (!selectedResources.length) {
            if (!silent) {
                this.messageService.info('No eligible file or folder selected.');
            }
            return undefined;
        }
        const result = await this.roCrateDescriptionOperationsService.omitResources(selectedResources);

        if (silent) {
            return result;
        }

        if (result.pairedDescriptionCount === 0) {
            this.messageService.info('Marked selected files/folders as omitted in memory. Save to persist changes to .aroma/ignored.txt.');
            return result;
        }

        if (!result.metadataLoaded) {
            this.messageService.info('Marked selected files/folders as omitted in memory. Save to persist changes to .aroma/ignored.txt.');
            return result;
        }

        if (result.removedDescriptionCount === 0) {
            this.messageService.info('Marked selected files/folders as omitted in memory. RO-Crate descriptions were already up to date.');
            return result;
        }

        this.messageService.info(
            result.removedDescriptionCount === 1
                ? 'Omitted 1 file/folder and removed its RO-Crate description.'
                : `Omitted ${result.removedDescriptionCount} files/folders and removed their RO-Crate descriptions.`,
        );
        return result;
    }

    protected resolveResourcesForRoCrateAction(
        options?: RoCrateDescriptionActionOptions,
    ): RoCrateWorkspaceResource[] {
        const resources = options?.resources;
        if (!resources || resources.length === 0) {
            return this.getSelectedWorkspaceResources();
        }

        const normalizedResources: RoCrateWorkspaceResource[] = [];
        const seen = new Set<string>();
        for (const resource of resources) {
            const normalizedPath = this.normalizeRelativePath(resource.path);
            if (!normalizedPath || normalizedPath === 'ro-crate-metadata.json') {
                continue;
            }

            const key = `${normalizedPath.toLowerCase()}${resource.isDirectory ? '/' : ''}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            let uri: URI | undefined;
            if (resource.uri instanceof URI) {
                uri = resource.uri;
            } else if (typeof resource.uri === 'string' && resource.uri.trim().length > 0) {
                try {
                    uri = new URI(resource.uri);
                } catch {
                    uri = undefined;
                }
            }

            normalizedResources.push({
                path: normalizedPath,
                isDirectory: resource.isDirectory,
                uri
            });
        }

        return normalizedResources;
    }

    protected getSelectedWorkspaceResources(): Array<{ path: string; isDirectory: boolean; uri: URI }> {
        const seen = new Set<string>();
        const results: Array<{ path: string; isDirectory: boolean; uri: URI }> = [];
        for (const node of this.getSelectedFileStatNodes()) {
            const relativePath = this.getWorkspaceRelativePath(node.uri);
            if (!relativePath) {
                continue;
            }
            const normalized = this.normalizeRelativePath(relativePath);
            if (!normalized || normalized === 'ro-crate-metadata.json') {
                continue;
            }
            const isDirectory = DirNode.is(node);
            const key = `${normalized}${isDirectory ? '/' : ''}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            results.push({ path: normalized, isDirectory, uri: node.uri });
        }
        return results;
    }

    protected async collectSelectedInclusionPaths(
        selectedResources: ReadonlyArray<{ path: string; isDirectory: boolean; uri: URI }>,
    ): Promise<{ filePaths: Set<string>; directoryPaths: Set<string> }> {
        const filePaths = new Set<string>();
        const directoryPaths = new Set<string>();

        for (const selected of selectedResources) {
            const selectedPath = this.normalizeRelativePath(selected.path);
            if (!selectedPath) {
                continue;
            }

            if (!selected.isDirectory) {
                filePaths.add(selectedPath);
                continue;
            }
            directoryPaths.add(selectedPath);

            let fileUris: string[] = [];
            try {
                fileUris = await this.fileSearchService.find('', {
                    rootUris: [selected.uri.toString()],
                });
            } catch (error) {
                console.warn('Failed to resolve selected directory files for include operation:', error);
                continue;
            }

            for (const fileUri of fileUris) {
                const relative = this.getWorkspaceRelativePath(new URI(fileUri));
                if (!relative) {
                    continue;
                }
                const normalized = this.normalizeRelativePath(relative);
                if (!normalized || normalized === 'ro-crate-metadata.json') {
                    continue;
                }
                filePaths.add(normalized);

                const parentDirectories = this.collectParentDirectories(normalized);
                for (const directoryPath of parentDirectories) {
                    if (
                        directoryPath === selectedPath ||
                        directoryPath.startsWith(`${selectedPath}/`)
                    ) {
                        directoryPaths.add(directoryPath);
                    }
                }
            }
        }

        return { filePaths, directoryPaths };
    }

    protected collectParentDirectories(path: string): string[] {
        const normalized = this.normalizeRelativePath(path);
        if (!normalized) {
            return [];
        }
        const segments = normalized.split('/').filter(Boolean);
        if (segments.length < 2) {
            return [];
        }

        const directories: string[] = [];
        for (let index = 1; index < segments.length; index += 1) {
            directories.push(segments.slice(0, index).join('/'));
        }
        return directories;
    }

    protected countPathSegments(path: string): number {
        const normalized = this.normalizeRelativePath(path);
        if (!normalized) {
            return 0;
        }
        return normalized.split('/').filter(Boolean).length;
    }

    protected resolveInclusionParentContainer(
        path: string,
        datasetEntitiesByPath: Map<string, Record<string, any>>,
        rootEntity: Record<string, any> | undefined,
    ): Record<string, any> | undefined {
        const normalizedPath = this.normalizeRelativePath(path);
        if (!normalizedPath) {
            return rootEntity;
        }
        const parentPath = this.getParentPath(normalizedPath);
        if (!parentPath) {
            return rootEntity;
        }

        const normalizedParentPath = this.normalizeRelativePath(parentPath).toLowerCase();
        if (!normalizedParentPath) {
            return rootEntity;
        }
        if (this.roCrateIgnoredFilesService.isIgnoredPath(normalizedParentPath)) {
            return rootEntity;
        }

        return datasetEntitiesByPath.get(normalizedParentPath) ?? rootEntity;
    }

    protected getParentPath(path: string): string | undefined {
        const normalized = this.normalizeRelativePath(path);
        if (!normalized) {
            return undefined;
        }
        const lastSeparatorIndex = normalized.lastIndexOf('/');
        if (lastSeparatorIndex === -1) {
            return undefined;
        }
        return normalized.slice(0, lastSeparatorIndex);
    }

    protected collectEntityIdsForResources(
        graph: Record<string, any>[],
        selectedResources: ReadonlyArray<{ path: string; isDirectory: boolean; uri: URI }>,
    ): Set<string> {
        const idsToRemove = new Set<string>();
        const resources = selectedResources.map(resource => ({
            path: this.normalizeRelativePath(resource.path).toLowerCase(),
            isDirectory: resource.isDirectory,
        }));

        for (const entry of graph) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            if (!this.entityHasType(entry, 'File') && !this.entityHasType(entry, 'Dataset')) {
                continue;
            }
            const rawId = typeof entry['@id'] === 'string' ? entry['@id'] : '';
            if (!rawId) {
                continue;
            }
            const derivedPath = this.deriveRelativePathFromEntityId(rawId);
            if (!derivedPath) {
                continue;
            }
            const normalizedPath = this.normalizeRelativePath(derivedPath).toLowerCase();
            if (!normalizedPath) {
                continue;
            }

            for (const resource of resources) {
                if (!resource.path) {
                    continue;
                }
                if (resource.isDirectory) {
                    if (
                        normalizedPath === resource.path ||
                        normalizedPath.startsWith(`${resource.path}/`)
                    ) {
                        idsToRemove.add(rawId);
                        break;
                    }
                } else if (normalizedPath === resource.path) {
                    idsToRemove.add(rawId);
                    break;
                }
            }
        }

        return idsToRemove;
    }

    protected getWorkspaceRelativePath(uri: URI): string | undefined {
        const rootUri = this.workspaceService.getWorkspaceRootUri(uri);
        if (!rootUri) {
            return undefined;
        }
        const relative = rootUri.relative(uri);
        if (!relative) {
            return undefined;
        }
        const normalized = this.normalizeRelativePath(relative.toString());
        return normalized || undefined;
    }

    protected normalizeRelativePath(path: string): string {
        let normalized = path.replace(/\\/g, '/').trim();
        normalized = normalized.replace(/^\.?\//, '');
        normalized = normalized.replace(/^\/+/, '');
        normalized = normalized.replace(/\/{2,}/g, '/');
        while (normalized.endsWith('/') && normalized.length > 1) {
            normalized = normalized.slice(0, -1);
        }
        return normalized;
    }

    protected findFileEntityMatchesByRelativePath(
        graph: Record<string, any>[],
        relativePath: string,
    ): Array<{ id: string; index: number }> {
        const target = this.normalizeRelativePath(relativePath).toLowerCase();
        const matches: Array<{ id: string; index: number }> = [];

        for (let index = 0; index < graph.length; index += 1) {
            const entry = graph[index];
            if (!entry || typeof entry !== 'object' || !this.entityHasType(entry, 'File')) {
                continue;
            }
            const rawId = typeof entry['@id'] === 'string' ? entry['@id'] : '';
            if (!rawId) {
                continue;
            }
            const derivedPath = this.deriveRelativePathFromEntityId(rawId);
            if (!derivedPath) {
                continue;
            }
            if (derivedPath.toLowerCase() === target) {
                matches.push({ id: rawId, index });
            }
        }

        return matches;
    }

    protected findDatasetEntityMatchesByRelativePath(
        graph: Record<string, any>[],
        relativePath: string,
    ): Array<{ id: string; index: number }> {
        const target = this.normalizeRelativePath(relativePath).toLowerCase();
        const matches: Array<{ id: string; index: number }> = [];

        for (let index = 0; index < graph.length; index += 1) {
            const entry = graph[index];
            if (!entry || typeof entry !== 'object' || !this.entityHasType(entry, 'Dataset')) {
                continue;
            }
            const rawId = typeof entry['@id'] === 'string' ? entry['@id'] : '';
            if (!rawId) {
                continue;
            }
            const derivedPath = this.deriveRelativePathFromEntityId(rawId);
            if (!derivedPath) {
                continue;
            }
            if (derivedPath.toLowerCase() === target) {
                matches.push({ id: rawId, index });
            }
        }

        return matches;
    }

    protected deriveRelativePathFromEntityId(entityId: string): string | undefined {
        let candidate = entityId.trim();
        if (!candidate) {
            return undefined;
        }

        if (candidate.startsWith('file://./')) {
            candidate = candidate.slice('file://./'.length);
        } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
            return undefined;
        }

        if (candidate.startsWith('./')) {
            candidate = candidate.slice(2);
        }

        return this.normalizeRelativePath(candidate) || undefined;
    }

    protected entityHasType(entity: Record<string, any>, type: string): boolean {
        const rawType = entity['@type'];
        if (Array.isArray(rawType)) {
            return rawType.includes(type);
        }
        return rawType === type;
    }

    protected async buildFileEntity(relativePath: string): Promise<Record<string, any>> {
        const name = relativePath.split('/').pop() ?? relativePath;
        const fileEntity: Record<string, any> = {
            '@id': relativePath,
            '@type': 'File',
            name,
        };

        const roots = this.workspaceService.tryGetRoots();
        const rootUri = roots && roots.length > 0 ? roots[0].resource : undefined;
        if (!rootUri) {
            return fileEntity;
        }

        try {
            const fileUri = rootUri.resolve(relativePath);
            const fileStat = await this.fileService.resolve(fileUri, { resolveMetadata: true });
            if (!fileStat.isDirectory && typeof fileStat.size === 'number' && fileStat.size >= 0) {
                fileEntity.contentSize = `${fileStat.size}`;
            }
        } catch (error) {
            console.warn(`Failed to read file size for "${relativePath}" while including into RO-Crate:`, error);
        }

        return fileEntity;
    }

    protected buildDatasetEntity(relativePath: string): Record<string, any> {
        const normalizedPath = this.normalizeRelativePath(relativePath);
        const name = normalizedPath.split('/').pop() ?? normalizedPath;
        return {
            '@id': `${normalizedPath}/`,
            '@type': 'Dataset',
            name,
            hasPart: [],
        };
    }

    protected normalizeHasPart(value: unknown): Array<{ '@id': string }> {
        if (!value) {
            return [];
        }
        const raw = Array.isArray(value) ? value : [value];
        const normalized: Array<{ '@id': string }> = [];
        for (const entry of raw) {
            if (!entry) {
                continue;
            }
            if (typeof entry === 'string') {
                normalized.push({ '@id': entry });
                continue;
            }
            if (typeof entry === 'object') {
                const id = (entry as Record<string, any>)['@id'] ?? (entry as Record<string, any>).id;
                if (typeof id === 'string') {
                    normalized.push({ '@id': id });
                }
            }
        }
        return normalized;
    }

    protected removeEntitiesAndReferences(
        graph: Record<string, any>[],
        idsToRemove: Set<string>,
    ): Record<string, any>[] {
        const filtered = graph.filter((entry) => {
            const id = typeof entry?.['@id'] === 'string' ? entry['@id'] : '';
            return !idsToRemove.has(id);
        });

        const cleaned: Record<string, any>[] = [];
        for (const entity of filtered) {
            const normalized = this.removeReferencesFromValue(entity, idsToRemove);
            if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
                cleaned.push(normalized as Record<string, any>);
            }
        }
        return cleaned;
    }

    protected removeReferencesFromValue(
        value: unknown,
        idsToRemove: Set<string>,
    ): unknown {
        if (Array.isArray(value)) {
            const nextArray = value
                .map(item => this.removeReferencesFromValue(item, idsToRemove))
                .filter(item => item !== undefined);
            return nextArray;
        }

        if (value && typeof value === 'object') {
            const asObject = value as Record<string, unknown>;
            const referenceId = this.extractReferenceId(asObject);
            if (referenceId && idsToRemove.has(referenceId) && this.isReferenceObject(asObject)) {
                return undefined;
            }

            const nextObject: Record<string, unknown> = {};
            for (const [key, child] of Object.entries(asObject)) {
                const normalized = this.removeReferencesFromValue(child, idsToRemove);
                if (normalized === undefined) {
                    continue;
                }
                if (Array.isArray(normalized) && normalized.length === 0) {
                    continue;
                }
                nextObject[key] = normalized;
            }
            return nextObject;
        }

        return value;
    }

    protected extractReferenceId(value: Record<string, unknown>): string | undefined {
        const idValue = value['@id'] ?? value.id;
        return typeof idValue === 'string' ? idValue : undefined;
    }

    protected isReferenceObject(value: Record<string, unknown>): boolean {
        const keys = Object.keys(value);
        if (keys.length !== 1) {
            return false;
        }
        return keys[0] === '@id' || keys[0] === 'id';
    }

    protected cloneValue<T>(value: T): T {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return value;
        }
    }

    protected withWidget<T>(widget: Widget | undefined = this.tryGetWidget(), cb: (navigator: FileNavigatorWidget) => T): T | false {
        if (widget instanceof FileNavigatorWidget && widget.id === FILE_NAVIGATOR_ID) {
            return cb(widget);
        }
        return false;
    }

    override registerMenus(registry: MenuModelRegistry): void {
        super.registerMenus(registry);
        registry.registerMenuAction(SHELL_TABBAR_CONTEXT_REVEAL, {
            commandId: FileNavigatorCommands.REVEAL_IN_NAVIGATOR.id,
            label: FileNavigatorCommands.REVEAL_IN_NAVIGATOR.label,
            order: '5'
        });

        registry.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: FileNavigatorCommands.OPEN.id,
            label: nls.localizeByDefault('Open')
        });
        registry.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: FileNavigatorCommands.OPEN_WITH.id,
            when: '!explorerResourceIsFolder',
            label: nls.localizeByDefault('Open With...')
        });

        registry.registerMenuAction(NavigatorContextMenu.CLIPBOARD, {
            commandId: CommonCommands.COPY.id,
            order: 'a'
        });
        registry.registerMenuAction(NavigatorContextMenu.CLIPBOARD, {
            commandId: CommonCommands.PASTE.id,
            order: 'b'
        });
        registry.registerMenuAction(NavigatorContextMenu.CLIPBOARD, {
            commandId: CommonCommands.COPY_PATH.id,
            order: 'c'
        });
        registry.registerMenuAction(NavigatorContextMenu.CLIPBOARD, {
            commandId: WorkspaceCommands.COPY_RELATIVE_FILE_PATH.id,
            label: WorkspaceCommands.COPY_RELATIVE_FILE_PATH.label,
            order: 'd'
        });
        registry.registerMenuAction(NavigatorContextMenu.CLIPBOARD, {
            commandId: FileDownloadCommands.COPY_DOWNLOAD_LINK.id,
            order: 'z'
        });

        registry.registerMenuAction(NavigatorContextMenu.MODIFICATION, {
            commandId: WorkspaceCommands.FILE_RENAME.id
        });
        registry.registerMenuAction(NavigatorContextMenu.MODIFICATION, {
            commandId: WorkspaceCommands.FILE_DELETE.id
        });
        registry.registerMenuAction(NavigatorContextMenu.MODIFICATION, {
            commandId: WorkspaceCommands.FILE_DUPLICATE.id
        });

        const downloadUploadMenu = [...NAVIGATOR_CONTEXT_MENU, '6_downloadupload'];
        registry.registerMenuAction(downloadUploadMenu, {
            commandId: FileSystemCommands.UPLOAD.id,
            order: 'a'
        });
        registry.registerMenuAction(downloadUploadMenu, {
            commandId: FileDownloadCommands.DOWNLOAD.id,
            order: 'b'
        });
        registry.registerMenuAction(NavigatorContextMenu.RO_CRATE_DESCRIPTION, {
            commandId: FileNavigatorCommands.INCLUDE_IN_RO_CRATE_DESCRIPTION.id,
            order: 'a',
        });
        registry.registerMenuAction(NavigatorContextMenu.RO_CRATE_DESCRIPTION, {
            commandId: FileNavigatorCommands.OMIT_FROM_RO_CRATE_DESCRIPTION.id,
            order: 'b',
        });

        registry.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: WorkspaceCommands.NEW_FILE.id,
            when: 'explorerResourceIsFolder'
        });
        registry.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: WorkspaceCommands.NEW_FOLDER.id,
            when: 'explorerResourceIsFolder'
        });
        registry.registerMenuAction(NavigatorContextMenu.COMPARE, {
            commandId: WorkspaceCommands.FILE_COMPARE.id
        });
        registry.registerMenuAction(NavigatorContextMenu.MODIFICATION, {
            commandId: FileNavigatorCommands.COLLAPSE_ALL.id,
            label: nls.localizeByDefault('Collapse All'),
            order: 'z2'
        });

        registry.registerMenuAction(NavigatorContextMenu.COMPARE, {
            commandId: NavigatorDiffCommands.COMPARE_FIRST.id,
            order: 'za'
        });
        registry.registerMenuAction(NavigatorContextMenu.COMPARE, {
            commandId: NavigatorDiffCommands.COMPARE_SECOND.id,
            order: 'zb'
        });

        registry.registerMenuAction(NavigatorContextMenu.WORKSPACE, {
            commandId: FileNavigatorCommands.ADD_ROOT_FOLDER.id,
            label: WorkspaceCommands.ADD_FOLDER.label
        });
        registry.registerMenuAction(NavigatorContextMenu.WORKSPACE, {
            commandId: WorkspaceCommands.REMOVE_FOLDER.id
        });
    }

    override registerKeybindings(registry: KeybindingRegistry): void {
        super.registerKeybindings(registry);
        registry.registerKeybinding({
            command: FileNavigatorCommands.REVEAL_IN_NAVIGATOR.id,
            keybinding: 'alt+r'
        });

        registry.registerKeybinding({
            command: WorkspaceCommands.FILE_DELETE.id,
            keybinding: isOSX ? 'cmd+backspace' : 'del',
            when: 'filesExplorerFocus'
        });

        registry.registerKeybinding({
            command: WorkspaceCommands.FILE_RENAME.id,
            keybinding: 'f2',
            when: 'filesExplorerFocus'
        });

        registry.registerKeybinding({
            command: FileNavigatorCommands.TOGGLE_HIDDEN_FILES.id,
            keybinding: 'ctrlcmd+i',
            when: 'filesExplorerFocus'
        });
    }

    async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
        toolbarRegistry.registerItem({
            id: FileNavigatorCommands.TOGGLE_SEARCH.id,
            command: FileNavigatorCommands.TOGGLE_SEARCH.id,
            tooltip: FileNavigatorCommands.TOGGLE_SEARCH.label,
            priority: 0,
        });
        toolbarRegistry.registerItem({
            id: FileNavigatorCommands.ADD_DATA_SOURCE_TOOLBAR.id,
            command: FileNavigatorCommands.ADD_DATA_SOURCE_TOOLBAR.id,
            tooltip: AddDataSourceCommand.label,
            priority: 0.5,
        });
        toolbarRegistry.registerItem({
            id: FileNavigatorCommands.COLLAPSE_ALL.id,
            command: FileNavigatorCommands.COLLAPSE_ALL.id,
            tooltip: nls.localizeByDefault('Collapse All'),
            priority: 1,
        });

    }

    /**
     * Register commands to the `More Actions...` navigator toolbar item.
     */
    public registerMoreToolbarItem = (item: Mutable<RenderedToolbarAction> & { command: string }) => {
        const commandId = item.command;
        const id = 'navigator.tabbar.toolbar.' + commandId;
        const command = this.commandRegistry.getCommand(commandId);
        this.commandRegistry.registerCommand({ id, iconClass: command && command.iconClass }, {
            execute: (w, ...args) => w instanceof FileNavigatorWidget
                && this.commandRegistry.executeCommand(commandId, ...args),
            isEnabled: (w, ...args) => w instanceof FileNavigatorWidget
                && this.commandRegistry.isEnabled(commandId, ...args),
            isVisible: (w, ...args) => w instanceof FileNavigatorWidget
                && this.commandRegistry.isVisible(commandId, ...args),
            isToggled: (w, ...args) => w instanceof FileNavigatorWidget
                && this.commandRegistry.isToggled(commandId, ...args),
        });
        item.command = id;
        this.tabbarToolbarRegistry.registerItem(item);
    };

    /**
     * Reveals and selects node in the file navigator to which given widget is related.
     * Does nothing if given widget undefined or doesn't have related resource.
     *
     * @param widget widget file resource of which should be revealed and selected
     */
    async selectWidgetFileNode(widget: Widget | undefined): Promise<boolean> {
        return this.selectFileNode(NavigatableWidget.getUri(widget));
    }

    async selectFileNode(uri?: URI): Promise<boolean> {
        if (uri) {
            const { model } = await this.widget;
            const node = await model.revealFile(uri);
            if (SelectableTreeNode.is(node)) {
                model.selectNode(node);
                return true;
            }
        }
        return false;
    }

    protected onCurrentWidgetChangedHandler(): void {
        if (this.fileNavigatorPreferences['explorer.autoReveal']) {
            this.selectWidgetFileNode(this.shell.currentWidget);
        }
    }

    /**
     * Collapse file navigator nodes and set focus on first visible node
     * - single root workspace: collapse all nodes except root
     * - multiple root workspace: collapse all nodes, even roots
     */
    async collapseFileNavigatorTree(): Promise<void> {
        const { model } = await this.widget;

        // collapse all child nodes which are not the root (single root workspace)
        // collapse all root nodes (multiple root workspace)
        let root = model.root as CompositeTreeNode;
        if (WorkspaceNode.is(root) && root.children.length === 1) {
            const onlyChild = root.children[0];
            if (CompositeTreeNode.is(onlyChild)) {
                root = onlyChild;
            }
        }
        root.children.forEach(child => CompositeTreeNode.is(child) && model.collapseAll(child));

        // select first visible node
        const firstChild = WorkspaceNode.is(root) ? root.children[0] : root;
        if (SelectableTreeNode.is(firstChild)) {
            model.selectNode(firstChild);
        }
    }

    /**
     * force refresh workspace in navigator
     */
    async refreshWorkspace(): Promise<void> {
        const { model } = await this.widget;
        await model.refresh();
    }

}
