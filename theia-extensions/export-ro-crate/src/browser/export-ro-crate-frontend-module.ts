/**
 * Generated using theia-extension-generator
 */
import { ExportRoCrateCommandContribution, ExportRoCrateMenuContribution } from './export-ro-crate-contribution';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';

export default new ContainerModule(bind => {
    // add your contribution bindings here
    bind(CommandContribution).to(ExportRoCrateCommandContribution);
    bind(MenuContribution).to(ExportRoCrateMenuContribution);
});
