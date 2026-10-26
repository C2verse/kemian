# Kemian: instructions for AI agents

Kemian serves one Markdown knowledge base to different audiences over MCP. Private content is marked inline, the bundler builds a redacted bundle per access level, and the server serves each caller only the bundle their credential maps to. Read [docs/design.md](docs/design.md) before any task: it holds the decisions, the open questions, and the milestones.

## Rules

- **The design doc is the source of truth.** When a decision is made or changed, update [docs/design.md](docs/design.md) in the same change. Record only decided facts; leave open questions as `TODO:`.
- **One responsibility per module.** Everything ships in `@kemian/server`, split into modules under `packages/server/src/` that may become packages later. `core` uses no platform or service APIs. Code for a specific service (Cloudflare, GitHub, …) goes in its own module behind an interface defined in `core`. Oxlint enforces which modules may import which.
- **The `protocol` module is the contract.** Change it deliberately: a breaking change increments the protocol version, and every module that reads or writes bundles is updated with it. The generated JSON Schema in `packages/server/schema/` is checked in; regenerate it with `pnpm exec vitest run -u` in `packages/server` only for intended changes.
- **Privacy is structural.** Code that serves a caller receives only that caller's bundle, never the store or source. Redaction fails closed: when in doubt, leave content out.
- **No real personal data in this repo.** Tests and examples use the invented knowledge base in `fixtures/knowledge-base/`.
- **Commit messages** are lowercase sentences, e.g. "add bundle schema".
- **Coding conventions** are in [.claude/rules/](.claude/rules/).

## The author's knowledge base

The first deployment is the author's personal knowledge base, a private repo at `~/projects/mindspace`. You may read it for context: why Kemian exists (`ideas/kemian.md`), the privacy markup spec (`meta/privacy-markup.md`), and the current implementation (`scripts/export-public.mjs`). Follow its `AGENTS.md` while there, and never copy its content into this repo, which is public.

## Tooling

pnpm workspace on Node 24, orchestrated by Nx. Run commands from the repo root:

```bash
pnpm install                                  # also installs Git hooks and patches TypeScript and Oxlint for Effect
pnpm exec nx run-many -t lint typecheck test  # everything; `pnpm check` for short
pnpm exec nx test server                      # one target of one project
pnpm exec nx dev demo                         # run the demo Worker locally (Vite, local R2)
pnpm exec oxfmt                               # format; `--check` to verify only
```

- **TypeScript 7**, patched by `@effect/tsgo` so `tsc` also reports Effect diagnostics. Relative imports use the `.ts` extension.
- **Oxlint** (type-aware) for linting and **Oxfmt** for formatting. Pre-commit hooks (lefthook) run both on staged files.
- **Vitest 5** with `@effect/vitest`. Tests sit next to the code as `*.spec.ts`; shared test data lives in `packages/server/test/`. The demo's end-to-end tests run the Worker in local `workerd` with Wrangler's `createTestHarness`.
- **Worker:** Vite with `@cloudflare/vite-plugin` builds it (`nx build demo`) and Wrangler deploys it (`nx deploy demo`). `nx typecheck demo` generates `worker-configuration.d.ts` with `wrangler types` first. Local secrets go in `apps/demo/.dev.vars`, copied from `.dev.vars.example`.
- **The `kemian` CLI** runs from source during development: `node packages/server/src/bundler/cli.ts check` in a knowledge base folder, e.g. `fixtures/knowledge-base`.
- **CI** (GitHub Actions) runs the format check and `nx affected -t lint typecheck test`.
- **Package build:** `nx build server` bundles the JavaScript with tsdown and emits declarations with `tsc`, since tsdown's declaration plugin needs TypeScript's JS API, which TypeScript 7 doesn't have. Publishing swaps `exports` and `bin` to `dist` through `publishConfig`; `packages/server/test/package.spec.ts` packs the package and checks the result.
- **Release** is manual for now: `pnpm --filter @kemian/server version <x.y.z> --no-git-tag-version`, run all checks, commit "release @kemian/server x.y.z", tag `server@x.y.z`, then `pnpm --filter @kemian/server publish`. `nx release` needs `@nx/js`, which breaks the project graph on TypeScript 7 for the same reason.
