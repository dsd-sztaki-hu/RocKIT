import * as React from 'react';
import { 
    Dialog, DialogTitle, DialogContent, DialogActions, 
    Button, TextField, CircularProgress, Alert, Box 
} from '@mui/material';
import { RemoteSchemaProviderConfig } from '../types';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';

interface ConfigDialogProps {
    open: boolean;
    providerToEdit?: RemoteSchemaProviderConfig;
    onClose: () => void;
    onSave: (config: RemoteSchemaProviderConfig) => void;
    providerStore: RemoteSchemaProviderStoreService;
}

export const RemoteSchemaProviderConfigDialog: React.FC<ConfigDialogProps> = ({
    open, providerToEdit, onClose, onSave, providerStore
}) => {
    // Form State
    const [title, setTitle] = React.useState('');
    const [baseUrl, setBaseUrl] = React.useState('');
    const [apiKey, setApiKey] = React.useState('');
    
    // UI State
    const [isTesting, setIsTesting] = React.useState(false);
    const [testStatus, setTestStatus] = React.useState<{ type: 'success' | 'error', message: string } | null>(null);

    // Reset or Populate form when dialog opens
    React.useEffect(() => {
        if (open) {
            setTestStatus(null);
            setIsTesting(false);
            if (providerToEdit) {
                setTitle(providerToEdit.title);
                setBaseUrl(providerToEdit.baseUrl);
                setApiKey(providerToEdit.apiKey || '');
            } else {
                setTitle('');
                setBaseUrl('');
                setApiKey('');
            }
        }
    }, [open, providerToEdit]);

    const handleTest = async () => {
        // Basic Validation
        if (!baseUrl) {
            setTestStatus({ type: 'error', message: 'Please enter a Base URL.' });
            return;
        }

        setIsTesting(true);
        setTestStatus(null);
        
        try {
            await providerStore.testConnection(baseUrl, apiKey);
            setTestStatus({ type: 'success', message: 'Connection successful!' });
        } catch (e) {
            setTestStatus({ type: 'error', message: `Connection failed: ${e instanceof Error ? e.message : String(e)}` });
        } finally {
            setIsTesting(false);
        }
    };

    const handleSave = () => {
        if (!title || !baseUrl) {
            setTestStatus({ type: 'error', message: 'Title and Base URL are required.' });
            return;
        }

        const id = providerToEdit?.id || Date.now().toString();
        
        onSave({
            id,
            title,
            baseUrl,
            apiKey: apiKey || undefined,
            // FIX: Use uppercase "CEDAR" to match the interface type definition
            type: providerToEdit?.type || 'CEDAR' 
        });
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>{providerToEdit ? "Edit Provider" : "Add Provider"}</DialogTitle>
            
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 1 }}>
                    <TextField
                        autoFocus
                        label="Title"
                        placeholder="e.g. My Repository"
                        fullWidth
                        variant="outlined"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    />
                    
                    <TextField
                        label="Base URL"
                        placeholder="https://repo.cedar.metadatacenter.org"
                        fullWidth
                        variant="outlined"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                    />
                    
                    <TextField
                        label="API Key"
                        placeholder="Secret API Key"
                        type="password"
                        fullWidth
                        variant="outlined"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        helperText="Leave empty for public access. Stored securely in OS keychain."
                    />

                    {/* Feedback Area */}
                    {isTesting && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={20} />
                            <span>Testing connection...</span>
                        </Box>
                    )}

                    {testStatus && !isTesting && (
                        <Alert severity={testStatus.type}>
                            {testStatus.message}
                        </Alert>
                    )}
                </Box>
            </DialogContent>
            
            <DialogActions style={{ padding: '16px 24px' }}>
                <Button 
                    onClick={handleTest} 
                    disabled={isTesting || !baseUrl}
                    style={{ marginRight: 'auto' }}
                >
                    Test Connection
                </Button>

                <Button onClick={onClose} color="primary">
                    Cancel
                </Button>
                <Button onClick={handleSave} color="primary" variant="contained">
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};