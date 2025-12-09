import * as React from 'react';
import { inject, injectable } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';



import { DescriboCrateBuilder } from '@arpproject/recrate';
import "@arpproject/recrate/style.css";

import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import type { Disposable } from '@theia/core';

@injectable()
export class RoCrateEditorWidget extends ReactWidget {

    static readonly ID = 'rocrate-editor-widget';

    protected instanceId: string = '';

    @inject(AppStateService)
    protected readonly appStateService: AppStateService;

    protected crateSubscription?: Disposable;
    protected profileSubscription?: Disposable;

    constructor() {
        super();
        this.addClass('rocrate-editor');
        this.title.closable = true;
    }

    initialize(options: any = {}): void {
        this.instanceId =
            options.instanceId ??
            `${RoCrateEditorWidget.ID}:${Math.random().toString(36).substring(2)}`;

        this.id = this.instanceId;
        this.title.label = `Editor ${this.instanceId}`;

        this.crateSubscription = this.appStateService.onDidChangeSelector((s) => s.roCrate)((_) => this.update());
        this.profileSubscription = this.appStateService.onDidChangeSelector((s) => s.profile)((_) => this.update());

        this.update();
    }

    protected handleSaveCrate = (saveData: any) => {
        console.log("saveData", saveData);
        const crate = saveData && (saveData as any).crate ? (saveData as any).crate : saveData;
        this.appStateService.roCrate = crate;
    }

    render(): React.ReactNode {
        const crateToUse = this.appStateService.roCrate;
        const profileToUse = this.appStateService.profile;
        return (
            <div style={{ padding: '1rem' }}>
                <h3>Panel ID:</h3>
                <pre>{this.instanceId}</pre>
                <DescriboCrateBuilder
                    crate={crateToUse}
                    profile={profileToUse}
                    entityId={"./"}
                    onSaveCrate={this.handleSaveCrate}
                    onNavigation={(entity: any) => console.log("entity", entity)}
                    onWarning={(w: any) => console.log("warning", w)}
                    onError={(e: any) => console.log("error", e)}
                    enableReverseLinkBrowser={false}
                    enableBrowseEntities={false}
                    enableUrlMarkup={false}
                    language={"en"}
                    readonly={false}
                    tabLocation={"left"}
                    showControls={false}
                    resetTabOnEntityChange={false}
                    resetTabOnProfileChange={false}
                />
            </div>
        );
    }

    dispose(): void {
        super.dispose();
        this.crateSubscription?.dispose();
        this.profileSubscription?.dispose();
    }
}
