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

1. Once per Cloudflare account: turn on R2 in the dashboard (it asks for a payment method even on the free tier), then run `npx wrangler login`.
2. Write both required secrets to a file outside the repository. Wrangler refuses to create a Worker whose required secrets aren't set, and `wrangler secret put` only works once the Worker exists:

   ```sh
   umask 077
   printf 'KEMIAN_PUBLISH_TOKEN=%s\nGITHUB_CLIENT_SECRET=unset\n' "$(openssl rand -base64 32)" > ~/kemian-demo.secrets
   ```

   `unset` is a placeholder until sign-in is set up.

3. Deploy the first time with `pnpm exec nx deploy demo -- --secrets-file ~/kemian-demo.secrets`. It builds with Vite, creates the R2 bucket (and the KV namespace, when `wrangler.jsonc` has no ID for it), and prints the Worker's URL. Later deploys need no flag. Wrangler also logs each run in `~/.config/.wrangler/logs/`.
4. Publish the fixture as above, with `--url https://<worker>` and the token from the secrets file.
5. For sign-in, create a GitHub OAuth app with the callback URL `https://<worker>/callback`, with wildcard matching and device flow off. Set `GITHUB_CLIENT_ID` and `PRIVATE_IDENTITIES` (`github:` followed by the number from `gh api user --jq .id`) in `wrangler.jsonc`, run `npx wrangler secret put GITHUB_CLIENT_SECRET` in `apps/demo`, and deploy again. Clients sign in through `https://<worker>/mcp?access=private`.

If `publish` fails with `fetch failed` while `curl` reaches the Worker, Node gave up connecting: it allows 250 ms per address, which slow networks such as WSL's can exceed. Set `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000`.

## Tests

- `test/e2e.spec.ts`: publishing the fixture with the real CLI, anonymous MCP access, 2025-era clients, republishing, and CORS.
- `test/sign-in.spec.ts`: the whole OAuth flow against a fake GitHub: consent, the GitHub redirect with PKCE, the callback, the token, the private level, and refusals.

Both start the Worker in local `workerd` with Wrangler's `createTestHarness`.

## Status

**working.** Deployed, and tested at both levels with Claude web and Claude Code.
