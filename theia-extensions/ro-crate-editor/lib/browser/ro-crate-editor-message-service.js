"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoCrateEditorMessageService = void 0;
const inversify_1 = require("inversify");
const common_1 = require("@theia/core/lib/common");
/**
 * Service for managing messages between RO-Crate Editor widget instances.
 * This service allows widgets to send messages to all other instances.
 */
let RoCrateEditorMessageService = class RoCrateEditorMessageService {
    constructor() {
        this.onMessageEmitter = new common_1.Emitter();
        /**
         * Event that fires when a new message is received.
         */
        this.onMessage = this.onMessageEmitter.event;
    }
    /**
     * Send a message to all other widget instances.
     *
     * @param senderId The ID of the widget sending the message
     * @param text The message content
     */
    sendMessage(senderId, text) {
        const message = {
            senderId,
            text,
            timestamp: new Date()
        };
        // Emit the message to all listeners
        this.onMessageEmitter.fire(message);
    }
};
exports.RoCrateEditorMessageService = RoCrateEditorMessageService;
exports.RoCrateEditorMessageService = RoCrateEditorMessageService = __decorate([
    (0, inversify_1.injectable)()
], RoCrateEditorMessageService);
//# sourceMappingURL=ro-crate-editor-message-service.js.map