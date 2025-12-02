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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoCrateEditorContribution = exports.OpenRoCrateEditorCommand = void 0;
const inversify_1 = require("inversify");
const browser_1 = require("@theia/core/lib/browser");
const ro_crate_editor_widget_1 = require("./ro-crate-editor-widget");
exports.OpenRoCrateEditorCommand = {
    id: 'rocrate.openEditor',
    label: 'Open New RO-Crate Editor'
};
let RoCrateEditorContribution = class RoCrateEditorContribution extends browser_1.AbstractViewContribution {
    constructor(widgetManager, shell) {
        super({
            widgetId: ro_crate_editor_widget_1.RoCrateEditorWidget.ID,
            widgetName: 'RO-Crate Editor',
            defaultWidgetOptions: { area: 'main' }
        });
        this.widgetManager = widgetManager;
        this.shell = shell;
    }
    registerCommands(registry) {
        registry.registerCommand(exports.OpenRoCrateEditorCommand, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(ro_crate_editor_widget_1.RoCrateEditorWidget.ID, {
                    instance: Math.random().toString()
                });
                this.shell.addWidget(widget, { area: 'main' });
                this.shell.activateWidget(widget.id);
            }
        });
    }
    registerMenus(menus) {
        menus.registerMenuAction(browser_1.CommonMenus.VIEW, {
            commandId: exports.OpenRoCrateEditorCommand.id,
            label: exports.OpenRoCrateEditorCommand.label
        });
    }
};
exports.RoCrateEditorContribution = RoCrateEditorContribution;
exports.RoCrateEditorContribution = RoCrateEditorContribution = __decorate([
    (0, inversify_1.injectable)(),
    __param(0, (0, inversify_1.inject)(browser_1.WidgetManager)),
    __param(1, (0, inversify_1.inject)(browser_1.ApplicationShell)),
    __metadata("design:paramtypes", [browser_1.WidgetManager,
        browser_1.ApplicationShell])
], RoCrateEditorContribution);
//# sourceMappingURL=ro-crate-editor-contribution.js.map