import * as React from 'react';
import { useEffect, useState, useMemo, useRef } from 'react';
import { TreeView } from '@mui/x-tree-view/TreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { LinearProgress, CircularProgress, IconButton, Tooltip, TextField, InputAdornment } from '@mui/material';
import { SchemaApi } from "../services/schema-api";
import { File, FolderClosed } from "./icons"; 

type TreeNode = {
  id: string;
  name: string;
  children: TreeNode[];
  childrenLoaded: boolean;
  isFolder: boolean;
  expanded: boolean;
  disabled: boolean;
};

// --- Helpers ---

function cedarFolderResultToTreeData(cedarResult: any, alreadySelectedSchemaIds?: string[]): TreeNode[] {
    if (!cedarResult || !cedarResult.resources) return [];
    
    return cedarResult.resources
    .filter((r: any) => {
        const type = (r.resourceType || "").toLowerCase();
        return (type === "folder" || type === "template") && r["schema:name"] != "elements";
    })
    .map((r: any) => {
      const isDisabled = alreadySelectedSchemaIds 
        ? alreadySelectedSchemaIds.includes(r["@id"]) 
        : false;

      return {
        isFolder: (r.resourceType || "").toLowerCase() === "folder",
        id: r["@id"],
        name: r["schema:name"],
        children: [],
        childrenLoaded: false,
        expanded: false,
        disabled: isDisabled
      }
    })
}

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children.length > 0) {
            const found = findNode(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

function updateNodeChildren(nodes: TreeNode[], targetId: string, newChildren: TreeNode[]): TreeNode[] {
    return nodes.map(node => {
        if (node.id === targetId) {
            return { ...node, children: newChildren, childrenLoaded: true };
        }
        if (node.children.length > 0) {
            return { ...node, children: updateNodeChildren(node.children, targetId, newChildren) };
        }
        return node;
    });
}

function collectSubtreeIds(nodes: TreeNode[]): string[] {
    let ids: string[] = [];
    for (const node of nodes) {
        ids.push(node.id);
        if (node.children.length > 0) {
            ids = ids.concat(collectSubtreeIds(node.children));
        }
    }
    return ids;
}

// --- Search / Filtering Logic ---

function filterNodes(nodes: TreeNode[], query: string): { nodes: TreeNode[], expandedIds: string[] } {
    const lowerQuery = query.toLowerCase();
    let expandedIds: string[] = [];
    
    const filtered = nodes.map(node => {
        const matchesSelf = node.name.toLowerCase().includes(lowerQuery);
        const childResult = filterNodes(node.children, query);
        const hasMatchingChildren = childResult.nodes.length > 0;

        if (matchesSelf || hasMatchingChildren) {
            if (hasMatchingChildren) {
                expandedIds.push(node.id);
                expandedIds = expandedIds.concat(childResult.expandedIds);
            }
            return { ...node, children: childResult.nodes };
        }
        return null;
    }).filter(n => n !== null) as TreeNode[];

    return { nodes: filtered, expandedIds };
}


// --- Component ---

export type CedarTreeProps = {
  onTemplateSelected: (templateId: string, templateName: string) => void
  onFolderSelected: (folderId: string, folderName: string) => void
  schemaApi: SchemaApi,
  alreadySelectedSchemaIds?: string[]
}

const CedarTree: React.FC<CedarTreeProps> = (props) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<string[]>([]);
  
  const [preSearchExpandedNodes, setPreSearchExpandedNodes] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingNodeId, setLoadingNodeId] = useState<string | null>(null);
  
  const [isBulkExpanding, setIsBulkExpanding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- Search State ---
  const [rawSearchInput, setRawSearchInput] = useState(''); 
  const [searchQuery, setSearchQuery] = useState(''); 
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isTreeFullyLoaded, setIsTreeFullyLoaded] = useState(false);

  // Initial Load
  useEffect(() => {
    let ignore = false;
    setIsLoading(true);
    setExpandedNodes([]); 
    setPreSearchExpandedNodes([]);
    setIsTreeFullyLoaded(false);
    
    props.schemaApi.getPublicFolderId()
        .then(id => {
            if (ignore) return;
            return props.schemaApi.listFolder(id);
        })
        .then(res => {
            if (ignore) return;
            const newData = cedarFolderResultToTreeData(res, props.alreadySelectedSchemaIds);
            setTreeData(newData);
            setIsLoading(false);
        })
        .catch(err => {
            if (ignore) return;
            console.error("CedarTree Error:", err);
            setErrorMsg(`Failed to load data: ${err.message || "Unknown error"}`);
            setIsLoading(false);
        });

    return () => { ignore = true; };
  }, [props.schemaApi, props.alreadySelectedSchemaIds]);

  // Load Folder Data Logic (Single Node)
  const loadFolderData = async (nodeId: string) => {
      setLoadingNodeId(nodeId);
      try {
          const res = await props.schemaApi.listFolder(nodeId);
          const children = cedarFolderResultToTreeData(res, props.alreadySelectedSchemaIds);
          setTreeData(prev => updateNodeChildren(prev, nodeId, children));
      } catch (error) {
          console.error('Error loading folder:', error);
      } finally {
          setLoadingNodeId(null);
      }
  };

  const updateExpansionState = (nextExpanded: string[]) => {
      const collapsedId = expandedNodes.find(id => !nextExpanded.includes(id));
      if (collapsedId) {
          const node = findNode(treeData, collapsedId);
          if (node) {
              const descendantIds = collectSubtreeIds(node.children);
              const filtered = nextExpanded.filter(id => !descendantIds.includes(id));
              setExpandedNodes(filtered);
              return;
          }
      }

      const newlyExpandedId = nextExpanded.find(id => !expandedNodes.includes(id));
      if (newlyExpandedId) {
          const node = findNode(treeData, newlyExpandedId);
          if (node && node.isFolder && !node.childrenLoaded) {
              loadFolderData(node.id);
          }
      }

      setExpandedNodes(nextExpanded);
  };

  const handleToggle = (event: React.SyntheticEvent, nodeIds: string[]) => {
      if (!searchQuery) {
          updateExpansionState(nodeIds);
      } else {
          setExpandedNodes(nodeIds);
      }
  };

  // Reusable recursive fetcher
  const fetchAllRecursive = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
      const updatedNodes = await Promise.all(nodes.map(async (node) => {
          const currentNode = { ...node };

          if (currentNode.isFolder) {
              // Fetch if missing
              if (!currentNode.childrenLoaded) {
                  try {
                      const res = await props.schemaApi.listFolder(currentNode.id);
                      currentNode.children = cedarFolderResultToTreeData(res, props.alreadySelectedSchemaIds);
                      currentNode.childrenLoaded = true;
                  } catch (e) {
                      console.warn(`Failed to expand folder: ${currentNode.name}`, e);
                  }
              }

              // Recurse down
              if (currentNode.children.length > 0) {
                  currentNode.children = await fetchAllRecursive(currentNode.children);
              }
          }
          return currentNode;
      }));
      return updatedNodes;
  };

  const handleExpandAll = async () => {
      if (isBulkExpanding) return;
      setIsBulkExpanding(true);
      try {
          const fullyLoadedTree = await fetchAllRecursive(treeData);
          setTreeData(fullyLoadedTree);
          setIsTreeFullyLoaded(true); 

          const collectAllIds = (nodes: TreeNode[]): string[] => {
              let ids: string[] = [];
              for (const n of nodes) {
                  if (n.isFolder) {
                      ids.push(n.id);
                      ids = ids.concat(collectAllIds(n.children));
                  }
              }
              return ids;
          };
          setExpandedNodes(collectAllIds(fullyLoadedTree));
      } catch (error) {
          console.error("Expand All failed:", error);
      } finally {
          setIsBulkExpanding(false);
      }
  };

  const handleCollapseAll = () => {
      setExpandedNodes([]);
  };

  // --- Search Auto-Crawl Logic ---
  useEffect(() => {
      const delaySearch = setTimeout(async () => {
          const trimmedInput = rawSearchInput.trim();
          
          if (trimmedInput) {
              // STARTING SEARCH
              if (!isSearching && !searchQuery) {
                  // Save current state before we mess it up with search results
                  setPreSearchExpandedNodes(expandedNodes);
              }

              setIsSearching(true);
              
              if (!isTreeFullyLoaded && treeData.length > 0) {
                  try {
                      const fullyLoadedTree = await fetchAllRecursive(treeData);
                      setTreeData(fullyLoadedTree);
                      setIsTreeFullyLoaded(true);
                  } catch (e) {
                      console.error("Search auto-load failed", e);
                  }
              }
              
              setSearchQuery(trimmedInput);
              setIsSearching(false);
          } else {
              // CLEARING SEARCH
              if (searchQuery) {
                  setSearchQuery('');
                  setExpandedNodes(preSearchExpandedNodes);
              }
              setIsSearching(false);
          }
      }, 300);

      return () => clearTimeout(delaySearch);
  }, [rawSearchInput, treeData, isTreeFullyLoaded]);


  const onNodeClick = (node: TreeNode, e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.disabled) return;

      if (node.isFolder) {
          props.onFolderSelected(node.id, node.name);
          
          const isExpanded = expandedNodes.includes(node.id);
          let nextExpanded = [...expandedNodes];
          
          if (isExpanded) {
              nextExpanded = nextExpanded.filter(id => id !== node.id);
          } else {
              nextExpanded.push(node.id);
          }
          
          if (!searchQuery) {
             updateExpansionState(nextExpanded);
          } else {
             setExpandedNodes(nextExpanded);
          }
      } else {
          props.onTemplateSelected(node.id, node.name);
      }
  }

  const { displayedNodes, searchExpandedIds } = useMemo(() => {
      if (!searchQuery) {
          return { displayedNodes: treeData, searchExpandedIds: [] };
      }
      const result = filterNodes(treeData, searchQuery);
      return { displayedNodes: result.nodes, searchExpandedIds: result.expandedIds };
  }, [treeData, searchQuery]);

  useEffect(() => {
      if (searchQuery && searchExpandedIds.length > 0) {
          setExpandedNodes(prev => Array.from(new Set([...prev, ...searchExpandedIds])));
      }
  }, [searchExpandedIds, searchQuery]);


  const renderTree = (nodes: TreeNode[]) =>
    nodes.map((node) => (
      <TreeItem
        key={node.id}
        nodeId={node.id}
        label={
            <div 
                id={`cedar-node-${node.id}`}
                style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}
                onClick={(e) => onNodeClick(node, e)}
            >
                <span style={{ marginRight: 8, display: 'flex', alignItems: 'center' }}>
                    {node.isFolder ? <FolderClosed /> : <File />}
                </span>
                
                {searchQuery ? (
                    <span>
                        {node.name.split(new RegExp(`(${searchQuery})`, 'gi')).map((part, i) => 
                            part.toLowerCase() === searchQuery.toLowerCase() 
                                ? <span key={i} style={{ backgroundColor: '#fff59d' }}>{part}</span> 
                                : part
                        )}
                    </span>
                ) : (
                    node.name
                )}

                {loadingNodeId === node.id && (
                    <CircularProgress size={12} style={{ marginLeft: 8 }} />
                )}
            </div>
        }
        disabled={node.disabled}
        sx={{
            '& .MuiTreeItem-content': {
                padding: '0px 8px',
                '&.Mui-selected': {
                    backgroundColor: 'rgba(25, 118, 210, 0.08) !important',
                },
                '&.Mui-focused': {
                    backgroundColor: 'transparent !important',
                },
                '&:hover': {
                    backgroundColor: 'rgba(0, 0, 0, 0.04)',
                }
            }
        }}
      >
        {Array.isArray(node.children) && node.children.length > 0 
            ? renderTree(node.children) 
            : (
                node.isFolder && !node.childrenLoaded 
                    ? <TreeItem nodeId={node.id + "_dummy"} label="" sx={{ display: 'none' }} /> 
                    : null
            )
        }
      </TreeItem>
    ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px', boxSizing: 'border-box', color: 'black' }}>
      
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid #eee', paddingBottom: '4px', minHeight: '32px' }}>
          
          <div style={{ display: 'flex', alignItems: 'center' }}>
                {isSearchExpanded ? (
                    <TextField
                        variant="standard"
                        placeholder={isSearching ? "Searching..." : "Search..."}
                        value={rawSearchInput}
                        onChange={(e) => setRawSearchInput(e.target.value)}
                        autoFocus
                        InputProps={{
                            disableUnderline: true,
                            style: { fontSize: '14px', paddingLeft: '4px' },
                            endAdornment: (
                                <InputAdornment position="end">
                                    {isSearching ? (
                                        <CircularProgress size={16} style={{ marginRight: 8 }} />
                                    ) : (
                                        <IconButton size="small" onClick={() => { 
                                            setRawSearchInput(''); 
                                            // Trigger clearing logic immediately via effect
                                            setSearchQuery(''); 
                                            setExpandedNodes(preSearchExpandedNodes); // Immediate visual feedback
                                            setIsSearchExpanded(false); 
                                        }}>
                                            <CloseIcon fontSize="small" />
                                        </IconButton>
                                    )}
                                </InputAdornment>
                            )
                        }}
                        style={{ width: '220px', border: '1px solid #ddd', borderRadius: '4px', padding: '2px 4px' }}
                    />
                ) : (
                    <Tooltip title="Search Folders & Templates">
                        <IconButton size="small" onClick={() => setIsSearchExpanded(true)}>
                            <SearchIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center' }}>
              {isBulkExpanding && (
                  <div style={{ marginRight: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <CircularProgress size={14} />
                      <span style={{ fontSize: '11px', color: '#666' }}>Expanding...</span>
                  </div>
              )}

              <Tooltip title="Expand All (Recursive)">
                  <span>
                    <IconButton 
                        size="small" 
                        onClick={handleExpandAll} 
                        disabled={isBulkExpanding || isSearching}
                        style={{ marginRight: 4 }}
                    >
                        <UnfoldMoreIcon fontSize="small" />
                    </IconButton>
                  </span>
              </Tooltip>
              
              <Tooltip title="Collapse All">
                  <IconButton size="small" onClick={handleCollapseAll} disabled={isBulkExpanding || isSearching}>
                      <UnfoldLessIcon fontSize="small" />
                  </IconButton>
              </Tooltip>
          </div>
      </div>

      <div style={{ flexGrow: 1, overflowY: 'auto', minHeight: 0 }}>
          
          {isLoading && treeData.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <LinearProgress style={{ flexGrow: 1, marginRight: 10 }} />
                <span style={{ fontSize: '12px', color: '#666' }}>Loading repository...</span>
            </div>
          )}

          {errorMsg && (
            <div style={{ color: 'red', padding: 10, border: '1px solid red', borderRadius: 4 }}>
                {errorMsg}
            </div>
          )}

          {displayedNodes.length > 0 && (
              <TreeView
                defaultCollapseIcon={<ExpandMoreIcon />}
                defaultExpandIcon={<ChevronRightIcon />}
                expanded={expandedNodes}
                onNodeToggle={handleToggle}
                sx={{
                    flexGrow: 1,
                    outline: 'none',
                    '&:focus': { outline: 'none' }
                }}
              >
                {renderTree(displayedNodes)}
              </TreeView>
          )}
          
          {!isLoading && !errorMsg && displayedNodes.length === 0 && (
              <div style={{ color: '#888', fontStyle: 'italic', padding: 20 }}>
                  {searchQuery ? 'No results found.' : 'No templates found.'}
              </div>
          )}
      </div>
    </div>
  );
};

export default CedarTree;