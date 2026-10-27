@README.md

## Changing Modules

Adding a module, or changing which modules one may import, touches every place that lists modules. Update them together:

1. `.oxlintrc.json`: the `no-restricted-imports` override of every module, so each lists every other module as forbidden except the ones it may import through `index.ts`.
2. For a public module, `packages/server/package.json` (`exports` and `publishConfig.exports`), `packages/server/tsdown.config.ts` (`entry`), and the import list in `packages/server/test/package.spec.ts`.
3. The module map and table in this `README.md`.
4. For a new module, its own `README.md`, `AGENTS.md`, and `CLAUDE.md`.

## Working Across Modules

- A module imports another only through its `index.ts`; whatever `index.ts` doesn't re-export is private to the module.
- Exported entry points for deployers stay plain TypeScript with Promises. Effect stays inside, where failures branch.
- A module's dependencies on npm packages are its own business, but every package's version is exact and listed in `packages/server/package.json`.
