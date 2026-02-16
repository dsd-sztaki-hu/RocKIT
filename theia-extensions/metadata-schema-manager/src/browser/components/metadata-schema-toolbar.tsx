import * as React from 'react';

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
    
    // Standard spacing for buttons
    const btnStyle: React.CSSProperties = {
        marginRight: '8px'
    };

    return (
        <div style={{ 
            display: 'flex', 
            padding: '8px 0', 
            flexWrap: 'wrap',
            alignItems: 'center'
        }}>
            <button 
                className="theia-button" 
                onClick={onImportFile}
                title="Import a schema from a local JSON file"
                style={btnStyle}
            >
                Import File
            </button>
            
            <button 
                className="theia-button" 
                onClick={onImportUrl}
                title="Import a schema from a URL"
                style={btnStyle} // Added margin back since divider is gone
            >
                Import URL
            </button>
            
            {/* Divider Removed */}

            {onBrowse && (
                <button 
                    className="theia-button" 
                    onClick={onBrowse}
                    title="Browse remote schemas via API"
                    style={btnStyle}
                >
                    Browse Remote
                </button>
            )}

            {onConfigureProviders && (
                <button 
                    className="theia-button" 
                    onClick={onConfigureProviders}
                    title="Manage remote schema repositories and API keys"
                    style={btnStyle}
                >
                    Configure Providers
                </button>
            )}
            
            <div style={{ flexGrow: 1 }} /> {/* Spacer */}

            {/* Compact Square Refresh Button */}
            <button 
                className="theia-button" 
                onClick={onRefresh} 
                title="Refresh List"
                style={{ 
                    width: '28px',
                    height: '28px',
                    padding: 0,
                    minWidth: '28px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center'
                }}
            >
                <i className="codicon codicon-refresh" style={{ fontSize: '14px' }} />
            </button>
            
            {onDelete && selectedCount > 0 && (
                <button 
                    className="theia-button" 
                    onClick={onDelete} 
                    style={{ 
                        marginLeft: '8px',
                        backgroundColor: '#8b0000',
                        borderColor: '#8b0000',
                        color: 'white'
                    }}
                    title="Delete selected schemas"
                >
                    Delete ({selectedCount})
                </button>
            )}
        </div>
    );
});