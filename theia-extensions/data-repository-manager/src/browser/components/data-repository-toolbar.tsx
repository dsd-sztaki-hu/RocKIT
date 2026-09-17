// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as React from 'react';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { nls } from '@theia/core/lib/common/nls';

import { DataRepositoryToolbarProps } from '../types';
import '../styles/data-repository-toolbar.css';

export const DataRepositoryToolbar: React.FC<DataRepositoryToolbarProps> = React.memo(({
    onImport,
    onExport,
    onConfigure,
    selectedCount = 0,
    onDeleteSelected
}) => {
    return (
        <div className="data-repo-toolbar">
            <button className="data-repo-toolbar__btn data-repo-toolbar__btn--primary" onClick={onImport}>
                <span className="data-repo-toolbar__btn-icon"><CloudDownloadIcon fontSize="small" /></span>
                {nls.localize('rockit/dataRepository/import', 'Import')}
            </button>
            <button className="data-repo-toolbar__btn data-repo-toolbar__btn--primary" onClick={onExport}>
                <span className="data-repo-toolbar__btn-icon"><CloudUploadIcon fontSize="small" /></span>
                {nls.localize('rockit/dataRepository/export', 'Export')}
            </button>
            
            <div className="data-repo-toolbar__spacer" />

            {selectedCount > 0 && onDeleteSelected && (
                <div className="data-repo-toolbar__action-group">
                    <button 
                        className="data-repo-toolbar__btn data-repo-toolbar__btn--delete" 
                        onClick={onDeleteSelected}
                        title={nls.localize('rockit/dataRepository/deleteSelected', 'Delete selected repositories')}
                    >
                        <span className="data-repo-toolbar__btn-icon"><DeleteOutlineIcon fontSize="small" /></span>
                        {nls.localize('rockit/dataRepository/deleteCount', 'Delete ({0})', selectedCount)}
                    </button>
                    <div className="data-repo-toolbar__separator" />
                </div>
            )}
            
            <button className="data-repo-toolbar__btn data-repo-toolbar__btn--secondary" onClick={onConfigure}>
                <span className="data-repo-toolbar__btn-icon"><AddIcon fontSize="small" /></span>
                {nls.localize('rockit/dataRepository/addRepository', 'Add Repository')}
            </button>
        </div>
    );
});
