/**
 * TypeScript test file for CedarTemplateToDescriboProfileConverter
 * Rewritten from CedarTemplateToDescriboProfileConverterTest.java
 * 
 * Run with: npm test
 * or: npx tsx cedar-converter.test.ts
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CedarTemplateToDescriboProfileConverter } from './cedar-converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Deep equality check that handles object key order differences
function deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return false;
    if (typeof obj1 !== typeof obj2) return false;
    
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
        if (obj1.length !== obj2.length) return false;
        return obj1.every((val, idx) => deepEqual(val, obj2[idx]));
    }
    
    if (typeof obj1 === 'object') {
        const keys1 = Object.keys(obj1).sort();
        const keys2 = Object.keys(obj2).sort();
        if (keys1.length !== keys2.length) return false;
        if (!keys1.every(key => keys2.includes(key))) return false;
        return keys1.every(key => deepEqual(obj1[key], obj2[key]));
    }
    
    return obj1 === obj2;
}

// Simple assertion function for testing
function assertEquals(actual: string, expected: string, message?: string): void {
    // Normalize JSON strings by parsing and re-stringifying to handle formatting differences
    const actualObj = JSON.parse(actual);
    const expectedObj = JSON.parse(expected);
    
    if (!deepEqual(actualObj, expectedObj)) {
        const errorMsg = message || 'Values are not equal';
        console.error(`\n${errorMsg}`);
        console.error('Expected:');
        console.error(JSON.stringify(expectedObj, null, 2));
        console.error('\nActual:');
        console.error(JSON.stringify(actualObj, null, 2));
        throw new Error(`${errorMsg}\nExpected and actual values do not match`);
    }
}

// Helper function to read test resource files
function readTestResource(relativePath: string): string {
    // Read from local test-resources folder (self-contained)
    const fullPath = join(__dirname, 'test-resources', relativePath);
    return readFileSync(fullPath, 'utf-8');
}

// Test suite
function runTests(): void {
    console.log('Running CedarTemplateToDescriboProfileConverter tests...\n');

    let testsPassed = 0;
    let testsFailed = 0;

    function runTest(testName: string, testFn: () => void): void {
        try {
            testFn();
            console.log(`✓ ${testName}`);
            testsPassed++;
        } catch (error) {
            console.error(`✗ ${testName}`);
            console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
            testsFailed++;
        }
    }

    // Test: Text Type Hungarian
    runTest('testTextTypeHun', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('hu');
        const cedarTemplate = readTestResource('textTypeCedarTemplate.json');
        const expectedProfile = readTestResource('textTypeDescriboProfile_hu.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'Text type Hungarian test failed');
    });

    // Test: Text Type English
    runTest('testTextTypeEn', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('en');
        const cedarTemplate = readTestResource('textTypeCedarTemplate.json');
        const expectedProfile = readTestResource('textTypeDescriboProfile_en.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'Text type English test failed');
    });

    // Test: TextArea Type Hungarian
    runTest('testTextAreaTypeHun', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('hu');
        const cedarTemplate = readTestResource('textAreaTypeCedarTemplate.json');
        const expectedProfile = readTestResource('textAreaTypeDescriboProfile_hu.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'TextArea type Hungarian test failed');
    });

    // Test: TextArea Type English
    runTest('testTextAreaTypeEn', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('en');
        const cedarTemplate = readTestResource('textAreaTypeCedarTemplate.json');
        const expectedProfile = readTestResource('textAreaTypeDescriboProfile_en.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'TextArea type English test failed');
    });

    // Test: Number Type Hungarian
    runTest('testNumberTypeHun', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('hu');
        const cedarTemplate = readTestResource('numberTypeCedarTemplate.json');
        const expectedProfile = readTestResource('numberTypeDescriboProfile_hu.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'Number type Hungarian test failed');
    });

    // Test: Number Type English
    runTest('testNumberTypeEn', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('en');
        const cedarTemplate = readTestResource('numberTypeCedarTemplate.json');
        const expectedProfile = readTestResource('numberTypeDescriboProfile_en.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'Number type English test failed');
    });

    // Test: Date Type Hungarian
    runTest('testDateTypeHun', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('hu');
        const cedarTemplate = readTestResource('dateTypeCedarTemplate.json');
        const expectedProfile = readTestResource('dateTypeDescriboProfile_hu.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'Date type Hungarian test failed');
    });

    // Test: Date Type English
    runTest('testDateTypeEn', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('en');
        const cedarTemplate = readTestResource('dateTypeCedarTemplate.json');
        const expectedProfile = readTestResource('dateTypeDescriboProfile_en.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'Date type English test failed');
    });

    // Test: URL Type Hungarian
    runTest('testUrlTypeHun', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('hu');
        const cedarTemplate = readTestResource('urlTypeCedarTemplate.json');
        const expectedProfile = readTestResource('urlTypeDescriboProfile_hu.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'URL type Hungarian test failed');
    });

    // Test: URL Type English
    runTest('testUrlTypeEn', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('en');
        const cedarTemplate = readTestResource('urlTypeCedarTemplate.json');
        const expectedProfile = readTestResource('urlTypeDescriboProfile_en.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'URL type English test failed');
    });

    // Test: List Type Hungarian
    runTest('testListTypeHun', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('hu');
        const cedarTemplate = readTestResource('listTypeCedarTemplate.json');
        const expectedProfile = readTestResource('listTypeDescriboProfile_hu.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'List type Hungarian test failed');
    });

    // Test: List Type English
    runTest('testListTypeEn', () => {
        const converter = new CedarTemplateToDescriboProfileConverter('en');
        const cedarTemplate = readTestResource('listTypeCedarTemplate.json');
        const expectedProfile = readTestResource('listTypeDescriboProfile_en.json');
        const generatedProfile = converter.processCedarTemplate(cedarTemplate);
        assertEquals(generatedProfile, expectedProfile, 'List type English test failed');
    });

    // Print summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}`);
    console.log(`Total tests: ${testsPassed + testsFailed}`);
    console.log(`${'='.repeat(50)}\n`);

    if (testsFailed > 0) {
        process.exit(1);
    }
}

// Run tests when this file is executed
// Usage: npm test
// or: npx tsx cedar-converter.test.ts
// or compile and run: tsc && node cedar-converter.test.js
runTests();

export { runTests, assertEquals, readTestResource };

