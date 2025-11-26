/**
 * Generated using theia-extension-generator
 */
import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { GrabHelperContribution } from './react-grab-helper-contribution';

export default new ContainerModule(bind => {
    // add your contribution bindings here
    bind(GrabHelperContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(GrabHelperContribution);
});

