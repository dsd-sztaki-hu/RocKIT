import * as React from 'react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { Message } from '@theia/core/lib/browser';
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import ReactJson from 'react-json-view';

const RO_CRATE_METADATA_FILE = 'ro-crate-metadata.json';

interface RoCrateModalProps {
    jsonObject: any;
    onClose: () => void;
    loading: boolean;
    error: string | null;
}

// --- Styles ---
const modalOverlayStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'var(--theia-modal-backdrop)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
};

const modalContentStyle: React.CSSProperties = {
    backgroundColor: 'var(--theia-editor-background)',
    color: 'var(--theia-editor-foreground)',
    border: '1px solid var(--theia-widget-shadow)',
    padding: '20px',
    borderRadius: '4px',
    width: '85%',
    maxHeight: '85vh',
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
};

const RoCrateModal: React.FC<RoCrateModalProps> = ({ jsonObject, onClose, loading, error }) => {
    return (
        <div style={modalOverlayStyle}>
            <div style={modalContentStyle}>
                {/* Header */}
                <div style={{ borderBottom: '1px solid var(--theia-tree-indentGuidesStroke)', paddingBottom: '15px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                        RO-Crate source: <span style={{color: '#ce9178'}}>{RO_CRATE_METADATA_FILE}</span>
                    </h3>
                    <i className="fa fa-times" style={{cursor: 'pointer'}} onClick={onClose}></i>
                </div>

                {/* Content */}
                {loading && <div style={{textAlign: 'center', padding: '20px'}}><i className="fa fa-spinner fa-spin"></i> Loading...</div>}

                {error && <AlertMessage type='ERROR' header='Error'>{error}</AlertMessage>}

                {!loading && !error && (
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
                )}

                {/* Footer */}
                <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={onClose} className='theia-button secondary'>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

@injectable()
export class RoCratePreviewWidget extends ReactWidget {

    static readonly ID = 'ro-crate-preview:widget';
    static readonly LABEL = 'RoCratePreview Widget';

    @inject(MessageService)
    protected readonly messageService!: MessageService;

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
        this.title.iconClass = 'fa fa-window-maximize'; // example widget icon.
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
                const parsedJson = JSON.parse(fileContent);
                this.previewState.jsonObject = parsedJson;
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

    protected displayMessage(): void {
        this.messageService.info('Congratulations: RoCratePreview Widget Successfully Created!');
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        const htmlElement = document.getElementById('displayMessageButton');
        if (htmlElement) {
            htmlElement.focus();
        }
    }

}
