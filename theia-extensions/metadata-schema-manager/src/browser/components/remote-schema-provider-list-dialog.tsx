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
    Divider
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { RemoteSchemaProviderConfig } from '../types';
import { RemoteSchemaProviderConfigDialog } from './remote-schema-provider-config-dialog';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';

interface Props {
    open: boolean;
    onClose: () => void;
    providerStore: RemoteSchemaProviderStoreService;
}

export const RemoteSchemaProviderListDialog: React.FC<Props> = ({ open, onClose, providerStore }) => {
    const [providers, setProviders] = React.useState<RemoteSchemaProviderConfig[]>([]);
    const [isConfigOpen, setIsConfigOpen] = React.useState(false);
    const [selectedProvider, setSelectedProvider] = React.useState<RemoteSchemaProviderConfig | undefined>(undefined);
    const [isLoading, setIsLoading] = React.useState(false);

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
    }, [open, loadProviders]);

    const handleAdd = () => {
        setSelectedProvider(undefined);
        setIsConfigOpen(true);
    };

    const handleEdit = (provider: RemoteSchemaProviderConfig) => {
        setSelectedProvider(provider);
        setIsConfigOpen(true);
    };

    const handleDelete = async (id: string) => {
        const confirm = window.confirm("Are you sure you want to delete this remote schema provider configuration?");
        if (confirm) {
            const newList = providers.filter(p => p.id !== id);
            await providerStore.saveProviders(newList);
            loadProviders();
        }
    };

    const handleSaveConfig = async (newConfig: RemoteSchemaProviderConfig) => {
        let newList = [...providers];
        if (selectedProvider) {
            // Edit mode
            const index = newList.findIndex(p => p.id === selectedProvider.id);
            if (index !== -1) {
                newList[index] = newConfig;
            }
        } else {
            // Add mode
            newList.push(newConfig);
        }
        await providerStore.saveProviders(newList);
        loadProviders();
    };

    return (
        <>
            <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
                <DialogTitle style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Remote Schema Providers
                    <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd}>
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
                                            <IconButton edge="end" aria-label="edit" onClick={() => handleEdit(provider)} style={{ marginRight: 8 }}>
                                                <EditIcon />
                                            </IconButton>
                                            <IconButton edge="end" aria-label="delete" onClick={() => handleDelete(provider.id)}>
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

            <RemoteSchemaProviderConfigDialog 
                open={isConfigOpen}
                providerToEdit={selectedProvider}
                onClose={() => setIsConfigOpen(false)}
                onSave={handleSaveConfig}
                providerStore={providerStore}
            />
        </>
    );
};