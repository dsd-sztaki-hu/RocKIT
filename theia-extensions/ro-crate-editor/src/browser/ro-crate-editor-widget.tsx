import * as React from 'react';
import { injectable } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';

import { DescriboCrateBuilder } from '@arpproject/crate-builder-component-react';
import "@arpproject/crate-builder-component-react/style.css";
import emptyCrate from "../../data/crate.json";
import profile from "../../data/profile.json";

@injectable()
export class RoCrateEditorWidget extends ReactWidget {

    static readonly ID = 'rocrate-editor-widget';

    protected instanceId: string = '';

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

        this.update();
    }

    render(): React.ReactNode {
        return (
            <div style={{ padding: '1rem' }}>
                <h3>Panel ID:</h3>
                <pre>{this.instanceId}</pre>
                <DescriboCrateBuilder
                    crate={emptyCrate}
                    profile={profile}
                    entityId={"./"}
                    onSaveCrate={(saveData: any) => console.log("saveData", saveData)}
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
}
