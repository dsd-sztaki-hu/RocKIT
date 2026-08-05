// *****************************************************************************
// Copyright (C) 2017 TypeFox and others.
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

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileNode, FileTreeModel } from '@theia/filesystem/lib/browser';
import { OpenerService, open, TreeNode, ExpandableTreeNode, CompositeTreeNode, SelectableTreeNode } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common/command';
import { FileNavigatorTree, NavigatorHeaderNode, NavigatorRootNode, WorkspaceNode } from './navigator-tree';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { ProgressService } from '@theia/core/lib/common/progress-service';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { Disposable } from '@theia/core/lib/common/disposable';
import { DataSourceService } from 'data-sources/lib/browser/data-source-service';
import { nls } from '@theia/core/lib/common/nls';
import { OpenRoCrateEntityForResourceCommand } from 'rockit-common/lib/browser';

@injectable()
export class FileNavigatorModel extends FileTreeModel {

    @inject(OpenerService) protected readonly openerService: OpenerService;
    @inject(FileNavigatorTree) protected override readonly tree: FileNavigatorTree;
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService;
    @inject(FrontendApplicationStateService) protected readonly applicationState: FrontendApplicationStateService;
    @inject(DataSourceService) protected readonly dataSourceService: DataSourceService;
    @inject(CommandService) protected readonly commandService: CommandService;

    @inject(ProgressService)
    protected readonly progressService: ProgressService;

    @postConstruct()
    protected override init(): void {
        super.init();
        this.reportBusyProgress();
        this.initializeRoot();
    }

    protected readonly pendingBusyProgress = new Map<string, Deferred<void>>();
    protected reportBusyProgress(): void {
        this.toDispose.push(this.onDidChangeBusy(node => {
            const pending = this.pendingBusyProgress.get(node.id);
            if (pending) {
                if (!node.busy) {
                    pending.resolve();
                    this.pendingBusyProgress.delete(node.id);
                }
                return;
            }
            if (node.busy) {
                const progress = new Deferred<void>();
                this.pendingBusyProgress.set(node.id, progress);
                this.progressService.withProgress('', 'explorer', () => progress.promise);
            }
        }));
        this.toDispose.push(Disposable.create(() => {
            for (const pending of this.pendingBusyProgress.values()) {
                pending.resolve();
            }
            this.pendingBusyProgress.clear();
        }));
    }

