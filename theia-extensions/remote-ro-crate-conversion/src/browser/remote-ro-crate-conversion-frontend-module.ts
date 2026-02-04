/**
 * Generated using theia-extension-generator
 */
import { RemoteRoCrateConversionCommandContribution, RemoteRoCrateConversionMenuContribution } from './remote-ro-crate-conversion-contribution';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';

export default new ContainerModule(bind => {
    // add your contribution bindings here
    bind(CommandContribution).to(RemoteRoCrateConversionCommandContribution);
    bind(MenuContribution).to(RemoteRoCrateConversionMenuContribution);
});
