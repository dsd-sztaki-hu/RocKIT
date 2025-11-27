"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const ro_crate_editor_widget_1 = require("./ro-crate-editor-widget");
const ro_crate_editor_contribution_1 = require("./ro-crate-editor-contribution");
const ro_crate_editor_message_service_1 = require("./ro-crate-editor-message-service");
require("../../src/browser/style/index.css");
exports.default = new inversify_1.ContainerModule(bind => {
    bind(ro_crate_editor_widget_1.RoCrateEditorWidget).toSelf();
    bind(ro_crate_editor_message_service_1.RoCrateEditorMessageService).toSelf().inSingletonScope();
    (0, browser_1.bindViewContribution)(bind, ro_crate_editor_contribution_1.RoCrateEditorContribution);
    bind(browser_1.WidgetFactory).toDynamicValue(ctx => ({
        id: ro_crate_editor_widget_1.RoCrateEditorWidget.ID,
        createWidget: (options) => {
            const widget = ctx.container.get(ro_crate_editor_widget_1.RoCrateEditorWidget);
            widget.initialize(options);
            return widget;
        }
    })).inSingletonScope();
});
//# sourceMappingURL=ro-crate-editor-frontend-module.js.map