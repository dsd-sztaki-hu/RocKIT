import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TreeView } from '@mui/x-tree-view/TreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { LinearProgress, CircularProgress, IconButton, Tooltip, TextField, InputAdornment } from '@mui/material';

import { DataverseCollectionService } from '../services/dataverse-collection-service';
import { DataverseCollection } from '../types';
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
    collectionService: DataverseCollectionService;
    selectedCollectionId?: string;
};

const DataverseTree: React.FC<DataverseTreeProps> = (props) => {
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

    const toTreeNode = (collection: any): TreeNode => ({
        id: collection.alias,
        name: collection.name,
        alias: collection.alias,
        parentAlias: collection.parentAlias,
        children: [],
        childrenLoaded: !collection.hasChildren,
        hasChildren: collection.hasChildren,
        isFolder: collection.hasChildren,
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
        
        props.collectionService.getRootCollections()
            .then(res => {
                if (ignore) return;
                const newData = res.map(toTreeNode);
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
    }, [props.collectionService]);

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
            const children = await props.collectionService.getChildCollections(node.alias);
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
        
        const canWrite = await props.collectionService.canAddDataset(node.id);
        
        props.onCollectionSelected({
            id: node.id,
            name: node.name,
            alias: node.alias,
            isWritable: canWrite
        });

    }, [props.collectionService, props.onCollectionSelected]);

    useEffect(() => {
        const handle = window.setTimeout(() => {
            setSearchQuery(rawSearchInput.trim());
        }, 300);
        return () => window.clearTimeout(handle);
    }, [rawSearchInput]);

    useEffect(() => {
        let ignore = false;
        if (!searchQuery) {
            setSearchResults([]);
            setIsSearchLoading(false);
            setSearchErrorMsg(null);
            return () => { ignore = true; };
        }

        setIsSearchLoading(true);
        setSearchErrorMsg(null);
        props.collectionService.searchDataverseCollections(searchQuery)
            .then(results => {
                if (ignore) return;
                setSearchResults(results.map(collection => ({
                    ...toTreeNode(collection),
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
    }, [props.collectionService, searchQuery]);

    const visibleNodes = searchQuery ? searchResults : treeData;

    const renderTree = useCallback((nodes: TreeNode[]): React.ReactNode =>
        nodes.map((node) => (
            <TreeItem
                key={node.id}
                nodeId={node.id}
                label={
                    <div 
                        className={`dataverse-tree__node${props.selectedCollectionId === node.id ? ' dataverse-tree__node--selected' : ''}`}
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
                        padding: 0,
                        borderRadius: 0,
                        outline: 'none !important',
                        '&.Mui-selected': {
                            backgroundColor: 'transparent !important',
                            color: 'var(--theia-foreground) !important',
                        },
                        '&.Mui-focused': {
                            backgroundColor: 'transparent !important',
                        },
                        '&.Mui-selected.Mui-focused': {
                            backgroundColor: 'transparent !important',
                        },
                        '&:hover': {
                            backgroundColor: 'transparent !important',
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
                                nodeId={`${node.id}::__loading-placeholder`}
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
                    ) : (
                        <Tooltip title={nls.localize('rockit/dataRepository/searchCollectionsTooltip', 'Search Collections')} slotProps={{ popper: { sx: { zIndex: 2147483647 } } }}>
                            <IconButton size="small" onClick={() => setIsSearchExpanded(true)} style={{ color: 'var(--theia-icon-foreground)' }}>
                                <SearchIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
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
                    <TreeView
                        defaultCollapseIcon={<ExpandMoreIcon style={{ color: 'var(--theia-icon-foreground)' }} />}
                        defaultExpandIcon={<ChevronRightIcon style={{ color: 'var(--theia-icon-foreground)' }} />}
                        expanded={searchQuery ? [] : expandedNodes}
                        onNodeToggle={searchQuery ? undefined : handleToggle}
                        selected={props.selectedCollectionId ?? ''}
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
                    </TreeView>
                )}
            </div>
        </div>
    );
};

export default DataverseTree;
