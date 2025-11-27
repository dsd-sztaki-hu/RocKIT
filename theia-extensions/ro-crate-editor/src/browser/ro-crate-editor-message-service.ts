import { injectable } from 'inversify';
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
@injectable()
export class RoCrateEditorMessageService {
    
    protected readonly onMessageEmitter = new Emitter<RoCrateEditorMessage>();
    
    /**
     * Event that fires when a new message is received.
     */
    readonly onMessage: Event<RoCrateEditorMessage> = this.onMessageEmitter.event;
    
    /**
     * Send a message to all other widget instances.
     * 
     * @param senderId The ID of the widget sending the message
     * @param text The message content
     */
    sendMessage(senderId: string, text: string): void {
        const message: RoCrateEditorMessage = {
            senderId,
            text,
            timestamp: new Date()
        };
        
        // Emit the message to all listeners
        this.onMessageEmitter.fire(message);
    }
}