import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { AppStateService } from './state/app-state-service';
import { AppStateProvider, useAppState, useAppStateService } from './state/app-state-react';

function SampleView() {
    const appState = useAppStateService();
    const dirty = useAppState(s => s.dirty);
    const theme = useAppState(s => s.theme);
    const notifCount = useAppState(s => s.notifications.length);

    return (
        <div style={{ padding: '1rem' }}>
            <h2>Sample React Widget with Global AppState</h2>
            <p>Dirty: {dirty ? 'yes' : 'no'}</p>
            <p>Theme: {theme}</p>
            <p>Notifications: {notifCount}</p>

            <button onClick={() => (appState.dirty = !dirty)}>
                Toggle dirty
            </button>
            <button
                onClick={() =>
                    appState.updateState(prev => ({
                        theme: prev.theme === 'light' ? 'dark' : 'light'
                    }))
                }
                style={{ marginLeft: '0.5rem' }}
            >
                Toggle theme
            </button>
            <button
                onClick={() => appState.addNotification('Hello from SampleView')}
                style={{ marginLeft: '0.5rem' }}
            >
                Add notification
            </button>
        </div>
    );
}

@injectable()
export class SampleReactWidget extends ReactWidget {

    static readonly ID = 'theia-app-state-extension:sample-react-widget';
    static readonly LABEL = 'AppState Sample';

    @inject(AppStateService)
    protected readonly appStateService: AppStateService;

    constructor() {
        super();
        this.id = SampleReactWidget.ID;
        this.title.label = SampleReactWidget.LABEL;
        this.title.caption = SampleReactWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-sliders';
    }

    protected render(): React.ReactNode {
        return (
            <AppStateProvider service={this.appStateService}>
                <SampleView />
            </AppStateProvider>
        );
    }
}
