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
exports.TreeviewExampleDecorationService = exports.TreeviewExampleDecorator = void 0;
const core_1 = require("@theia/core");
const browser_1 = require("@theia/core/lib/browser");
const inversify_1 = require("@theia/core/shared/inversify");
exports.TreeviewExampleDecorator = Symbol('TreeviewExampleDecorator');
/**
 * The TreeDecoratorService which manages the TreeDecorator contributions for our tree widget implementation.
 * (Every tree widget has its own TreeDecoratorService instance to manage decorations specifically for that widget.)
 */
let TreeviewExampleDecorationService = class TreeviewExampleDecorationService extends browser_1.AbstractTreeDecoratorService {
    constructor(contributions) {
        super(contributions.getContributions());
        this.contributions = contributions;
    }
};
exports.TreeviewExampleDecorationService = TreeviewExampleDecorationService;
exports.TreeviewExampleDecorationService = TreeviewExampleDecorationService = __decorate([
    (0, inversify_1.injectable)(),
    __param(0, (0, inversify_1.inject)(core_1.ContributionProvider)),
    __param(0, (0, inversify_1.named)(exports.TreeviewExampleDecorator)),
    __metadata("design:paramtypes", [Object])
], TreeviewExampleDecorationService);
//# sourceMappingURL=treeview-example-decoration-service.js.map