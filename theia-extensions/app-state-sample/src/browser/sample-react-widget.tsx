import * as React from 'react';
import { injectable, inject } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { AppStateProvider, useAppState, useAppStateService } from 'app-state/lib/browser/state/app-state-react';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { AppState } from 'app-state/lib/browser/state/app-state';

function SampleView() {
    const service = useAppStateService();
    const dirty = useAppState((s: AppState) => s.dirty);
    const theme = useAppState((s: AppState) => s.theme);
    const notifCount = useAppState((s: AppState) => s.notifications.length);
    const settings = useAppState((s: AppState) => s.settings);

    return (
        <div style={{ padding: '1rem' }}>
            <h2>Sample React Widget with Global AppState</h2>
            <p>Dirty: {dirty ? 'yes' : 'no'}</p>
            <p>Theme: {theme}</p>
            <p>Notifications: {notifCount}</p>
            <p>Settings: autoSave={settings.autoSave ? 'on' : 'off'}, fontSize={settings.fontSize}</p>

            <button onClick={() => (service.dirty = !dirty)}>
                Toggle dirty
            </button>
            <button
                onClick={() =>
                    service.updateState(prev => ({
                        theme: prev.theme === 'light' ? 'dark' : 'light'
                    }))
                }
                style={{ marginLeft: '0.5rem' }}
            >
                Toggle theme
            </button>
            <button
                onClick={() => service.addNotification('Hello from SampleView')}
                style={{ marginLeft: '0.5rem' }}
            >
                Add notification
            </button>
            <button
                onClick={() =>
                    service.updateState(prev => ({
                        settings: { ...prev.settings, autoSave: !prev.settings.autoSave }
                    }))
                }
                style={{ marginLeft: '0.5rem' }}
            >
                Toggle autoSave
            </button>
            <button
                onClick={() =>
                    service.updateState(prev => ({
                        settings: { ...prev.settings, fontSize: prev.settings.fontSize + 1 }
                    }))
                }
                style={{ marginLeft: '0.5rem' }}
            >
                Font +1
            </button>
        </div>
    );
}

@injectable()
export class SampleReactWidget extends ReactWidget {

    static readonly ID = 'theia-app-state-sample:sample-react-widget';
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
        this.update();
    }

    protected render(): React.ReactNode {
        return (
            <AppStateProvider service={this.appStateService}>
                <SampleView />
            </AppStateProvider>
        );
    }
}
