---
paths:
  - '**/*.{js,mjs,cjs,ts,mts,cts}'
---

Split failures into **expected errors** and **defects** (invariant violations).

- Expected: input validation failure, resource not found, parse failure, network timeout, malformed markup.
- Defects: a null where a value is required, an impossible code path, an unexpected state. These are not meant to be recovered from.

## Expected Errors

Define a `Schema.TaggedError` in the module that owns the domain, and fail with it in Effect's error channel by yielding it:

```ts
import { Schema } from 'effect';

export class BundleNotFoundError extends Schema.TaggedError<
  BundleNotFoundError,
  { readonly brand: unique symbol }
>()('BundleNotFoundError', { level: Schema.String }) {}

return yield * new BundleNotFoundError({ level });
```

- Handle or propagate errors deliberately; catch by tag (`Effect.catchTag`) at the boundary that can act on them.
- At a Promise-based public API, reject with the error instance and document it with `@throws`.
- Never let an error widen what a caller can see: a failure while redacting or resolving a level leaves content out.

## Defects

For an unexpected condition, halt: `Effect.die` inside Effect code, or `throw new Error(...)` in plain code. Do not model defects as tagged errors.
