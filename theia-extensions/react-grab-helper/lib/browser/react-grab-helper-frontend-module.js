"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Generated using theia-extension-generator
 */
const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const react_grab_helper_contribution_1 = require("./react-grab-helper-contribution");
exports.default = new inversify_1.ContainerModule(bind => {
    // add your contribution bindings here
    bind(react_grab_helper_contribution_1.GrabHelperContribution).toSelf().inSingletonScope();
    bind(browser_1.FrontendApplicationContribution).toService(react_grab_helper_contribution_1.GrabHelperContribution);
});
//# sourceMappingURL=react-grab-helper-frontend-module.js.map