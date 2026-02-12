import * as React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Typography,
    Alert
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';

interface Props {
    open: boolean;
    onClose: () => void;
    onImport: (url: string) => void;
}

export const MetadataSchemaImportFromUrlDialog: React.FC<Props> = ({ open, onClose, onImport }) => {
    const [url, setUrl] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (open) {
            setUrl('');
            setError(null);
            // Manual focus enforcement for reliability
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                }
            }, 100);
        }
    }, [open]);

    const handleImport = () => {
        if (!url.trim()) {
            setError('Please enter a valid URL.');
            return;
        }
        try {
            new URL(url); // Simple validation
        } catch (_) {
            setError('Invalid URL format.');
            return;
        }
        onImport(url);
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            disablePortal={false}
            disableScrollLock={true}
            disableEnforceFocus={true} 
            style={{ zIndex: 1300 }}
        >
            <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <LinkIcon color="primary" />
                Import Schema from URL
            </DialogTitle>
            <DialogContent>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '8px' }}>
                    <Typography variant="body2" color="textSecondary">
                        Enter the direct link to the metadata schema (JSON).
                        <br />
                        We will automatically check your configured providers for the necessary API keys.
                    </Typography>

                    {error && <Alert severity="error">{error}</Alert>}

                    <TextField
                        inputRef={inputRef}
                        label="Schema URL"
                        placeholder="https://repo.schema.researchdata.hu/templates/..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        fullWidth
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleImport();
                            }
                        }}
                    />
                </div>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleImport} variant="contained" color="primary">
                    Import
                </Button>
            </DialogActions>
        </Dialog>
    );
};