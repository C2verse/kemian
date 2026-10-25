---
paths:
  - '**/*.{js,mjs,cjs,ts,mts,cts}'
---

## Baseline

- Avoid the `any` type and type casting in ordinary code; type-level code (generic gymnastics) may need them.
- Handle edge cases, error conditions, and intermediate states: write robust code.

## Function Arguments

Arguments follow one of these shapes:

1. No arguments.
2. Named arguments via a single object parameter.
3. Up to 3 positional arguments.
4. Up to 2 positional arguments followed by a single object parameter.

Use positional arguments only for required parameters essential to the operation; use a named-argument object for optional or numerous parameters. When unsure, prefer the named-argument object.

**No boolean positionals** — they obscure meaning at the call site. Instead, pass a named argument when the flag is incidental, or split into two descriptively-named functions when it is a core aspect. Class constructors are exempt and may take many positional arguments.

## Control Flow

- **Early return** — handle validations and edge cases first, keeping the main logic shallow.
- **Early failure** — on an unexpected condition, fail rather than silently returning or proceeding.
- **Single level of abstraction** — every statement in a function operates at the same conceptual level.
- **Exhaustive branching** — when switching over a finite set, handle every case and fail on the impossible branch so a new case surfaces as a failure rather than silently falling through.

## Classes

Order members: private static properties, public static properties, public static methods, private static methods, private instance properties, public instance properties, constructor, public instance methods, private instance methods.

Prefer the ES2022 `#` syntax for private members.

## Exports

- Prefer named exports over default exports. Config files and Worker entry points that require a default export are exempt.
- Export symbols right at their declaration.

## Imports

- Use the `.ts` extension in relative imports.
- Import from another module of a package only through its `index.ts`; Oxlint enforces the allowed directions.

## Effect

- Effect is an implementation detail: public APIs take plain objects and return Promises, so consumers never need Effect.
- Prefer `Effect.gen` for sequential logic, and services with layers for anything a test or deployment may swap.

## Self-Documenting Code

Prefer additional well-named variables and functions over comments to clarify intent.
