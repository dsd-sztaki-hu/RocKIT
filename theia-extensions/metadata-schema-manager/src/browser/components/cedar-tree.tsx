import * as React from 'react';
import { useEffect, useState } from 'react';
import { TreeView } from '@mui/x-tree-view/TreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { LinearProgress } from '@mui/material';
import log from 'loglevel';

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

// Converts API result to Tree Nodes and marks existing items as disabled
function cedarFolderResultToTreeData(cedarResult: any, alreadySelectedSchemaIds?: string[]): TreeNode[] {
    if (!cedarResult || !cedarResult.resources) return [];
    
    return cedarResult.resources
    .filter((r: any) => {
        const type = (r.resourceType || "").toLowerCase();
        return (type === "folder" || type === "template") && r["schema:name"] != "elements";
    })
    .map((r: any) => {
      // Determine if this item is in our local list
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

function collectExpandedNodes(nodes: TreeNode[]): Array<string> {
  const result: Array<string> = [];
  for (const node of nodes) {
    if (node.expanded) result.push(node.id);
    if (node.children) result.push(...collectExpandedNodes(node.children));
  }
  return result;
}

export type CedarTreeProps = {
  onTemplateSelected: (templateId: string, templateName: string) => void
  onFolderSelected: (folderId: string, folderName: string) => void
  schemaApi: SchemaApi,
  alreadySelectedSchemaIds?: string[]
}

const CedarTree: React.FC<CedarTreeProps> = (props) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Array<string>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    
    console.log("CedarTree: Starting initial fetch...");
    props.schemaApi.getPublicFolderId()
        .then(id => {
            if (ignore) return;
            return props.schemaApi.listFolder(id);
        })
        .then(res => {
            if (ignore) return;
            // Pass the list of IDs here so the initial tree is filtered correctly
            const newData = cedarFolderResultToTreeData(res, props.alreadySelectedSchemaIds);
            setTreeData(newData);
            setIsLoading(false);
        })
        .catch(err => {
            if (ignore) return;
            console.error("CedarTree Error:", err);
            const msg = err.message || "Unknown error occurred";
            setErrorMsg(`Failed to load data: ${msg}`);
            setIsLoading(false);
        });

    return () => { ignore = true; };
  }, [props.schemaApi, props.alreadySelectedSchemaIds]);

  const handleToggle = async (node: TreeNode) => {
    if (node.disabled) return;

    if (node.isFolder) {
      props.onFolderSelected(node.id, node.name);
      
      node.expanded = !node.expanded;
      setExpandedNodes(collectExpandedNodes(treeData));
      setTreeData([...treeData]); 

      if (node.expanded && !node.childrenLoaded) {
          setIsLoading(true);
          try {
            const res = await props.schemaApi.listFolder(node.id);
            // Pass the IDs again for sub-folders
            node.children = cedarFolderResultToTreeData(res, props.alreadySelectedSchemaIds);
            node.childrenLoaded = true;
            setTreeData([...treeData]);
          } catch (error) {
            console.error('Error loading folder:', error);
          } finally {
            setIsLoading(false);
          }
      }
    } else {
      props.onTemplateSelected(node.id, node.name);
    }
  };

  const renderTree = (nodes: TreeNode[]) =>
    nodes.map((node) => (
      <TreeItem
        key={node.id}
        nodeId={node.id}
        label={node.name}
        onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            handleToggle(node);
        }}
        icon={node.isFolder ? <FolderClosed /> : <File />}
        disabled={node.disabled}
      >
        {Array.isArray(node.children) && node.children.length > 0 ? renderTree(node.children) : null}
      </TreeItem>
    ));

  return (
    <div style={{ padding: '10px', minHeight: '100px', color: 'black' }}>
      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <LinearProgress style={{ flexGrow: 1, marginRight: 10 }} />
            <span style={{ fontSize: '12px', color: '#666' }}>Loading...</span>
        </div>
      )}

      {errorMsg && (
        <div style={{ color: 'red', padding: 10, border: '1px solid red', borderRadius: 4 }}>
            {errorMsg}
        </div>
      )}

      {treeData.length > 0 && (
          <TreeView
            defaultCollapseIcon={<ExpandMoreIcon />}
            defaultExpandIcon={<ChevronRightIcon />}
            expanded={expandedNodes}
            sx={{ flexGrow: 1, overflowY: 'auto' }}
          >
            {renderTree(treeData)}
          </TreeView>
      )}
      
      {!isLoading && !errorMsg && treeData.length === 0 && (
          <div style={{ color: '#888', fontStyle: 'italic' }}>No templates found.</div>
      )}
    </div>
  );
};

export default CedarTree;