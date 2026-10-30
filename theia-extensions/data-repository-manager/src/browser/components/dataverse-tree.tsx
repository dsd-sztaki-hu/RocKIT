// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { LinearProgress, CircularProgress, IconButton, Tooltip, TextField, InputAdornment } from '@mui/material';

import { RepositoryProviderService } from '../repository-provider-service';
import {
    RepositoryDestination,
    RepositoryDestinationCheckResult,
    RepositoryDestinationListResult,
} from '../repository-provider-registry';
import { DataRepositoryConfig, DataverseCollection } from '../types';
import { DataverseIcon } from './icons';
import { nls } from '@theia/core/lib/common/nls';
import '../styles/dataverse-collection-browser-dialog.css';

type TreeNode = {
    id: string;
    name: string;
    alias: string;
    parentAlias?: string;
    children: TreeNode[];
    childrenLoaded: boolean;
    hasChildren: boolean;
    isFolder: boolean;
    expanded: boolean;
    disabled: boolean;
};

export type DataverseTreeProps = {
    onCollectionSelected: (collection: DataverseCollection) => void;
    repository: DataRepositoryConfig;
    providerService: RepositoryProviderService;
    selectedCollectionId?: string;
};

const DataverseTree: React.FC<DataverseTreeProps> = (props) => {
    const canSearch = props.providerService.supports(props.repository, 'searchDestinations');
    const [treeData, setTreeData] = useState<TreeNode[]>([]);
    const [expandedNodes, setExpandedNodes] = useState<string[]>([]);

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [loadingNodeIds, setLoadingNodeIds] = useState<Set<string>>(new Set());
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [rawSearchInput, setRawSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const isFiltering = rawSearchInput.trim() !== searchQuery;
    const [searchResults, setSearchResults] = useState<TreeNode[]>([]);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [searchErrorMsg, setSearchErrorMsg] = useState<string | null>(null);

    const toTreeNode = (destination: RepositoryDestination): TreeNode => ({
        id: destination.id,
        name: destination.label,
        alias: destination.id,
        parentAlias: destination.parentId,
        children: [],
        childrenLoaded: !destination.hasChildren,
        hasChildren: Boolean(destination.hasChildren),
        isFolder: Boolean(destination.hasChildren),
        expanded: false,
        disabled: false
    });

    const replaceNode = (
        nodes: TreeNode[],
        nodeId: string,
        updater: (node: TreeNode) => TreeNode
    ): TreeNode[] => nodes.map(node => {
        if (node.id === nodeId) {
            return updater(node);
        }
        if (node.children.length > 0) {
            return { ...node, children: replaceNode(node.children, nodeId, updater) };
        }
        return node;
    });

    // Initial Load: Fetch root collections
    useEffect(() => {
        let ignore = false;
        setIsLoading(true);
        setExpandedNodes([]);
        
        props.providerService.executeForRepository<
            { repository: DataRepositoryConfig },
            RepositoryDestinationListResult
        >(props.repository, 'listDestinations', { repository: props.repository })
            .then(res => {
                if (ignore) return;
                const newData = (res?.destinations ?? []).map(toTreeNode);
                setTreeData(newData);
                setIsLoading(false);
            })
            .catch(err => {
                if (ignore) return;
                console.error("DataverseTree Error:", err);
                setErrorMsg(nls.localize('rockit/dataRepository/loadCollectionsFailed', 'Failed to load collections: {0}', err.message || nls.localize('rockit/validation/unknownError', 'Unknown error')));
                setIsLoading(false);
            });

        return () => { ignore = true; };
    }, [props.providerService, props.repository]);

    const findNode = (nodes: TreeNode[], nodeId: string): TreeNode | undefined => {
        for (const node of nodes) {
            if (node.id === nodeId) return node;
            const child = findNode(node.children, nodeId);
            if (child) return child;
        }
        return undefined;
    };

    const loadChildren = async (node: TreeNode) => {
        if (node.childrenLoaded || !node.hasChildren || loadingNodeIds.has(node.id)) return;

        setLoadingNodeIds(prev => new Set(prev).add(node.id));
        try {
            const result = await props.providerService.executeForRepository<
                { repository: DataRepositoryConfig; parentId: string },
                RepositoryDestinationListResult
            >(props.repository, 'listDestinations', {
                repository: props.repository,
                parentId: node.id,
            });
            const children = result?.destinations ?? [];
            setTreeData(prev => replaceNode(prev, node.id, current => ({
                ...current,
                children: children.map(toTreeNode),
                childrenLoaded: true,
                hasChildren: children.length > 0,
                isFolder: children.length > 0
            })));
        } catch (err: any) {
            console.error("DataverseTree child load error:", err);
            setErrorMsg(nls.localize('rockit/dataRepository/loadChildCollectionsFailed', 'Failed to load child collections for {0}: {1}', node.name, err.message || nls.localize('rockit/validation/unknownError', 'Unknown error')));
        } finally {
            setLoadingNodeIds(prev => {
                const next = new Set(prev);
                next.delete(node.id);
                return next;
            });
        }
    };

    const handleToggle = useCallback((_event: React.SyntheticEvent, nodeIds: string[]) => {
        const newlyExpanded = nodeIds.filter(id => !expandedNodes.includes(id));
        setExpandedNodes(nodeIds);
        for (const nodeId of newlyExpanded) {
            const node = findNode(treeData, nodeId);
            if (node) void loadChildren(node);
        }
    }, [expandedNodes, treeData, loadingNodeIds]);

    const onNodeClick = useCallback(async (node: TreeNode, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const result = props.providerService.supports(props.repository, 'checkDestination')
            ? await props.providerService.executeForRepository<
                { repository: DataRepositoryConfig; destinationId: string },
                RepositoryDestinationCheckResult
            >(props.repository, 'checkDestination', {
                repository: props.repository,
                destinationId: node.id,
            })
            : { selectable: true };
        
        props.onCollectionSelected({
            id: node.id,
            name: node.name,
            alias: node.alias,
            isWritable: result?.selectable === true
        });

    }, [props.providerService, props.repository, props.onCollectionSelected]);

    useEffect(() => {
        const handle = window.setTimeout(() => {
            setSearchQuery(rawSearchInput.trim());
        }, 300);
        return () => window.clearTimeout(handle);
    }, [rawSearchInput]);

    useEffect(() => {
        let ignore = false;
        if (!searchQuery || !canSearch) {
            setSearchResults([]);
            setIsSearchLoading(false);
            setSearchErrorMsg(null);
            return () => { ignore = true; };
        }

        setIsSearchLoading(true);
        setSearchErrorMsg(null);
        props.providerService.executeForRepository<
            { repository: DataRepositoryConfig; query: string },
            RepositoryDestinationListResult
        >(props.repository, 'searchDestinations', {
            repository: props.repository,
            query: searchQuery,
        })
            .then(results => {
                if (ignore) return;
                setSearchResults((results?.destinations ?? []).map(destination => ({
                    ...toTreeNode(destination),
                    hasChildren: false,
                    isFolder: false,
                    childrenLoaded: true
                })));
            })
            .catch(err => {
                if (ignore) return;
                console.error('DataverseTree search error:', err);
                setSearchErrorMsg(nls.localize('rockit/dataRepository/searchCollectionsFailed', 'Failed to search collections: {0}', err.message || nls.localize('rockit/validation/unknownError', 'Unknown error')));
                setSearchResults([]);
            })
            .finally(() => {
                if (!ignore) {
                    setIsSearchLoading(false);
                }
            });

        return () => { ignore = true; };
    }, [canSearch, props.providerService, props.repository, searchQuery]);

    const visibleNodes = searchQuery ? searchResults : treeData;

    const renderTree = useCallback((nodes: TreeNode[]): React.ReactNode =>
        nodes.map((node) => (
            <TreeItem
                key={node.id}
                itemId={node.id}
                label={
                    <div 
                        className="dataverse-tree__node"
                        onClick={(e) => onNodeClick(node, e)}
                    >
                        <span className="dataverse-tree__node-icon">
                            <DataverseIcon />
                        </span>
                        <span>{node.name}</span>
                    </div>
                }
                sx={{
                    color: 'var(--theia-foreground)',
                    '& .MuiTreeItem-content': {
                        // Style MUI's full row so the expansion/icon gutter is selected too.
                        padding: 0,
                        borderRadius: 0,
                        outline: 'none !important',
                        '&.Mui-selected, &.Mui-selected.Mui-focused': {
                            backgroundColor: 'var(--theia-list-inactiveSelectionBackground, var(--theia-list-hoverBackground)) !important',
                            color: 'var(--theia-list-inactiveSelectionForeground, var(--theia-foreground)) !important',
                        },
                        '&.Mui-selected:hover': {
                            backgroundColor: 'var(--theia-list-inactiveSelectionBackground, var(--theia-list-hoverBackground)) !important',
                        },
                        '&.Mui-focused:not(.Mui-selected)': {
                            backgroundColor: 'transparent !important',
                        },
                        '&:hover:not(.Mui-selected)': {
                            backgroundColor: 'var(--theia-list-hoverBackground) !important',
                            color: 'var(--theia-foreground)',
                        }
                    },
                    '& .MuiTreeItem-label': {
                        padding: 0,
                    }
                }}
            >
                {node.hasChildren
                    ? node.childrenLoaded
                        ? renderTree(node.children)
                        : (
                            <TreeItem
                                itemId={`${node.id}::__loading-placeholder`}
                                label={loadingNodeIds.has(node.id)
                                    ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                                            <CircularProgress
                                                size={14}
                                                style={{ color: 'var(--theia-focusBorder)' }}
                                            />
                                            <span style={{ color: 'var(--theia-descriptionForeground)' }}>
                                                {nls.localize('rockit/dataRepository/loadingCollections', 'Loading collections...')}
                                            </span>
                                        </div>
                                    )
                                    : ''}
                                sx={{ display: loadingNodeIds.has(node.id) ? 'block' : 'none' }}
                            />
                        )
                    : undefined}
            </TreeItem>
        )), [loadingNodeIds, onNodeClick, props.selectedCollectionId]);

    const renderedTree = useMemo(() => renderTree(visibleNodes), [visibleNodes, renderTree]);

    return (
        <div className="dataverse-tree">
            <div className="dataverse-tree__header">
                <div className="dataverse-tree__toolbar">
                    {isSearchExpanded ? (
                        <TextField
                            className="dataverse-tree__search-box"
                            variant="standard"
                            placeholder={nls.localize('rockit/dataRepository/searchCollections', 'Search collections...')}
                            value={rawSearchInput}
                            onChange={(e) => setRawSearchInput(e.target.value)}
                            autoFocus
                            InputProps={{
                                disableUnderline: true,
                                className: "dataverse-tree__search-input",
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton size="small" onClick={() => { setRawSearchInput(''); setIsSearchExpanded(false); }}>
                                            <CloseIcon fontSize="small" style={{ color: 'var(--theia-icon-foreground)' }} />
                                        </IconButton>
                                    </InputAdornment>
                                )
                            }}
                        />
                    ) : canSearch ? (
                        <Tooltip title={nls.localize('rockit/dataRepository/searchCollectionsTooltip', 'Search Collections')} slotProps={{ popper: { sx: { zIndex: 2147483647 } } }}>
                            <IconButton size="small" onClick={() => setIsSearchExpanded(true)} style={{ color: 'var(--theia-icon-foreground)' }}>
                                <SearchIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    ) : null}
                </div>

            </div>

            <div className="dataverse-tree__body">
                {isLoading && treeData.length === 0 && (
                    <div className="dataverse-tree__loading">
                        <LinearProgress style={{ width: '100%', marginBottom: 10 }} />
                        <span>{nls.localize('rockit/dataRepository/loadingCollections', 'Loading collections...')}</span>
                    </div>
                )}
                {errorMsg && <div className="dataverse-tree__error">{errorMsg}</div>}
                {searchErrorMsg && <div className="dataverse-tree__error">{searchErrorMsg}</div>}
                {!isLoading && treeData.length === 0 && !errorMsg && (
                    <div className="dataverse-tree__empty">{nls.localize('rockit/dataRepository/noCollections', 'No collections found.')}</div>
                )}
                {(isFiltering || isSearchLoading) && (
                    <div className="dataverse-tree__filtering">
                        <LinearProgress style={{ width: '100%' }} />
                    </div>
                )}
                {searchQuery && !isSearchLoading && !searchErrorMsg && searchResults.length === 0 && (
                    <div className="dataverse-tree__empty">{nls.localize('rockit/dataRepository/noMatchingCollections', 'No matching collections found.')}</div>
                )}
                {visibleNodes.length > 0 && (
                    <SimpleTreeView
                        slots={{ collapseIcon: ExpandMoreIcon, expandIcon: ChevronRightIcon }}
                        expandedItems={searchQuery ? [] : expandedNodes}
                        onExpandedItemsChange={searchQuery ? undefined : handleToggle}
                        selectedItems={props.selectedCollectionId ?? ''}
                        sx={{
                            flexGrow: 1,
                            overflowY: 'auto',
                            outline: 'none !important',
                            border: 'none !important',
                            '&:focus': { outline: 'none !important' },
                            '&:focus-visible': { outline: 'none !important' }
                        }}
                    >
                        {renderedTree}
                    </SimpleTreeView>
                )}
            </div>
        </div>
    );
};

export default DataverseTree;
