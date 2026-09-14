// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

// src/browser/components/metadata-schema-toolbar.tsx

import * as React from 'react';
import NoteAddIcon from '@mui/icons-material/NoteAdd'; 
import LinkIcon from '@mui/icons-material/Link'; 
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'; 
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent'; 
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Tooltip, IconButton } from '@mui/material';
import { nls } from '@theia/core/lib/common/nls';

import '../styles/metadata-schema-toolbar.css';


interface SchemaToolbarProps {
    onImportFile: () => void;
    onImportUrl: () => void;
    onRefresh: () => void;
    onDelete?: () => void;
    onBrowse?: () => void;
    onConfigureProviders?: () => void; 
    selectedCount?: number;
}

export const MetadataSchemaToolbar: React.FC<SchemaToolbarProps> = React.memo(({
    onImportFile,
    onImportUrl,
    onRefresh,
    onDelete,
    onBrowse,
    onConfigureProviders,
    selectedCount = 0
}) => {
    
    const renderActionButton = (
        label: string, 
        icon: React.ReactNode, 
        onClick: () => void, 
        title: string,
        primary = false
    ) => (
        <button 
            className={`schema-toolbar__btn ${primary ? 'schema-toolbar__btn--primary' : 'schema-toolbar__btn--secondary'}`}
            onClick={onClick}
            title={title}
        >
            <span className="schema-toolbar__btn-icon">{icon}</span>
            <span className="schema-toolbar__btn-label">{label}</span>
        </button>
    );

    return (
        <div className="schema-toolbar">
            {/* Group 1: Local Imports */}
            {renderActionButton(
                nls.localize('rockit/schemaManager/importFile', 'Import File'),
                <NoteAddIcon className="schema-toolbar__icon-svg" />, 
                onImportFile, 
                nls.localize('rockit/schemaManager/importFileTooltip', 'Import a schema from a local JSON file'),
                true 
            )}
            
            {renderActionButton(
                nls.localize('rockit/schemaManager/importUrl', 'Import URL'),
                <LinkIcon className="schema-toolbar__icon-svg" />, 
                onImportUrl, 
                nls.localize('rockit/schemaManager/importUrlTooltip', 'Import a schema from a URL'),
                true 
            )}

            <div className="schema-toolbar__separator" />

            {/* Group 2: Remote / Cloud */}
            {onBrowse && renderActionButton(
                nls.localize('rockit/schemaManager/browseRemote', 'Browse Remote'),
                <CloudDownloadIcon className="schema-toolbar__icon-svg" />, 
                onBrowse, 
                nls.localize('rockit/schemaManager/browseRemoteTooltip', 'Browse remote schemas via API'),
                true 
            )}

            {onConfigureProviders && (
                <Tooltip title={nls.localize('rockit/schemaManager/configureProviders', 'Configure Providers')} PopperProps={{ style: { zIndex: 99999 } }}>
                    <IconButton 
                        size="small" 
                        onClick={onConfigureProviders}
                        className="schema-toolbar__icon-btn"
                    >
                        <SettingsInputComponentIcon className="schema-toolbar__icon-svg--large" />
                    </IconButton>
                </Tooltip>
            )}
            
            <div className="schema-toolbar__spacer" /> 

            {/* Group 3: Global Actions */}
            <Tooltip title={nls.localize('rockit/schemaManager/refreshList', 'Refresh List')} PopperProps={{ style: { zIndex: 99999 } }}>
                <IconButton 
                    size="small"
                    onClick={onRefresh}
                    className="schema-toolbar__icon-btn"
                >
                    <RefreshIcon className="schema-toolbar__icon-svg--large" />
                </IconButton>
            </Tooltip>
            
            {onDelete && selectedCount > 0 && (
                <div className="schema-toolbar__delete-group">
                    <div className="schema-toolbar__separator" />
                    <button 
                        className="schema-toolbar__btn schema-toolbar__btn--delete" 
                        onClick={onDelete} 
                        title={nls.localize('rockit/schemaManager/deleteSelected', 'Delete selected schemas')}
                    >
                        <span className="schema-toolbar__btn-icon">
                            <DeleteOutlineIcon className="schema-toolbar__icon-svg" />
                        </span>
                        <span className="schema-toolbar__btn-label">
                            {nls.localize('rockit/schemaManager/deleteCount', 'Delete ({0})', selectedCount)}
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
});
