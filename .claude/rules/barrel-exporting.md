---
paths:
  - '**/index.ts'
---

For re-exports in barrel files:

- Use `export *` instead of named exports.
- Everything internal should live in a separate file and not appear in the barrel file.
- Ordering is enforced automatically by Oxfmt's import sorting — do not hand-order.

A module's barrel (`index.ts`) is its public surface: it is what other modules and consumers import, so a symbol appears here only when it is meant to be public.
