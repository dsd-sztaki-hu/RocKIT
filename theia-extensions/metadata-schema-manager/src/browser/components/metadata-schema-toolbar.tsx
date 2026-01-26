import * as React from 'react';
import { Button } from 'antd';

interface SchemaToolbarProps {
    onImportFile: () => void;
    onImportUrl: () => void;
    onRefresh: () => void;
    onDelete?: () => void;
    onBrowse?: () => void;
    selectedCount?: number;
}

export const MetadataSchemaToolbar: React.FC<SchemaToolbarProps> = React.memo(({
    onImportFile,
    onImportUrl,
    onRefresh,
    onDelete,
    onBrowse,
    selectedCount = 0
}) => {
    return (
        <div style={{ display: 'flex', gap: '8px', padding: '8px', borderBottom: '1px solid #f0f0f0' }}>
            <Button type="primary" onClick={onImportFile}>Import from File</Button>
            <Button type="primary" onClick={onImportUrl}>Import from URL</Button>
            
            {onBrowse && (
                <Button type="default" onClick={onBrowse}>Browse Remote</Button>
            )}
            
            <Button type="default" onClick={onRefresh}>Refresh</Button>
            
            {onDelete && selectedCount > 0 && (
                <Button type="primary" danger onClick={onDelete}>
                    Delete {selectedCount}
                </Button>
            )}
        </div>
    );
});