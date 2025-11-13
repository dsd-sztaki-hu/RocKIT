import * as React from 'react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { Message } from '@theia/core/lib/browser';

// --- SCHEMA.ORG TYPES AND UTILITIES ---

interface SchemaProperty {
    label: string;
    comment: string;
}

const SCHEMA_ORG_PROPERTIES_URL = 'https://schema.org/version/latest/schemaorg-current-http-properties.csv';

// Helper function to parse CSV data
const parseCsv = (csvText: string): SchemaProperty[] => {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length <= 1) {
        return [];
    }

    const headerLine = lines[0];
    const headers = headerLine.split(',').map(header => header.trim().replace(/^"|"$/g, ''));
    
    const labelIndex = headers.indexOf('label');
    const commentIndex = headers.indexOf('comment');

    if (labelIndex === -1 || commentIndex === -1) {
        console.error(`CSV missing required headers. Found: [${headers.join(', ')}]`);
        return [];
    }

    const properties: SchemaProperty[] = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        
        if (values.length > commentIndex) {
            properties.push({
                label: values[labelIndex] ? values[labelIndex].trim().replace(/^"|"$/g, '') : 'N/A',
                comment: values[commentIndex] ? values[commentIndex].trim().replace(/^"|"$/g, '') : 'No description provided'
            });
        }
    }
    return properties;
};

// --- POPUP/MODAL COMPONENT ---

interface PropertyListModalProps {
    properties: SchemaProperty[];
    onClose: () => void;
    loading: boolean;
    error: string | null;
}

const PropertyListModal: React.FC<PropertyListModalProps> = ({ properties, onClose, loading, error }) => {
    const [searchTerm, setSearchTerm] = React.useState('');

    const filteredProperties = properties.filter(prop => 
        prop.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.comment.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div style={modalOverlayStyle}>
            <div style={modalContentStyle}>
                <h3 style={{ borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>Schema.org Properties List</h3>
                <input
                    type="text"
                    placeholder="Search properties..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ width: '98%', padding: '8px', marginBottom: '10px' }}
                />

                {loading && <p>Loading properties...</p>}
                {error && <p style={{ color: 'red' }}>Error: {error}</p>}

                {!loading && !error && (
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {filteredProperties.length === 0 ? (
                            <p>No properties match your search.</p>
                        ) : (
                            <ul style={{ listStyleType: 'none', padding: 0 }}>
                                {filteredProperties.map((prop, index) => (
                                    <li key={index} style={propertyListItemStyle}>
                                        <div style={{ fontWeight: 'bold', color: '#007ACC' }}>{prop.label}</div>
                                        <div style={{ fontSize: '0.9em' }}>{prop.comment}</div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
                
                <button 
                    onClick={onClose} 
                    className='theia-button' 
                    style={{ marginTop: '20px', float: 'right' }}
                >
                    Close
                </button>
            </div>
        </div>
    );
};

const modalOverlayStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
};

const modalContentStyle: React.CSSProperties = {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '5px',
    width: '500px',
    boxShadow: '0 5px 15px rgba(0, 0, 0, 0.3)',
};

const propertyListItemStyle: React.CSSProperties = {
    marginBottom: '10px',
    padding: '5px 0',
    borderBottom: '1px dotted #eee',
};


// --- SHCEMA SELECTOR WIDGET CLASS ---

@injectable()
export class SchemaSelectorWidget extends ReactWidget {

    static readonly ID = 'schema-selector:widget';
    static readonly LABEL = 'SchemaSelector Widget';

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    private readonly propertiesState = {
        properties: [] as SchemaProperty[],
        loading: true,
        error: null as string | null,
        isModalOpen: false,
    };

    @postConstruct()
    protected init(): void {
        this.doInit()
    }

    protected async doInit(): Promise <void> {
        this.id = SchemaSelectorWidget.ID;
        this.title.label = SchemaSelectorWidget.LABEL;
        this.title.caption = SchemaSelectorWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-window-maximize'; // example widget icon.
        this.fetchSchemaProperties();
    }

    private async fetchSchemaProperties(): Promise<void> {
        try {
            const response = await fetch(SCHEMA_ORG_PROPERTIES_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const csvText = await response.text();
            this.propertiesState.properties = parseCsv(csvText);
        } catch (err: any) {
            this.propertiesState.error = `Failed to fetch or parse properties: ${err.message}`;
            console.error('Error fetching Schema.org properties:', err);
        } finally {
            this.propertiesState.loading = false;
            this.update();
        }
    }

    private openModal = () => {
        this.propertiesState.isModalOpen = true;
        this.update();
    };

    private closeModal = () => {
        this.propertiesState.isModalOpen = false;
        this.update();
    };

    render(): React.ReactElement {
        const header = `This is a sample widget which simply calls the messageService
        in order to display an info message to end users.`;
        return <div id='widget-container'>
            <AlertMessage type='INFO' header={header} />
            <button id='displayMessageButton' className='theia-button secondary' title='Display Message' onClick={_a => this.displayMessage()}>Display Message</button>
            
            {/* --- NEW BUTTON --- */}
            <button id='addNewPropertyButton' className='theia-button primary' title='Add new Schema.org property' onClick={this.openModal}>
                Add new property
            </button>
                
            {/* --- POPUP RENDER --- */}
            {this.propertiesState.isModalOpen && (
                <PropertyListModal
                    properties={this.propertiesState.properties}
                    onClose={this.closeModal}
                    loading={this.propertiesState.loading}
                    error={this.propertiesState.error}
                />
            )}
        </div>
    }

    protected displayMessage(): void {
        this.messageService.info('Congratulations: SchemaSelector Widget Successfully Created!');
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        const htmlElement = document.getElementById('displayMessageButton');
        if (htmlElement) {
            htmlElement.focus();
        }
    }

}
