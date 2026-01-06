// src/browser/types.ts

export interface SchemaInfo {
    name: string;
    source: 'local' | 'remote';
    version: string;
    reference: string;
    path: string;
}