// src/browser/save-ro-crate-protocol.ts

export const RoCrateHtmlGenerator = Symbol('RoCrateHtmlGenerator')

export interface RoCrateHtmlGenerator {
  generate(data: any): string
}
