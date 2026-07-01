---
name: Library versions
description: CJS-compatible version pins for packages that went ESM-only in newer major versions.
---

## ESM-only problem

When installing the latest versions of these packages, `ts-node` (which runs CommonJS) cannot import them because they lack a CJS build:

| Package   | ESM-only from | CJS-safe version |
|-----------|---------------|------------------|
| `got`     | v13+          | `got@12`         |
| `p-limit` | v4+           | `p-limit@5`      |
| `date-fns`| v4+           | `date-fns@3`     |

The runtime `require()` call may appear to succeed (Node resolves the package via conditional exports), but TypeScript compilation fails with "Cannot find module" or overload errors.

**How to apply:** When adding or updating these packages, pin to the CJS-safe version listed above unless the project is migrated to native ESM (module: NodeNext in tsconfig + ts-node --esm flag).

**Why:** ts-node in CommonJS mode (module: "CommonJS" in tsconfig) cannot handle pure-ESM packages at compile time. The project uses CommonJS because all other dependencies and the existing codebase are CJS.
