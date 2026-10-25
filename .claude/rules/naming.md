Name symbols clearly enough that they need no explanatory comment. The more specific a symbol, the longer and more descriptive its name should be.

## Functions & Methods

Use `<verb><subject><modifier>`. Prefer "Returns" for functions that compute a value. Examples: `buildBundle`, `buildBundleForLevel`, `loadConfigOrFailIfMissing`, `resolveLevelWithFallback`.

## Variables & Properties

Use `<is/num?><subject><modifier>`, with the subject first so related names sort together:

```ts
const filesExisting = ...
const filesNew = ...
const levelsSampled = ...
const levelsTotal = ...
```

Optionally prefix for type clarity: `is` for booleans (`isPublic`, `isEmpty`), `num` for counts (`numFiles`, `numRetries`).

## Files & Directories

`kebab-case` for both, except a module exporting a single symbol, which may take that symbol's name (`camelCase` or `PascalCase`).

Put the subject first so related files group when sorted: `bundle-build.ts`, `bundle-builder.ts` — not `build-bundle.ts`, `bundle-builder.ts`.
