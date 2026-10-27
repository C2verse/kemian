@README.md

## Working Here

- **Everything here is invented.** Never add real personal data, and never copy from the author's knowledge base.
- **Tests depend on this content.** After changing it, update the expected file counts in `apps/demo/test/e2e.spec.ts`, the quoted content in the demo's tests, and the private facts in `packages/server/src/bundler/bundler.spec.ts`; add a distinctive phrase from any new private content to those facts.
- **Keep it realistic.** The demo serves it, so tricky markup cases belong in the bundler's unit tests, not here.
- It isn't formatted or linted: Oxfmt and Oxlint skip `fixtures/**`.
