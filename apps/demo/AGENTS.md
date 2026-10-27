@README.md

## Working Here

- **Regenerate the Worker's types** after changing `wrangler.jsonc`: `pnpm exec nx typecheck demo` runs `wrangler types --strict-vars=false` first. `worker-configuration.d.ts` is generated and ignored by Git.
- **Declare every secret** in `wrangler.jsonc`'s `secrets.required`, so the types include it without a `.dev.vars` file, as in CI; add it to `.dev.vars.example` too.
- **Keep `src/index.ts` short and copyable.** It's the template-to-be: deployment logic belongs in `@kemian/server`, not here.
- **Test new Worker behavior here, end to end.** The harness exposes a real URL: drive it with `fetch`, the MCP client, or the CLI. Storage persists across tests within a file, so order tests that publish.
- `src/index.ts` is the one file where a default export is allowed.
