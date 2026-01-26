// A unique symbol used for Dependency Injection
export const RoCrateHtmlGenerator = Symbol('RoCrateHtmlGenerator');

// The Interface (The "Contract")
// Notice: No implementation details here. Just what it does.
export interface RoCrateHtmlGenerator {
    generate(data: any): string;
}