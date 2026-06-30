import * as React from 'react';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { SvgIcon } from '@mui/material';

export const BlueFolderIcon = () => (
    <FolderIcon sx={{ color: '#049cfc', fontSize: 'inherit' }} />
);

export const DataverseIcon = (props: any) => (
    <SvgIcon viewBox="0 0 262.4 500" {...props} sx={{ color: '#049cfc', fontSize: 'inherit', ...props.sx }}>
        <path d="M142.1,258.7c0,0-0.1,0-0.1,0l0,0l-22-99.3c28-13.4,47.4-42,47.4-75.1c0-46-37.3-83.2-83.2-83.2S1,38.3,1,84.2 s37.3,83.2,83.2,83.2c1,0,1.9,0,2.9-0.1l21.3,96.1C58.4,278.1,22,324.2,22,378.8C22,445.2,75.8,499,142.1,499 s120.2-53.8,120.2-120.2S208.5,258.7,142.1,258.7z M84.2,142c-31.9,0-57.8-25.9-57.8-57.8c0-31.9,25.9-57.8,57.8-57.8 c31.9,0,57.8,25.9,57.8,57.8C142,116.1,116.1,142,84.2,142z M142.1,465.1c-47.7,0-86.3-38.6-86.3-86.3s38.6-86.3,86.3-86.3 s86.3,38.6,86.3,86.3S189.8,465.1,142.1,465.1z" />
    </SvgIcon>
);

export const DatasetIcon = () => (
    <InsertDriveFileIcon sx={{ color: 'var(--theia-descriptionForeground)', fontSize: 'inherit' }} />
);
