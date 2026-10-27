pnpm workspace on Node 24, orchestrated by Nx. Run commands from the repository root:

```bash
pnpm install                                        # also installs Git hooks and patches TypeScript and Oxlint for Effect
pnpm exec nx run-many -t lint typecheck test build  # everything CI runs; `pnpm check` skips build
pnpm exec nx test server                            # one target of one project
pnpm exec oxfmt                                     # format; `--check` to verify only
```

- **TypeScript 7** (the native compiler), patched by `@effect/tsgo` on install so `tsc` also reports Effect diagnostics. TypeScript 7 has no JavaScript API, so tools that need one (tsdown's declaration emit, `@nx/js`) can't be used; don't install `@nx/js`, which breaks the Nx project graph.
- **Oxlint** (type-aware) lints and **Oxfmt** formats. lefthook runs both on staged files before each commit. Oxfmt skips `fixtures/**` and the generated `packages/*/schema/**`.
- **Module boundaries live in `.oxlintrc.json`**: one `no-restricted-imports` override per module of `packages/server/src`, listing every other module as forbidden except the ones it may import through their `index.ts`. When a module is added, or the modules it may import change, update every override and keep them mirroring the module graph.
- **pnpm 12** blocks install scripts and too-recent releases by default. A dependency whose install script must run goes under `allowBuilds` in `pnpm-workspace.yaml`; pnpm adds `minimumReleaseAgeExclude` entries itself when an exact recent version is requested.
- **Versions are exact** (`--save-exact`). `effect` packages stay on one version together.
- **CI** (`.github/workflows/ci.yml`) runs the format check and `nx affected -t lint typecheck test build`.
