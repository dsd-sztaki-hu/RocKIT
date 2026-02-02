// src/browser/save-ro-crate-protocol.ts
// Example usage: import { RoCrateHtmlGenerator } from 'aroma2-common/lib/browser';
export const RoCrateHtmlGenerator = Symbol('RoCrateHtmlGenerator')

export interface RoCrateHtmlGenerator {
  generate(data: any): string
}
