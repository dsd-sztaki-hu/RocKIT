import * as React from 'react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/lib/browser';
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import ReactJson from 'react-json-view';

const RO_CRATE_METADATA_FILE = 'ro-crate-metadata.json';

const RoCrateJsonView = React.memo<{ jsonObject: any }>(({ jsonObject }) => {
    return (
        <div style={jsonContainerStyle}>
            <ReactJson
                src={jsonObject}
                theme="monokai"
                iconStyle={'triangle'}
                collapsed={2}
                displayDataTypes={false}
                enableClipboard={true}
                style={{ backgroundColor: 'transparent' }}
            />
        </div>
    );
});

interface RoCrateModalProps {
    jsonObject: any;
    onClose: () => void;
    loading: boolean;
    error: string | null;
}

const RoCrateModal: React.FC<RoCrateModalProps> = ({ jsonObject, onClose, loading, error }) => {
    // --- DRAG STATE ---
    const [position, setPosition] = React.useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = React.useState(false);
    const [offset, setOffset] = React.useState({ x: 0, y: 0 });
    const [hasMoved, setHasMoved] = React.useState(false);

    const [isCopied, setIsCopied] = React.useState(false);

    const modalRef = React.useRef<HTMLDivElement>(null);

    // --- COPY HANDLER ---
    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(JSON.stringify(jsonObject, null, 2));
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 5000);
        } catch (err) {
            console.error('Failed to copy to clipboard', err);
        }
    };

    // --- DRAG HANDLERS ---
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        if (!modalRef.current) return;

        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON' || target.closest('.copy-to-clipboard-container') || target.tagName === 'I') {
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

    // --- STYLES ---
    const draggableModalContentStyle: React.CSSProperties = {
        ...modalContentStyle,
        position: 'fixed',
        display: 'flex',
        flexDirection: 'column',
        ...(!hasMoved
                ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
                : { top: position.y, left: position.x, transform: 'none' }
        ),
        cursor: isDragging ? 'grabbing' : 'auto',
    };

    return (
        <div style={modalOverlayStyle}>
            <div
                style={draggableModalContentStyle}
                ref={modalRef}
                onMouseDown={handleMouseDown}
            >
                {/* Header */}
                <div
                    style={{
                        borderBottom: '1px solid var(--theia-tree-indentGuidesStroke)',
                        paddingBottom: '15px',
                        marginBottom: '15px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: isDragging ? 'grabbing' : 'grab'
                    }}
                >
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, pointerEvents: 'none' }}>
                        RO-Crate source: <span style={{color: '#ce9178'}}>{RO_CRATE_METADATA_FILE}</span>
                    </h3>

                    <div
                        title="Copy raw JSON to clipboard"
                        onClick={handleCopy}
                        style={{
                            cursor: 'pointer',
                            padding: '5px 10px',
                            color: isCopied ? '#4caf50' : 'var(--theia-editor-foreground)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontWeight: 'bold',
                            fontSize: '14px'
                        }}
                    >
                        {isCopied && <span>Copied</span>}

                        <i
                            className={isCopied ? "fa fa-check" : "fa fa-clipboard"}
                            style={{ fontSize: '20px' }}
                        ></i>
                    </div>
                </div>

                {/* Content */}
                {loading && <div style={{textAlign: 'center', padding: '20px'}}><i className="fa fa-spinner fa-spin"></i> Loading...</div>}

                {error && <AlertMessage type='ERROR' header='Error'>{error}</AlertMessage>}

                {!loading && !error && (
                    <RoCrateJsonView jsonObject={jsonObject} />
                )}

                {/* Footer */}
                <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={onClose}
                        className='theia-button secondary'
                        onMouseDown={e => e.stopPropagation()}
                    >
                        Close
                    </button>
                </div>
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
    backgroundColor: 'var(--theia-editor-background)',
    color: 'var(--theia-editor-foreground)',
    border: '1px solid var(--theia-widget-shadow)',
    padding: '20px',
    borderRadius: '4px',
    width: '64%',
    height: '90vh',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
};

const jsonContainerStyle: React.CSSProperties = {
    backgroundColor: '#2d2d2d',
    padding: '15px',
    borderRadius: '4px',
    overflowY: 'auto',
    flexGrow: 1,
    border: '1px solid var(--theia-tree-indentGuidesStroke)',
    cursor: 'text'
};

@injectable()
export class RoCratePreviewWidget extends ReactWidget {

    static readonly ID = 'ro-crate-preview:widget';
    static readonly LABEL = 'RoCratePreview Widget';

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    private readonly previewState = {
        jsonObject: {} as any,
        loading: false,
        error: null as string | null,
        isModalOpen: false,
    };

    @postConstruct()
    protected init(): void {
        this.doInit()
    }

    protected async doInit(): Promise <void> {
        this.id = RoCratePreviewWidget.ID;
        this.title.label = RoCratePreviewWidget.LABEL;
        this.title.caption = RoCratePreviewWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-window-maximize';
        this.update();
    }

    private openModal = async () => {
        this.previewState.isModalOpen = true;
        this.previewState.loading = true;
        this.previewState.error = null;
        this.update();

        try {
            const roots = this.workspaceService.tryGetRoots();
            if (roots.length === 0) {
                throw new Error('No workspace folder open.');
            }
            const rootUri = roots[0].resource;
            const fileUri = rootUri.resolve(RO_CRATE_METADATA_FILE);

            const content: any = await this.fileService.readFile(fileUri);
            const fileContent = content.value.toString('utf8');

            try {
                this.previewState.jsonObject = JSON.parse(fileContent);
            } catch (e) {
                throw new Error("File content is not valid JSON.");
            }

        } catch (err: any) {
            this.previewState.error = `Could not read ${RO_CRATE_METADATA_FILE}: ${err.message}`;
            this.previewState.jsonObject = {};
            console.error('Error reading RO-Crate metadata:', err);
        } finally {
            this.previewState.loading = false;
            this.update();
        }
    };

    private closeModal = () => {
        this.previewState.isModalOpen = false;
        this.update();
    };

    render(): React.ReactElement {
        return <div id='widget-container' style={{padding: '20px'}}>
            <div style={{display: 'flex', gap: '10px'}}>
                <button
                    id='viewRoCrateSourceButton'
                    className='theia-button primary'
                    title={`View ${RO_CRATE_METADATA_FILE}`}
                    onClick={this.openModal}
                >
                    <i className='fa fa-code' style={{marginRight: '6px'}}></i>
                    View RO-Crate Source
                </button>
            </div>

            {this.previewState.isModalOpen && (
                <RoCrateModal
                    jsonObject={this.previewState.jsonObject}
                    onClose={this.closeModal}
                    loading={this.previewState.loading}
                    error={this.previewState.error}
                />
            )}
        </div>
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        const htmlElement = document.getElementById('viewRoCrateSourceButton');
        if (htmlElement) {
            htmlElement.focus();
        }
    }
}