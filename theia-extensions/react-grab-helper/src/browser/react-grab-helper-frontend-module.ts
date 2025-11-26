/**
 * Generated using theia-extension-generator
 */
import { ReactGrabHelperCommandContribution, ReactGrabHelperMenuContribution } from './react-grab-helper-contribution';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { GrabHelperContribution } from './react-grab-helper-contribution';

export default new ContainerModule(bind => {
    // add your contribution bindings here
    bind(CommandContribution).to(ReactGrabHelperCommandContribution);
    bind(MenuContribution).to(ReactGrabHelperMenuContribution);
    bind(GrabHelperContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GrabHelperContribution);
});