    protected async initializeRoot(): Promise<void> {
        await Promise.all([
            this.applicationState.reachedState('initialized_layout'),
            this.workspaceService.roots,
            this.dataSourceService.ready
        ]);
        await this.updateRoot();
        if (this.toDispose.disposed) {
            return;
        }
        this.toDispose.push(this.workspaceService.onWorkspaceChanged(() => this.updateRoot()));
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => this.updateRoot()));
        this.toDispose.push(this.dataSourceService.onDidChange(() => this.updateRoot()));
        if (this.selectedNodes.length) {
            return;
        }
        const root = this.root;
        if (CompositeTreeNode.is(root) && root.children.length === 1) {
            const child = root.children[0];
            if (SelectableTreeNode.is(child) && !child.selected && ExpandableTreeNode.is(child)) {
                this.selectNode(child);
                this.expandNode(child);
            }
        }
    }

    previewNode(node: TreeNode): void {
        if (FileNode.is(node)) {
            void this.openPreviewNode(node);
        }
    }

    protected async openPreviewNode(node: FileNode): Promise<void> {
        const extension = node.uri.path.ext.toLowerCase();
        if (extension === '.csv' || extension === '.tsv' || extension === '.tab') {
            try {
                // The CSV editor is a VS Code extension and expects a vscode.Uri.
                // A Theia URI is not revived when it is passed directly through the
                // frontend command registry, causing the extension to edit the
                // previously active document instead. Activate the requested file
                // first and let the extension use the active text editor.
                await open(this.openerService, node.uri, { mode: 'activate', preview: true });
                await this.commandService.executeCommand('edit-csv.edit');
                return;
            } catch (error) {
                console.warn('Failed to open the CSV table editor.', error);
            }
        }

        await open(this.openerService, node.uri, { mode: 'reveal', preview: true });
    }

    protected override doOpenNode(node: TreeNode): void {
        if (node.visible === false) {
            return;
        } else if (FileNode.is(node)) {
            void this.openFileNode(node);
        }
    }

    protected async openFileNode(node: FileNode): Promise<void> {
        try {
            const openedInRoCrate = await this.commandService.executeCommand<boolean>(
                OpenRoCrateEntityForResourceCommand.id,
                node.uri,
            );
            if (openedInRoCrate) {
                return;
            }
        } catch (error) {
            console.warn('Failed to open the file entity in ReCrate.', error);
        }

        await open(this.openerService, node.uri);
    }

    override *getNodesByUri(uri: URI): IterableIterator<TreeNode> {
        const workspace = this.root;
        if (WorkspaceNode.is(workspace)) {
            for (const child of workspace.children) {
                const roots = NavigatorHeaderNode.is(child) ? [] : [child];
                for (const root of roots) {
                    if (!NavigatorRootNode.is(root)) {
                        continue;
                    }
                    const id = this.tree.createId(root, uri);
                    const node = this.getNode(id);
                    if (node) {
                        yield node;
                    }
                }
            }
        }
    }

    protected async updateRoot(): Promise<void> {
        this.root = await this.createRoot();
    }

    protected async createRoot(): Promise<TreeNode | undefined> {
        const roots: TreeNode[] = [];
        const workspaceRoots = await this.workspaceService.roots;
        const dataSourceUris = this.dataSourceService.getAll();

        let workspaceNode: WorkspaceNode | undefined;
        if (this.workspaceService.opened) {
            const stat = this.workspaceService.workspace;
            const isMulti = (stat) ? !stat.isDirectory : false;
            workspaceNode = isMulti ? this.createMultipleRootNode() : WorkspaceNode.createRoot();
        }

        if (!workspaceNode) {
            workspaceNode = WorkspaceNode.createRoot(nls.localize(
                'rockit/fileExplorer/dataSources',
                'Data Sources',
            ));
        }

        const useGrouping = dataSourceUris.length > 0;
        const workspaceHeader = useGrouping
            ? NavigatorHeaderNode.create(
                'workspace',
                nls.localize('rockit/fileExplorer/roCrateContainer', 'RO-Crate Container'),
                workspaceNode,
            )
            : undefined;
        const dataSourceHeader = useGrouping
            ? NavigatorHeaderNode.create(
                'data-source',
                nls.localize('rockit/fileExplorer/dataSources', 'Data Sources'),
                workspaceNode,
            )
            : undefined;

        const workspaceNodes: TreeNode[] = [];
        if (this.workspaceService.opened) {
            for (const root of workspaceRoots) {
                workspaceNodes.push(await this.tree.createWorkspaceRoot(root, workspaceNode));
            }
        }

        for (const uri of dataSourceUris) {
            if (workspaceRoots.some((root) => root.resource.toString() === uri.toString())) {
                continue;
            }
            try {
                const stat = await this.fileService.resolve(uri);
                if (!stat || !stat.isDirectory) {
                    continue;
                }
                const node = await this.tree.createDataSourceRoot(stat, workspaceNode);
                roots.push(node);
            } catch {
                // ignore missing data sources
            }
        }

        const dataSourceNodes = roots.splice(0, roots.length);
        if (workspaceHeader && workspaceNodes.length > 0) {
            roots.push(workspaceHeader, ...workspaceNodes);
        } else {
            roots.push(...workspaceNodes);
        }
        if (dataSourceHeader && dataSourceNodes.length > 0) {
            roots.push(dataSourceHeader, ...dataSourceNodes);
        } else {
            roots.push(...dataSourceNodes);
        }

        if (roots.length === 0) {
            return undefined;
        }

        (workspaceNode.children as TreeNode[]).push(...roots);
        return workspaceNode;
    }

    /**
     * Create multiple root node used to display
     * the multiple root workspace name.
     *
     * @returns `WorkspaceNode`
     */
    protected createMultipleRootNode(): WorkspaceNode {
        const workspace = this.workspaceService.workspace;
        let name = workspace
            ? workspace.resource.path.name
            : nls.localize('rockit/fileExplorer/untitled', 'untitled');
        name = nls.localize('rockit/fileExplorer/workspaceName', '{0} (Workspace)', name);
        return WorkspaceNode.createRoot(name);
    }

    /**
     * Move the given source file or directory to the given target directory.
     */
    override async move(source: TreeNode, target: TreeNode): Promise<URI | undefined> {
        if (source.parent && NavigatorRootNode.is(source)) {
            // do not support moving a root folder
            return undefined;
        }
        return super.move(source, target);
    }

    /**
     * Reveals node in the navigator by given file uri.
     *
     * @param uri uri to file which should be revealed in the navigator
     * @returns file tree node if the file with given uri was revealed, undefined otherwise
     */
    async revealFile(uri: URI): Promise<TreeNode | undefined> {
        if (!uri.path.isAbsolute) {
            return undefined;
        }
        let node = this.getNodeClosestToRootByUri(uri);

        // success stop condition
        // we have to reach workspace root because expanded node could be inside collapsed one
        if (NavigatorRootNode.is(node)) {
            if (ExpandableTreeNode.is(node)) {
                if (!node.expanded) {
                    node = await this.expandNode(node);
                }
                return node;
            }
            // shouldn't happen, root node is always directory, i.e. expandable
            return undefined;
        }

        // fail stop condition
        if (uri.path.isRoot) {
            // file system root is reached but workspace root wasn't found, it means that
            // given uri is not in workspace root folder or points to not existing file.
            return undefined;
        }

        if (await this.revealFile(uri.parent)) {
            if (node === undefined) {
                // get node if it wasn't mounted into navigator tree before expansion
                node = this.getNodeClosestToRootByUri(uri);
            }
            if (ExpandableTreeNode.is(node) && !node.expanded) {
                node = await this.expandNode(node);
            }
            return node;
        }
        return undefined;
    }

    protected getNodeClosestToRootByUri(uri: URI): TreeNode | undefined {
        const nodes = [...this.getNodesByUri(uri)];
        return nodes.length > 0
            ? nodes.reduce((node1, node2) => // return the node closest to the workspace root
                node1.id.length >= node2.id.length ? node1 : node2
            ) : undefined;
    }
}
