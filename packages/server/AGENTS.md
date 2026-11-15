@README.md

## Layout

- `src/`: the modules, described in its `README.md`.
- `test/`: code shared by several modules' tests (bundles, the `ProposalStore` contract, a fake GitHub, and an HTTP wrapper for handlers), the editing end-to-end test, and the packaging test.
- `schema/`: the protocol's generated JSON Schema, checked in and shipped.
- `tsdown.config.ts` and `tsconfig.build.json`: the package build.

## Exports & Build

- `exports` and `bin` point at `src/` so the workspace runs sources directly; `publishConfig.exports` and `publishConfig.bin` point at `dist/` and replace them when the package is packed. Keep both export maps and the entries in `tsdown.config.ts` listing the same modules.
- `nx build server` runs tsdown for the JavaScript (`dist/<module>/index.js` plus shared chunks), then `tsc -p tsconfig.build.json` for declarations (`dist/types/src/…`), because tsdown's declaration emit needs TypeScript's JavaScript API.
- `test/package.spec.ts` builds, packs, and extracts the package, then checks that every published export exists, imports the entries, and runs the packed CLI. Add a new public module to its import list.
- The CLI runs from source during development: `node packages/server/src/bundler/cli.ts check` in a knowledge base folder.

## Protocol Schema

`schema/*.v1.schema.json` is a file snapshot of the protocol. Regenerate it with `pnpm exec vitest run -u src/protocol` in this folder, only for an intended protocol change, and review the diff.

## Release

Manual for now:

1. `pnpm --filter @kemian/server version <x.y.z> --no-git-tag-version`.
2. Run every check: `pnpm exec nx run-many -t lint typecheck test build`.
3. Pack with `pnpm pack`, install the tarball into an empty folder with npm, and run `npx kemian --version` there. The packaging test reuses the workspace's `node_modules`, so only a fresh install catches a dependency range that resolves differently outside the lockfile.
4. Commit "release @kemian/server x.y.z" and tag `server@x.y.z`.
5. `pnpm --filter @kemian/server publish`, which applies `publishConfig`.
