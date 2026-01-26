export const RoCrateHtmlGenerator = Symbol('RoCrateHtmlGenerator');


export interface RoCrateHtmlGenerator {
    generate(data: any): string;
}