import * as React from 'react';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AddIcon from '@mui/icons-material/Add';

import { DataRepositoryToolbarProps } from '../types';
import '../styles/data-repository-toolbar.css';

export const DataRepositoryToolbar: React.FC<DataRepositoryToolbarProps> = React.memo(({
    onImport,
    onExport,
    onConfigure
}) => {
    return (
        <div className="data-repo-toolbar">
            <button className="data-repo-toolbar__btn data-repo-toolbar__btn--primary" onClick={onImport}>
                <span className="data-repo-toolbar__btn-icon"><CloudDownloadIcon fontSize="small" /></span>
                Import
            </button>
            <button className="data-repo-toolbar__btn data-repo-toolbar__btn--primary" onClick={onExport}>
                <span className="data-repo-toolbar__btn-icon"><CloudUploadIcon fontSize="small" /></span>
                Export
            </button>
            
            <div className="data-repo-toolbar__spacer" />
            
                <button className="data-repo-toolbar__btn data-repo-toolbar__btn--secondary" onClick={onConfigure}>
                    <span className="data-repo-toolbar__btn-icon"><AddIcon fontSize="small" /></span>
                    Add Repository
                </button>
        </div>
    );
});