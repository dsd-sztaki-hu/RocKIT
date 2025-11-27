"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var RoCrateEditorWidget_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoCrateEditorWidget = void 0;
const React = require("react");
const inversify_1 = require("inversify");
const react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
const ro_crate_editor_message_service_1 = require("./ro-crate-editor-message-service");
const RoCrateEditorComponent = ({ instanceId, messageService }) => {
    const [messages, setMessages] = React.useState([]);
    const [newMessage, setNewMessage] = React.useState('');
    React.useEffect(() => {
        // Listen for messages from other widgets
        const messageListener = messageService.onMessage(message => {
            // Don't display messages from this same widget instance
            if (message.senderId !== instanceId) {
                setMessages(prevMessages => [...prevMessages, message]);
            }
        });
        return () => {
            messageListener.dispose();
        };
    }, [instanceId, messageService]);
    const sendMessage = () => {
        if (newMessage.trim()) {
            messageService.sendMessage(instanceId, newMessage);
            setNewMessage('');
        }
    };
    const handleMessageChange = (event) => {
        setNewMessage(event.target.value);
    };
    return (React.createElement("div", { style: { padding: '1rem', height: '100%', display: 'flex', flexDirection: 'column' } },
        React.createElement("h3", null, "Panel ID:"),
        React.createElement("pre", null, instanceId),
        React.createElement("div", { style: { marginBottom: '1rem' } },
            React.createElement("input", { type: "text", value: newMessage, onChange: handleMessageChange, placeholder: "Type a message...", style: { marginRight: '0.5rem', padding: '0.25rem' } }),
            React.createElement("button", { onClick: sendMessage }, "Send message")),
        React.createElement("div", { style: { flex: 1, overflow: 'auto', border: '1px solid #ccc', padding: '0.5rem' } },
            React.createElement("h4", null, "Messages:"),
            messages.length === 0 ? (React.createElement("p", null, "No messages yet")) : (React.createElement("ul", { style: { listStyleType: 'none', padding: 0 } }, messages.map((message, index) => (React.createElement("li", { key: index, style: { marginBottom: '0.5rem', padding: '0.5rem', backgroundColor: '#f5f5f5', borderRadius: '4px' } },
                React.createElement("strong", null,
                    "From ",
                    message.senderId,
                    ":"),
                " ",
                message.text,
                React.createElement("br", null),
                React.createElement("small", null, message.timestamp.toLocaleTimeString())))))))));
};
let RoCrateEditorWidget = RoCrateEditorWidget_1 = class RoCrateEditorWidget extends react_widget_1.ReactWidget {
    constructor(messageService) {
        super();
        this.messageService = messageService;
        this.instanceId = '';
        this.addClass('rocrate-editor');
        this.title.closable = true;
    }
    initialize(options = {}) {
        var _a;
        this.instanceId =
            (_a = options.instanceId) !== null && _a !== void 0 ? _a : `${RoCrateEditorWidget_1.ID}:${Math.random().toString(36).substring(2)}`;
        this.id = this.instanceId;
        this.title.label = `Editor ${this.instanceId}`;
        this.update();
    }
    render() {
        return React.createElement(RoCrateEditorComponent, { instanceId: this.instanceId, messageService: this.messageService });
    }
};
exports.RoCrateEditorWidget = RoCrateEditorWidget;
RoCrateEditorWidget.ID = 'rocrate-editor-widget';
exports.RoCrateEditorWidget = RoCrateEditorWidget = RoCrateEditorWidget_1 = __decorate([
    (0, inversify_1.injectable)(),
    __param(0, (0, inversify_1.inject)(ro_crate_editor_message_service_1.RoCrateEditorMessageService)),
    __metadata("design:paramtypes", [ro_crate_editor_message_service_1.RoCrateEditorMessageService])
], RoCrateEditorWidget);
//# sourceMappingURL=ro-crate-editor-widget.js.map