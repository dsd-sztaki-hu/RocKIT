import * as React from 'react';
import { useEffect, useState, useMemo } from 'react';
import { TreeView } from '@mui/x-tree-view/TreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { LinearProgress, CircularProgress, IconButton, Tooltip, TextField, InputAdornment } from '@mui/material';

import { DataverseCollectionService } from '../services/dataverse-collection-service';
import { DataverseCollection } from '../types';
import { DataverseIcon } from './icons';
import '../styles/dataverse-collection-browser-dialog.css';

type TreeNode = {
    id: string;
    name: string;
    alias: string;
    children: TreeNode[];
    childrenLoaded: boolean;
    isFolder: boolean;
    expanded: boolean;
    disabled: boolean;
};

export type DataverseTreeProps = {
    onCollectionSelected: (collection: DataverseCollection) => void;
    collectionService: DataverseCollectionService;
    roleIds: string[];
};

const DataverseTree: React.FC<DataverseTreeProps> = (props) => {
    const [treeData, setTreeData] = useState<TreeNode[]>([]);
    const [expandedNodes, setExpandedNodes] = useState<string[]>([]);

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [loadingNodeId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [rawSearchInput, setRawSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);

    // Initial Load: Fetch top-level collections
    useEffect(() => {
        let ignore = false;
        setIsLoading(true);
        setExpandedNodes([]);
        
        props.collectionService.getMyCollections(props.roleIds)
            .then(res => {
                if (ignore) return;
                const newData = res.map((c: any) => ({
                    id: c.alias, // Use alias as ID, as CollectionPreview doesn't have a numeric ID
                    name: c.name,
                    alias: c.alias,
                    children: [],
                    childrenLoaded: false,
                    isFolder: true,
                    expanded: false,
                    disabled: false 
                }));
                setTreeData(newData);
                setIsLoading(false);
            })
            .catch(err => {
                if (ignore) return;
                console.error("DataverseTree Error:", err);
                setErrorMsg(`Failed to load collections: ${err.message || "Unknown error"}`);
                setIsLoading(false);
            });

        return () => { ignore = true; };
    }, [props.collectionService, props.roleIds]);

    const handleToggle = (event: React.SyntheticEvent, nodeIds: string[]) => {
        setExpandedNodes(nodeIds);
    };

    const handleExpandAll = () => {
        const collectIds = (nodes: TreeNode[]): string[] => {
            let ids: string[] = [];
            for (const n of nodes) {
                ids.push(n.id);
                if (n.children.length > 0) {
                    ids = ids.concat(collectIds(n.children));
                }
            }
            return ids;
        };
        setExpandedNodes(collectIds(treeData));
    };

    const handleCollapseAll = () => {
        setExpandedNodes([]);
    };

    const onNodeClick = async (node: TreeNode, e: React.MouseEvent) => {
        e.stopPropagation();
        
        const canWrite = await props.collectionService.canAddDataset(node.id);
        
        props.onCollectionSelected({
            id: node.id,
            name: node.name,
            alias: node.alias,
            isWritable: canWrite
        });

        // Toggle expansion if it's a folder
        if (node.isFolder) {
            const isExpanded = expandedNodes.includes(node.id);
            if (isExpanded) {
                setExpandedNodes(prev => prev.filter(id => id !== node.id));
            } else {
                setExpandedNodes(prev => [...prev, node.id]);
            }
        }
    };

    const { filteredNodes, searchExpandedIds } = useMemo(() => {
        if (!searchQuery) return { filteredNodes: treeData, searchExpandedIds: [] };
        const lowerQuery = searchQuery.toLowerCase();
        let expandedIds: string[] = [];
        
        const filter = (nodes: TreeNode[]): TreeNode[] => {
            return nodes.map(node => {
                const matches = node.name.toLowerCase().includes(lowerQuery) || node.alias.toLowerCase().includes(lowerQuery);
                const results = filter(node.children);
                if (matches || results.length > 0) {
                    if (results.length > 0) expandedIds.push(node.id);
                    return { ...node, children: results };
                }
                return null;
            }).filter(n => n !== null) as TreeNode[];
        };
        
        return { filteredNodes: filter(treeData), searchExpandedIds: expandedIds };
    }, [treeData, searchQuery]);

    useEffect(() => {
        if (searchQuery && searchExpandedIds.length > 0) {
            setExpandedNodes(prev => Array.from(new Set([...prev, ...searchExpandedIds])));
        }
    }, [searchExpandedIds, searchQuery]);

    useEffect(() => {
        const delaySearch = setTimeout(() => {
            setSearchQuery(rawSearchInput.trim());
        }, 300);
        return () => clearTimeout(delaySearch);
    }, [rawSearchInput]);

    const renderTree = (nodes: TreeNode[]) =>
        nodes.map((node) => (
            <TreeItem
                key={node.id}
                nodeId={node.id}
                label={
                    <div 
                        className="dataverse-tree__node"
                        onClick={(e) => onNodeClick(node, e)}
                    >
                        <span className="dataverse-tree__node-icon">
                            <DataverseIcon />
                        </span>
                        <span>{node.name}</span>
                        {loadingNodeId === node.id && (
                            <CircularProgress size={12} style={{ marginLeft: 8, color: 'var(--theia-focusBorder)' }} />
                        )}
                    </div>
                }
                sx={{
                    color: 'var(--theia-foreground)',
                    '& .MuiTreeItem-content': {
                        padding: '0px 8px',
                        borderRadius: '3px',
                        '&.Mui-selected': {
                            backgroundColor: 'transparent !important',
                            color: 'var(--theia-foreground) !important',
                        },
                        '&:hover': {
                            backgroundColor: 'transparent !important',
                            color: 'var(--theia-foreground)',
                        }
                    }
                }}
            >
                {Array.isArray(node.children) && node.children.length > 0 && renderTree(node.children)}
            </TreeItem>
        ));

    return (
        <div className="dataverse-tree">
            <div className="dataverse-tree__header">
                <div className="dataverse-tree__toolbar">
                    {isSearchExpanded ? (
                        <TextField
                            className="dataverse-tree__search-box"
                            variant="standard"
                            placeholder="Search collections..."
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
                        <Tooltip title="Search Collections">
                            <IconButton size="small" onClick={() => setIsSearchExpanded(true)} style={{ color: 'var(--theia-icon-foreground)' }}>
                                <SearchIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                </div>

                <div className="dataverse-tree__toolbar">
                    <Tooltip title="Expand All">
                        <IconButton size="small" onClick={handleExpandAll} style={{ color: 'var(--theia-icon-foreground)' }}>
                            <UnfoldMoreIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Collapse All">
                        <IconButton size="small" onClick={handleCollapseAll} style={{ color: 'var(--theia-icon-foreground)' }}>
                            <UnfoldLessIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </div>
            </div>

            <div className="dataverse-tree__body">
                {isLoading && treeData.length === 0 && (
                    <div className="dataverse-tree__loading">
                        <LinearProgress style={{ width: '100%', marginBottom: 10 }} />
                        <span>Loading collections...</span>
                    </div>
                )}
                {errorMsg && <div className="dataverse-tree__error">{errorMsg}</div>}
                {!isLoading && treeData.length === 0 && !errorMsg && (
                    <div className="dataverse-tree__empty">No collections found.</div>
                )}
                {filteredNodes.length > 0 && (
                    <TreeView
                        defaultCollapseIcon={<ExpandMoreIcon style={{ color: 'var(--theia-icon-foreground)' }} />}
                        defaultExpandIcon={<ChevronRightIcon style={{ color: 'var(--theia-icon-foreground)' }} />}
                        expanded={expandedNodes}
                        onNodeToggle={handleToggle}
                        sx={{ flexGrow: 1, overflowY: 'auto', outline: 'none' }}
                    >
                        {renderTree(filteredNodes)}
                    </TreeView>
                )}
            </div>
        </div>
    );
};

export default DataverseTree;
