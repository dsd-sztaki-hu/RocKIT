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
import { ConnectionSuccessDialog } from './connection-success-dialog';

interface Props {
    open: boolean;
    providerToEdit?: RemoteSchemaProviderConfig;
    onClose: () => void;
    onSave: (config: RemoteSchemaProviderConfig) => Promise<void>;
    providerStore: RemoteSchemaProviderStoreService;
}

export const RemoteSchemaProviderConfigDialog: React.FC<Props> = ({ open, providerToEdit, onClose, onSave, providerStore }) => {
    // Form State
    const [baseUrl, setBaseUrl] = React.useState('');
    const [title, setTitle] = React.useState('');
    const [type, setType] = React.useState<'CEDAR'>('CEDAR');
    const [apiKey, setApiKey] = React.useState('');
    
    // UI Logic State
    const [showApiKey, setShowApiKey] = React.useState(false);
    const [isEditingKey, setIsEditingKey] = React.useState(true); 
    const [isTesting, setIsTesting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    // Success Flow State
    const [foundSchemas, setFoundSchemas] = React.useState<string[]>([]);
    const [showSuccessDialog, setShowSuccessDialog] = React.useState(false);
    const [pendingConfig, setPendingConfig] = React.useState<RemoteSchemaProviderConfig | null>(null);

    // Ref for manual focus enforcement
    const titleInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        // Reset state
        setError(null);
        setIsTesting(false);
        setShowSuccessDialog(false);
        setFoundSchemas([]);
        setPendingConfig(null);

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
            
            // Focus Enforcement
            setTimeout(() => {
                if (titleInputRef.current) {
                    titleInputRef.current.focus();
                }
            }, 300);
        }
    }, [providerToEdit]);

    const handleTestAndProceed = async () => {
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
            const schemaNames = await providerStore.testConnection(configToTest);
            setFoundSchemas(schemaNames);
            setPendingConfig(configToTest);
            setShowSuccessDialog(true);
        } catch (err: any) {
            setError(`Connection failed: ${err.message || 'Unknown error'}. Please check your configuration.`);
        } finally {
            setIsTesting(false);
        }
    };

    const handleConfirmSave = async () => {
        if (pendingConfig) {
            await onSave(pendingConfig);
            onClose();
        }
    };

    const handleResetKey = () => {
        setApiKey('');
        setIsEditingKey(true);
    };

    if (showSuccessDialog) {
        return (
            <ConnectionSuccessDialog 
                open={showSuccessDialog}
                providerName={title}
                schemaNames={foundSchemas}
                onConfirm={handleConfirmSave}
                onCancel={() => setShowSuccessDialog(false)}
            />
        );
    }

    return (
        <Dialog 
            open={open} 
            onClose={isTesting ? undefined : onClose} 
            maxWidth="sm" 
            fullWidth
            disablePortal={false} 
            disableScrollLock={true}
            disableRestoreFocus={true} 
            style={{ zIndex: 1301 }} 
        >
            <DialogTitle>
                {providerToEdit ? 'Edit Remote Schema Provider' : 'New Remote Schema Provider'}
            </DialogTitle>
            <DialogContent>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '8px' }}>
                    {error && <Alert severity="error">{error}</Alert>}
                    
                    <TextField
                        inputRef={titleInputRef}
                        label="Title (Display Name)"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        required
                        helperText="The name displayed in the remote schema provider list."
                        disabled={isTesting}
                        autoFocus
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
                            MenuProps={{ disablePortal: false }} 
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
                <Button onClick={handleTestAndProceed} variant="contained" disabled={isTesting}>
                    {isTesting ? <CircularProgress size={24} /> : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};