import * as React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    FormHelperText,
    Alert,
    CircularProgress,
    InputAdornment,
    IconButton
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { RemoteSchemaProviderConfig } from '../types';
import { RemoteSchemaProviderStoreService } from '../services/remote-schema-provider-store-service';

interface Props {
    open: boolean;
    providerToEdit?: RemoteSchemaProviderConfig;
    onClose: () => void;
    onSave: (config: RemoteSchemaProviderConfig) => Promise<void>;
    providerStore: RemoteSchemaProviderStoreService;
}

export const RemoteSchemaProviderConfigDialog: React.FC<Props> = ({ open, providerToEdit, onClose, onSave, providerStore }) => {
    const [baseUrl, setBaseUrl] = React.useState('');
    const [title, setTitle] = React.useState('');
    const [type, setType] = React.useState<'CEDAR'>('CEDAR');
    const [apiKey, setApiKey] = React.useState('');
    
    const [showApiKey, setShowApiKey] = React.useState(false);
    const [isEditingKey, setIsEditingKey] = React.useState(true); 
    
    const [isTesting, setIsTesting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (open) {
            setError(null);
            setIsTesting(false);
            if (providerToEdit) {
                setBaseUrl(providerToEdit.baseUrl);
                setTitle(providerToEdit.title);
                setType(providerToEdit.type);
                setApiKey(providerToEdit.apiKey || '');
                setIsEditingKey(false); 
            } else {
                setBaseUrl('');
                setTitle('');
                setType('CEDAR');
                setApiKey('');
                setIsEditingKey(true);
            }
        }
    }, [open, providerToEdit]);

    const handleSave = async () => {
        if (!baseUrl || !title || !type) {
            setError('Please fill in all required fields (Base URL, Title, Type).');
            return;
        }

        setIsTesting(true);
        setError(null);

        const configToTest: RemoteSchemaProviderConfig = {
            id: providerToEdit ? providerToEdit.id : Date.now().toString(),
            title,
            baseUrl,
            type,
            apiKey: apiKey 
        };

        try {
            await providerStore.testConnection(configToTest);
            await onSave(configToTest);
            onClose();
        } catch (err: any) {
            setError(`Connection failed: ${err.message || 'Unknown error'}. Please check your configuration.`);
        } finally {
            setIsTesting(false);
        }
    };

    const handleResetKey = () => {
        setApiKey('');
        setIsEditingKey(true);
    };

    return (
        <Dialog open={open} onClose={isTesting ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                {providerToEdit ? 'Edit Remote Schema Provider' : 'New Remote Schema Provider'}
            </DialogTitle>
            <DialogContent>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '8px' }}>
                    {error && <Alert severity="error">{error}</Alert>}
                    
                    <TextField
                        label="Title (Display Name)"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        required
                        helperText="The name displayed in the remote schema provider list."
                        disabled={isTesting}
                    />

                    <TextField
                        label="Base URL"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        required
                        helperText="e.g., https://schema.researchdata.hu"
                        disabled={isTesting}
                    />

                    <FormControl required disabled={isTesting}>
                        <InputLabel>Type</InputLabel>
                        <Select
                            value={type}
                            label="Type"
                            onChange={(e) => setType(e.target.value as 'CEDAR')}
                        >
                            <MenuItem value="CEDAR">CEDAR</MenuItem>
                        </Select>
                        <FormHelperText>Currently only CEDAR systems are supported.</FormHelperText>
                    </FormControl>

                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                         <TextField
                            label="API Key"
                            value={isEditingKey ? apiKey : '********'}
                            onChange={(e) => setApiKey(e.target.value)}
                            type={showApiKey && isEditingKey ? 'text' : 'password'}
                            fullWidth
                            helperText="Optional. Required for private resources."
                            disabled={!isEditingKey || isTesting}
                            InputProps={{
                                endAdornment: isEditingKey ? (
                                    <InputAdornment position="end">
                                        <IconButton
                                            onClick={() => setShowApiKey(!showApiKey)}
                                            edge="end"
                                        >
                                            {showApiKey ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </InputAdornment>
                                ) : undefined
                            }}
                        />
                        {!isEditingKey && (
                            <Button 
                                variant="outlined" 
                                color="warning" 
                                onClick={handleResetKey}
                                startIcon={<DeleteOutline />}
                                sx={{ mt: 1, height: '40px' }}
                            >
                                Change
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={isTesting}>Cancel</Button>
                <Button onClick={handleSave} variant="contained" disabled={isTesting}>
                    {isTesting ? <CircularProgress size={24} /> : 'Test & Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};