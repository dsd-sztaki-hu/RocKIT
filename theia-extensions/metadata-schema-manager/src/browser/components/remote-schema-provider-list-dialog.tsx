import * as React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    IconButton,
    Typography,
    Divider,
    DialogContentText
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import WarningIcon from '@mui/icons-material/Warning';
import { RemoteSchemaProviderConfig } from '../types';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';

interface Props {
    open: boolean;
    onClose: () => void;
    onAddProvider: () => void;
    onEditProvider: (provider: RemoteSchemaProviderConfig) => void;
    providerStore: RemoteSchemaProviderStoreService;
    lastUpdated: number; 
}

export const RemoteSchemaProviderListDialog: React.FC<Props> = ({ 
    open, 
    onClose, 
    onAddProvider, 
    onEditProvider, 
    providerStore,
    lastUpdated 
}) => {
    const [providers, setProviders] = React.useState<RemoteSchemaProviderConfig[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    
    // State for the Delete Confirmation Dialog
    const [deleteCandidateId, setDeleteCandidateId] = React.useState<string | null>(null);

    const loadProviders = React.useCallback(async () => {
        setIsLoading(true);
        const data = await providerStore.loadProviders();
        setProviders(data);
        setIsLoading(false);
    }, [providerStore]);

    React.useEffect(() => {
        if (open) {
            loadProviders();
        }
    }, [open, loadProviders, lastUpdated]);

    // 1. Request Deletion (Opens Dialog)
    const requestDelete = (id: string) => {
        setDeleteCandidateId(id);
    };

    // 2. Confirm Deletion (Performs Action)
    const confirmDelete = async () => {
        if (deleteCandidateId) {
            const newList = providers.filter(p => p.id !== deleteCandidateId);
            await providerStore.saveProviders(newList);
            setDeleteCandidateId(null); // Close confirm dialog
            loadProviders(); // Refresh list
        }
    };

    // 3. Cancel Deletion
    const cancelDelete = () => {
        setDeleteCandidateId(null);
    };

    return (
        <>
            {/* MAIN LIST DIALOG */}
            <Dialog 
                open={open} 
                onClose={onClose} 
                maxWidth="md" 
                fullWidth
                disablePortal={false} // Use standard Portal
                disableScrollLock={true} // Protect Theia layout
                style={{ zIndex: 1200 }} 
            >
                <DialogTitle style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Remote Schema Providers
                    <Button variant="contained" startIcon={<AddIcon />} onClick={onAddProvider}>
                        Add Provider
                    </Button>
                </DialogTitle>
                <DialogContent>
                    {isLoading ? (
                        <Typography>Loading...</Typography>
                    ) : providers.length === 0 ? (
                        <Typography align="center" color="textSecondary" style={{ marginTop: 20 }}>
                            No remote schema providers configured. Click "Add Provider" to create one.
                        </Typography>
                    ) : (
                        <List>
                            {providers.map((provider, index) => (
                                <React.Fragment key={provider.id}>
                                    <ListItem>
                                        <ListItemText
                                            primary={provider.title}
                                            secondary={`${provider.type} - ${provider.baseUrl}`}
                                        />
                                        <ListItemSecondaryAction>
                                            <IconButton edge="end" aria-label="edit" onClick={() => onEditProvider(provider)} style={{ marginRight: 8 }}>
                                                <EditIcon />
                                            </IconButton>
                                            <IconButton edge="end" aria-label="delete" onClick={() => requestDelete(provider.id)}>
                                                <DeleteIcon />
                                            </IconButton>
                                        </ListItemSecondaryAction>
                                    </ListItem>
                                    {index < providers.length - 1 && <Divider />}
                                </React.Fragment>
                            ))}
                        </List>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* DELETE CONFIRMATION DIALOG (Replaces window.confirm) */}
            <Dialog
                open={!!deleteCandidateId}
                onClose={cancelDelete}
                maxWidth="xs"
                disableScrollLock={true}
                style={{ zIndex: 1300 }} // Sit on top of list
            >
                <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#d32f2f' }}>
                    <WarningIcon color="error" /> Confirm Deletion
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Are you sure you want to delete this remote schema provider configuration?
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={cancelDelete} color="inherit">Cancel</Button>
                    <Button onClick={confirmDelete} color="error" variant="contained">Delete</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};