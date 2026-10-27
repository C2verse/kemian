---
paths:
  - '**/*.spec.ts'
  - '**/*.spec-helper.ts'
  - '**/test/**'
---

- Put a test next to the code it covers as `<file>.spec.ts`. Test data shared within one module goes in a `*.spec-helper.ts` there; data shared across modules goes in `packages/server/test/`.
- Use `@effect/vitest`: `it.effect` for tests of Effects, plain `it` otherwise. Its `describe`, `expect`, and `it` replace Vitest's.
- Drive behavior through public entry points where practical: the MCP client against `createKemian`, the CLI as a child process, the Worker through Wrangler's `createTestHarness`.
- Never change a test's expected value to make it pass without confirming the new value is correct; the expected value is most likely right.
- Don't widen a privacy assertion. A failing leak check means content is leaking, or the fact wasn't private; decide which before touching it.
- Use only invented data.
