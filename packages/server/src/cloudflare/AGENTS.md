@README.md

## Working Here

- **`oauth.ts` only runs in `workerd`:** the OAuth provider imports `cloudflare:workers`. Node tests import specific files, such as `bundle-store.r2.ts`, never this module's `index.ts`. Cover sign-in in the demo's end-to-end tests: unit tests would have to mock the provider's helpers, and would only restate the code.
- **Workers types aren't in this package's tsconfig.** Annotate handler parameters explicitly, and run `pnpm exec nx typecheck demo` after a change: the demo compiles this module against the real Workers types.
- **Keep the routing table true.** `/publish` never goes through the OAuth server; anonymous `/mcp` requests skip it; `isSignInRequested` decides the rest.
- **The consent page escapes everything a client provides** (name, domain, redirect host): those come from dynamic registration, chosen by whoever registers.
- **Grant user IDs use `.`**, as in `github.12345`, because the OAuth provider reserves `:`.
- Options are built once per environment in `kemian()`; don't read `env` per request elsewhere.
