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
    ListItemIcon,
    Typography,
    CircularProgress
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import AddIcon from '@mui/icons-material/Add';
import { RemoteSchemaProviderConfig } from '../types';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';

interface Props {
    open: boolean;
    onClose: () => void;
    onSelect: (provider: RemoteSchemaProviderConfig) => void;
    onConfigure: () => void; // Shortcut to open configuration if list is empty
    providerStore: RemoteSchemaProviderStoreService;
}

export const RemoteSchemaProviderSelectorDialog: React.FC<Props> = ({ 
    open, 
    onClose, 
    onSelect, 
    onConfigure, 
    providerStore 
}) => {
    const [providers, setProviders] = React.useState<RemoteSchemaProviderConfig[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);

    React.useEffect(() => {
        if (open) {
            setIsLoading(true);
            providerStore.loadProviders().then(data => {
                setProviders(data);
                setIsLoading(false);
            });
        }
    }, [open, providerStore]);

    const handleListItemClick = (provider: RemoteSchemaProviderConfig) => {
        onSelect(provider);
        onClose();
    };

    return (
        <Dialog 
            open={open} 
            onClose={onClose} 
            maxWidth="sm" 
            fullWidth
            disablePortal={false} // Render in body
            disableScrollLock={true}
            style={{ zIndex: 1200 }} 
        >
            <DialogTitle>Select a Remote Provider</DialogTitle>
            <DialogContent>
                {isLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                        <CircularProgress />
                    </div>
                ) : providers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 20 }}>
                        <Typography color="textSecondary" paragraph>
                            No remote schema providers configured.
                        </Typography>
                        <Button variant="outlined" startIcon={<AddIcon />} onClick={onConfigure}>
                            Configure Providers
                        </Button>
                    </div>
                ) : (
                    <List>
                        {providers.map((provider) => (
                            <ListItem 
                                button 
                                key={provider.id} 
                                onClick={() => handleListItemClick(provider)}
                            >
                                <ListItemIcon>
                                    <StorageIcon color="primary" />
                                </ListItemIcon>
                                <ListItemText 
                                    primary={provider.title} 
                                    secondary={provider.baseUrl} 
                                />
                            </ListItem>
                        ))}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
            </DialogActions>
        </Dialog>
    );
};