import { Emitter, Event } from '@theia/core/lib/common';
export interface RoCrateEditorMessage {
    senderId: string;
    text: string;
    timestamp: Date;
}
/**
 * Service for managing messages between RO-Crate Editor widget instances.
 * This service allows widgets to send messages to all other instances.
 */
export declare class RoCrateEditorMessageService {
    protected readonly onMessageEmitter: Emitter<RoCrateEditorMessage>;
    /**
     * Event that fires when a new message is received.
     */
    readonly onMessage: Event<RoCrateEditorMessage>;
    /**
     * Send a message to all other widget instances.
     *
     * @param senderId The ID of the widget sending the message
     * @param text The message content
     */
    sendMessage(senderId: string, text: string): void;
}
//# sourceMappingURL=ro-crate-editor-message-service.d.ts.map