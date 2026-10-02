# CEDAR to RO-Crate

Converts CEDAR templates to Describo profile data for RocKIT.

This package contains a TypeScript implementation of
`CedarTemplateToDescriboProfileConverter` converted from Java.

The implementation is self-contained and portable. Test resources are included
in the `test-resources/` folder so this package can be moved independently of
the main project.

## Authorship

This package is maintained by SZTAKI, Department of Distributed Systems
(<https://dsd.sztaki.hu>).

Contact: [rockit@dsd.sztaki.hu](mailto:rockit@dsd.sztaki.hu).

The TypeScript converter was ported from the original Java implementation by
Norbert Finta, based on work by Balázs E. Pataki.

## Requirements

- Node.js >= 18.0.0 (for tsx) or Node.js >= 14.17 (for ts-node)
- npm

## Setup

1. Install dependencies:
```
npm install
```

## Running Tests

**Important**: Make sure you're using Node.js >= 18. You can check with `node --version`.

After installing dependencies, run the tests with one of these methods:

### Method 1: Using npm test (recommended)
```bash
npm test
```

### Method 2: Using tsx directly
```bash
npx tsx cedar-converter.test.ts
```

### Method 3: Compile first, then run (if tsx has platform issues)
If you encounter esbuild platform errors (e.g., darwin-x64 vs darwin-arm64), you can compile first:
```bash
# Make sure you're using Node.js >= 18 for compilation
npx tsc
node cedar-converter.test.js
```

### Troubleshooting

**Platform mismatch error**: If you see an error about esbuild platform mismatch (darwin-x64 vs darwin-arm64), this usually means npm was run under Rosetta 2 but Node.js is running natively. Solutions:
1. Reinstall dependencies with the correct Node.js version: `rm -rf node_modules package-lock.json && npm install`
2. Or compile first and run JavaScript (Method 3 above)

**Old Node.js version**: If npm uses an old Node.js version, you may need to:
- Use `npx` with the correct node version
- Or set up a Node version manager (nvm, fnm, etc.)

## Files

- `cedar-converter.ts` - Main converter implementation
- `cedar-converter.test.ts` - Test suite
- `package.json` - Node.js package configuration
- `tsconfig.json` - TypeScript compiler configuration

## Test Resources

The tests use test resources located in the `test-resources/` folder within this directory. These are copies of the Java test resources, making this implementation self-contained and portable.

## License

This package is licensed under the Apache License, Version 2.0. See
[LICENSE.md](./LICENSE.md) for details.

