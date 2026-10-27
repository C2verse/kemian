# Demo

A Kemian Worker that serves the invented fixture knowledge base, used to try Kemian and to test it end to end. It's the starting point for the deployment template.

## Running Locally

```sh
cp apps/demo/.dev.vars.example apps/demo/.dev.vars   # once
pnpm exec nx dev demo                                # Vite with local R2 and KV, on http://localhost:5173
```

Then publish the fixture to it from `fixtures/knowledge-base`:

```sh
KEMIAN_PUBLISH_TOKEN=local-publish-token node ../../packages/server/src/bundler/cli.ts publish --url http://localhost:5173
```

and point an MCP client at `http://localhost:5173/mcp`.

## Configuration

| Name                                     | Kind         | Purpose                                                                        |
| ---------------------------------------- | ------------ | ------------------------------------------------------------------------------ |
| `BUNDLES`                                | R2 bucket    | Published bundle sets                                                          |
| `OAUTH_KV`                               | KV namespace | OAuth clients, grants, and tokens                                              |
| `KEMIAN_PUBLISH_TOKEN`                   | secret       | Token `kemian publish` must send                                               |
| `GITHUB_CLIENT_ID`                       | variable     | The GitHub OAuth app; sign-in is off while it's empty                          |
| `GITHUB_CLIENT_SECRET`                   | secret       | The GitHub OAuth app's secret                                                  |
| `PRIVATE_IDENTITIES`                     | variable     | Comma-separated identities allowed into the private level, e.g. `github:12345` |
| `GITHUB_BASE_URL`, `GITHUB_API_BASE_URL` | variables    | GitHub's URLs; the tests point them at a fake                                  |

## Deploying

1. `npx wrangler login`.
2. `pnpm exec nx deploy demo`, which builds with Vite and deploys with Wrangler. If Wrangler doesn't create the R2 bucket and KV namespace itself, create them with `npx wrangler r2 bucket create kemian-demo-bundles` and `npx wrangler kv namespace create OAUTH_KV`, and add the namespace's ID to `wrangler.jsonc`.
3. `npx wrangler secret put KEMIAN_PUBLISH_TOKEN` in `apps/demo`, then publish the fixture with `--url https://<worker>`.
4. For sign-in, create a GitHub OAuth app with the callback URL `https://<worker>/callback`, set `GITHUB_CLIENT_ID` and `PRIVATE_IDENTITIES`, and put `GITHUB_CLIENT_SECRET` as a secret.

## Tests

- `test/e2e.spec.ts`: publishing the fixture with the real CLI, anonymous MCP access, 2025-era clients, republishing, and CORS.
- `test/sign-in.spec.ts`: the whole OAuth flow against a fake GitHub: consent, the GitHub redirect with PKCE, the callback, the token, the private level, and refusals.

Both start the Worker in local `workerd` with Wrangler's `createTestHarness`.

## Status

**working.** Tested locally; not yet deployed.
