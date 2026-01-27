# Aroma 2 Common Extension

This extension serves as the **shared API and Protocol layer** for the Aroma 2 application. It contains pure interfaces, type definitions, and dependency injection tokens (Symbols) that are shared across multiple functional extensions.

## Purpose & Architecture

The primary goal of `aroma2-common` is to **prevent circular dependencies** and enforce the **Dependency Inversion Principle**.

In a modular Theia based application, functional extensions (like *Editors* or *State Managers*) often need to interact. Direct imports between them often lead to "Death Loops" (Circular Dependencies) where Extension A needs B, and B needs A, preventing the build system from finding a starting point.

This extension acts as the **"Contract" layer**:
1.  **No Logic:** It contains minimal to no runtime logic.
2.  **No Heavy Dependencies:** It sits at the bottom of the dependency graph.
3.  **Shared Definitions:** It allows *Consumers* (e.g., Core extensions) and *Providers* (e.g., Feature extensions) to agree on an interface without importing each other

## Usage

### 1. Defining a Protocol (in "aroma2-common")

When you need to share functionality, define the interface and a unique Symbol here.

```typescript
// src/browser/my-service-protocol.ts

export const IMySharedService = Symbol('IMySharedService');

export interface IMySharedService {
    doSomething(input: string): void;
}
```

### 2. Consuming the Service (e.g., in "app-state")

Extensions that need to use the functionality simply import the interface from this common package. They do not need to know which extension actually implements it.

```typescript
import { inject } from '@theia/core/shared/inversify';
import { IMySharedService } from 'aroma2-common/lib/browser';

export class MyConsumerWidget {
    @inject(IMySharedService)
    protected readonly myService: IMySharedService;

    protected execute() {
        this.myService.doSomething("Hello World");
    }
}
```

### 3. Providing the Implementation (e.g., in a Feature Extension)

The extension that actually contains the logic implements the interface and binds it to the Symbol.

```typescript
import { injectable } from '@theia/core/shared/inversify';
import { IMySharedService } from 'aroma2-common/lib/browser';

@injectable()
export class MyServiceImpl implements IMySharedService {
    doSomething(input: string): void {
        console.log("Implementation executed:", input);
    }
}
```

### Binding in Frontend Module:

```typescript
// my-feature-frontend-module.ts
bind(IMySharedService).to(MyServiceImpl).inSingletonScope();
```