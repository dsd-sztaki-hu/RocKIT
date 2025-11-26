import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry, MessageService } from '@theia/core/lib/common';
import { CommonMenus,   FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';

export const ReactGrabHelperCommand: Command = {
    id: 'ReactGrabHelper.command',
    label: 'Say Hello'
};

@injectable()
export class ReactGrabHelperCommandContribution implements CommandContribution {
    
    @inject(MessageService)
    protected readonly messageService!: MessageService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(ReactGrabHelperCommand, {
            execute: () => this.messageService.info('Hello WWW!')
        });
    }
}

@injectable()
export class ReactGrabHelperMenuContribution implements MenuContribution {

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.EDIT_FIND, {
            commandId: ReactGrabHelperCommand.id,
            label: ReactGrabHelperCommand.label
        });
    }
}

@injectable()
export class GrabHelperContribution implements FrontendApplicationContribution {

    async onStart(app: FrontendApplication): Promise<void> {
        // Enable only during development (React Grab’s recommended usage)
        debugger;
        if (process.env.NODE_ENV !== 'development') {
            return;
        }

        console.log('[grab-helper] Loading React Grab…');

        // Simple mode: load React Grab. It auto-hooks into the DOM.
        await import('react-grab');

        console.log('[grab-helper] React Grab initialized.');
    }
}