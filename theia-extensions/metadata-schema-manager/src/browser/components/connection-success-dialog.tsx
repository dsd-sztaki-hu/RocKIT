import * as React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Typography,
    Paper
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DescriptionIcon from '@mui/icons-material/Description';

interface Props {
    open: boolean;
    providerName: string;
    schemaNames: string[];
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConnectionSuccessDialog: React.FC<Props> = ({ open, providerName, schemaNames, onConfirm, onCancel }) => {
    return (
        <Dialog open={open} onClose={undefined} maxWidth="sm" fullWidth>
            <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#2e7d32' }}>
                <CheckCircleOutlineIcon fontSize="large" />
                Connection Successful
            </DialogTitle>
            <DialogContent>
                <Typography variant="body1" paragraph>
                    Successfully connected to <strong>{providerName}</strong>.
                </Typography>
                <Typography variant="body2" color="textSecondary" paragraph>
                    We found {schemaNames.length} available metadata templates. Here is a preview of what we found:
                </Typography>
                
                <Paper variant="outlined" style={{ maxHeight: '250px', overflow: 'auto', background: '#f9f9f9' }}>
                    <List dense>
                        {schemaNames.length > 0 ? (
                            schemaNames.map((name, index) => (
                                <ListItem key={index}>
                                    <ListItemIcon style={{ minWidth: '32px' }}>
                                        <DescriptionIcon fontSize="small" color="primary" />
                                    </ListItemIcon>
                                    <ListItemText primary={name} />
                                </ListItem>
                            ))
                        ) : (
                            <ListItem>
                                <ListItemText secondary="No templates found in public folders, but connection was established." />
                            </ListItem>
                        )}
                    </List>
                </Paper>
            </DialogContent>
            <DialogActions>
                {/* FIX: Label changed to Cancel */}
                <Button onClick={onCancel} color="inherit">
                    Cancel
                </Button>
                {/* FIX: Label changed to Save */}
                <Button onClick={onConfirm} variant="contained" color="success">
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};