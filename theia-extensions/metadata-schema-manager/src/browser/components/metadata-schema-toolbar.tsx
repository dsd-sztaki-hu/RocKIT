// src/browser/components/metadata-schema-toolbar.tsx

import * as React from 'react';

// MUI Icons
import NoteAddIcon from '@mui/icons-material/NoteAdd'; // Import File
import LinkIcon from '@mui/icons-material/Link'; // Import URL
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'; // Browse Remote
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent'; // Config
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Tooltip, IconButton } from '@mui/material';

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
    
    // Helper to render a standard toolbar button
    const renderActionButton = (
        label: string, 
        icon: React.ReactNode, 
        onClick: () => void, 
        title: string,
        primary = false
    ) => (
        <button 
            className={`theia-button ${primary ? '' : 'secondary'}`}
            onClick={onClick}
            title={title}
            style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px',
                height: '28px', // Standard toolbar height
                fontSize: '13px',
                padding: '0 10px',
                marginRight: '8px',
                border: primary ? undefined : '1px solid var(--theia-button-border, transparent)'
            }}
        >
            {icon}
            {label}
        </button>
    );

    const separatorStyle: React.CSSProperties = {
        width: '1px',
        height: '20px',
        backgroundColor: 'var(--theia-panel-border)',
        margin: '0 10px'
    };

    return (
        <div style={{ 
            display: 'flex', 
            padding: '10px 15px', 
            flexWrap: 'wrap',
            alignItems: 'center',
            backgroundColor: 'var(--theia-editor-background)',
            borderBottom: '1px solid var(--theia-panel-border)'
        }}>
            {/* Group 1: Local Imports */}
            {renderActionButton(
                "Import File", 
                <NoteAddIcon style={{ fontSize: '16px' }}/>, 
                onImportFile, 
                "Import a schema from a local JSON file",
                true
            )}
            
            {renderActionButton(
                "Import URL", 
                <LinkIcon style={{ fontSize: '16px' }}/>, 
                onImportUrl, 
                "Import a schema from a URL"
            )}

            <div style={separatorStyle} />

            {/* Group 2: Remote / Cloud */}
            {onBrowse && renderActionButton(
                "Browse Remote", 
                <CloudDownloadIcon style={{ fontSize: '16px' }}/>, 
                onBrowse, 
                "Browse remote schemas via API"
            )}

            {onConfigureProviders && (
                <Tooltip title="Configure Providers" PopperProps={{ style: { zIndex: 99999 } }}>
                    <IconButton 
                        size="small" 
                        onClick={onConfigureProviders}
                        style={{ 
                            color: 'var(--theia-icon-foreground)',
                            marginRight: '4px',
                            padding: '6px',
                            borderRadius: '4px'
                        }}
                    >
                        <SettingsInputComponentIcon style={{ fontSize: '18px' }} />
                    </IconButton>
                </Tooltip>
            )}
            
            <div style={{ flexGrow: 1 }} /> {/* Spacer */}

            {/* Group 3: Global Actions */}
            <Tooltip title="Refresh List" PopperProps={{ style: { zIndex: 99999 } }}>
                <IconButton 
                    size="small"
                    onClick={onRefresh}
                    style={{ 
                        color: 'var(--theia-icon-foreground)', 
                        padding: '6px',
                        borderRadius: '4px'
                    }}
                >
                    <RefreshIcon style={{ fontSize: '18px' }} />
                </IconButton>
            </Tooltip>
            
            {onDelete && selectedCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', marginLeft: '10px' }}>
                    <div style={separatorStyle} />
                    <button 
                        className="theia-button" 
                        onClick={onDelete} 
                        style={{ 
                            marginLeft: '4px',
                            backgroundColor: 'var(--theia-errorForeground)', 
                            borderColor: 'var(--theia-errorForeground)',
                            color: 'var(--theia-editor-background)', 
                            display: 'flex', 
                            alignItems: 'center',
                            gap: '6px',
                            height: '28px',
                            fontSize: '12px',
                            padding: '0 10px'
                        }}
                        title="Delete selected schemas"
                    >
                        <DeleteOutlineIcon style={{ fontSize: '16px' }} />
                        Delete ({selectedCount})
                    </button>
                </div>
            )}
        </div>
    );
});