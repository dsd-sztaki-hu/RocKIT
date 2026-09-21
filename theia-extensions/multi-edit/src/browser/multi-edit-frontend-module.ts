/**
 * Generated using theia-extension-generator
 */
import { MultiEditCommandContribution, MultiEditMenuContribution } from './multi-edit-contribution';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';
import { MultiEditDialogService } from './multi-edit-dialog-service';

import '../../src/browser/styles/multi-edit-dialog.css';

export default new ContainerModule(bind => {
    // add your contribution bindings here
    bind(MultiEditDialogService).toSelf().inSingletonScope();
    bind(CommandContribution).to(MultiEditCommandContribution);
    bind(MenuContribution).to(MultiEditMenuContribution);
});
