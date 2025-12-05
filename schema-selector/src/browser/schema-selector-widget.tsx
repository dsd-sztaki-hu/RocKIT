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

export const parseCsv = (csvText: string): SchemaProperty[] => {
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
            const rawLabel = values[labelIndex] ? values[labelIndex].trim().replace(/^"|"$/g, '') : '';

            if (!rawLabel) {
                continue;
            }

            properties.push({
                label: rawLabel,
                comment: values[commentIndex] ? values[commentIndex].trim().replace(/^"|"$/g, '') : 'No description provided'
            });
        }
    }
    return properties;
};

// --- POPUP/MODAL COMPONENT ---

const PropertyListView = React.memo<{ properties: SchemaProperty[] }>(({ properties }) => {
    if (properties.length === 0) {
        return <p>No properties match your search.</p>;
    }

    return (
        <ul style={{ listStyleType: 'none', padding: 0 }}>
            {properties.map((prop, index) => (
                <li
                    key={index}
                    style={propertyListItemStyle}
                    onClick={() => console.log(prop.label)}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#e3f2fd';
                        e.currentTarget.style.cursor = 'pointer';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                >
                    <div style={{ fontWeight: 'bold', color: '#007ACC' }}>{prop.label}</div>
                    <div style={{ fontSize: '0.9em' }}>{prop.comment}</div>
                </li>
            ))}
        </ul>
    );
});

// --- POPUP/MODAL COMPONENT ---

interface PropertyListModalProps {
    properties: SchemaProperty[];
    onClose: () => void;
    loading: boolean;
    error: string | null;
}

const PropertyListModal: React.FC<PropertyListModalProps> = ({ properties, onClose, loading, error }) => {
    const [searchTerm, setSearchTerm] = React.useState('');

    const [position, setPosition] = React.useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = React.useState(false);
    const [offset, setOffset] = React.useState({ x: 0, y: 0 });

    const [hasMoved, setHasMoved] = React.useState(false);

    const modalRef = React.useRef<HTMLDivElement>(null);

    // --- DRAG HANDLERS ---
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        if (!modalRef.current) return;

        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.closest('li')) {
            return;
        }

        const rect = modalRef.current.getBoundingClientRect();

        const newOffset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
        setOffset(newOffset);

        setPosition({
            x: rect.left,
            y: rect.top
        });

        setHasMoved(true);
        setIsDragging(true);
        e.preventDefault();
    };

    React.useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            setPosition({
                x: e.clientX - offset.x,
                y: e.clientY - offset.y,
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, offset]);

    const filteredProperties = React.useMemo(() => {
        return properties.filter(prop =>
            prop.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
            prop.comment.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [properties, searchTerm]);

    const draggableModalContentStyle: React.CSSProperties = {
        ...modalContentStyle,
        position: 'fixed',
        display: 'flex',
        flexDirection: 'column',
        ...(!hasMoved
                ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
                : { top: position.y, left: position.x, transform: 'none' }
        ),
        cursor: isDragging ? 'grabbing' : 'grab',
    };

    return (
        <div style={modalOverlayStyle}>
            <div
                style={draggableModalContentStyle}
                ref={modalRef}
                onMouseDown={handleMouseDown}
            >
                <h3 style={{ borderBottom: '1px solid #ccc', paddingBottom: '10px', flexShrink: 0, userSelect: 'none' }}>
                    Schema.org Properties List
                </h3>

                <input
                    type="text"
                    placeholder="Search properties..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ width: '98%', padding: '8px', marginBottom: '10px', flexShrink: 0 }}
                    onMouseDown={e => e.stopPropagation()}
                />

                {loading && <p style={{flexShrink: 0}}>Loading properties...</p>}
                {error && <p style={{ color: 'red', flexShrink: 0 }}>Error: {error}</p>}

                {!loading && !error && (
                    <div style={{ flexGrow: 1, overflowY: 'auto' }}>
                        <PropertyListView properties={filteredProperties} />
                    </div>
                )}

                <button
                    onClick={onClose}
                    className='theia-button'
                    style={{ marginTop: '20px', alignSelf: 'flex-end', flexShrink: 0 }}
                    onMouseDown={e => e.stopPropagation()}
                >
                    Close
                </button>
            </div>
        </div>
    );
};

// --- GLOBAL STYLES ---

const modalOverlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 99999,
};

const modalContentStyle: React.CSSProperties = {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '5px',
    width: '800px',
    height: '600px',
    boxShadow: '0 5px 15px rgba(0, 0, 0, 0.3)',
};

const propertyListItemStyle: React.CSSProperties = {
    padding: '5px 6px',
    borderBottom: '1px dotted #eee',
    transition: 'background-color 0.15s ease'
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

        const widgetContent = <div id='widget-container'>
            <AlertMessage type='INFO' header={header} />
            <button id='displayMessageButton' className='theia-button secondary' title='Display Message' onClick={_a => this.displayMessage()}>Display Message</button>

            <button id='addNewPropertyButton' className='theia-button primary' title='Add new Schema.org property' onClick={this.openModal}>
                Add new property
            </button>
        </div>

        const modal = this.propertiesState.isModalOpen
            ? (
                <PropertyListModal
                    properties={this.propertiesState.properties}
                    onClose={this.closeModal}
                    loading={this.propertiesState.loading}
                    error={this.propertiesState.error}
                />
            )
            : null;

        return (
            <>
                {widgetContent}
                {modal}
            </>
        );
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