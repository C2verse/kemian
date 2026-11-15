# @kemian/server

Serve one Markdown knowledge base to different audiences over MCP. Mark private content inline, build a redacted bundle for each access level, and let each AI client see only the level its credential maps to.

**Status:** 0.x and stable, running a demo and a real deployment.

Everything ships in this package for now, as separate entry points:

| Entry point                 | What it's for                                                        |
| --------------------------- | -------------------------------------------------------------------- |
| `kemian` (CLI)              | Check the markup, build and publish bundles, pull agents' proposals  |
| `@kemian/server/bundler`    | `defineConfig` and the bundler's Promise API                         |
| `@kemian/server/cloudflare` | The Cloudflare Worker: MCP, publishing, sign-in, and an R2 store     |
| `@kemian/server/github`     | GitHub sign-in for levels above the anonymous one                    |
| `@kemian/server/core`       | Platform-neutral server logic, to host Kemian somewhere else         |
| `@kemian/server/protocol`   | The bundle schema; JSON Schema files are in `@kemian/server/schema/` |
| `@kemian/server/search`     | The prebuilt search index, for bundlers other than Kemian's          |

## 1. Mark Up the Knowledge Base

Levels are an ordered list, lowest first. A file or folder names the lowest level that may see it in its frontmatter, and a tag named after a level marks content inside a file:

```markdown
---
visibility: public
---

I lead <private alt="a team">the plugin platform team at Quillwork</private>.

<private reason="negotiation position">

## Compensation

…

</private>
```

The full rules are in the [privacy markup spec](https://github.com/C2verse/kemian/blob/HEAD/docs/privacy-markup.md). Add `kemian.config.ts` at the root of the knowledge base:

```ts
import { defineConfig } from '@kemian/server/bundler';

export default defineConfig({
  levels: ['public', 'private'],
  exclude: ['inbox/**'],
  instructions: { public: 'meta/public-instructions.md' },
  url: ({ path }) => `https://github.com/you/notes/blob/main/${path}`,
});
```

Then run `npx kemian check`. It fails on anything that could leak: malformed markup, links from public content to private files, unclosed comments or code fences.

## 2. Deploy the Worker

```ts
// src/index.ts
import { kemian, r2BundleStore } from '@kemian/server/cloudflare';
import { githubSignIn } from '@kemian/server/github';

export default kemian((env: Env) => ({
  store: r2BundleStore(env.BUNDLES),
  anonymous: 'public',
  levels: { private: ['github:12345'] }, // your numeric GitHub user ID
  publishToken: env.KEMIAN_PUBLISH_TOKEN,
  signIn: githubSignIn({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }),
}));
```

The Worker needs an R2 bucket bound as `BUNDLES`, a KV namespace bound as `OAUTH_KV` (for sign-in), and the secrets `KEMIAN_PUBLISH_TOKEN` and `GITHUB_CLIENT_SECRET`. For GitHub sign-in, create a GitHub OAuth app whose callback URL is `https://<your worker>/callback`. Without `signIn`, the Worker serves only the anonymous level.

## 3. Publish From CI

```yaml
- run: npx kemian publish --url https://<your worker>
  env:
    KEMIAN_PUBLISH_TOKEN: ${{ secrets.KEMIAN_PUBLISH_TOKEN }}
```

`kemian publish` builds every level's bundle, refuses to publish when there are errors, and replaces all levels on the server together.

## 4. Connect a Client

- Public: add `https://<your worker>/mcp` as a remote MCP server. No login needed.
- Private: add `https://<your worker>/mcp?access=private`. The client starts a GitHub login, and only identities listed under a level get in.

The server offers `list`, `read`, and `search` tools, and each level's instructions.

## 5. Let Agents Propose Changes (Optional)

Editors, signed in at the highest level, also get four tools: `note` files a finding in the inbox, `propose_edit` replaces exact snippets of a file, and `list_stale` and `resolve_stale` quiz the author on files due for review. Nothing changes until the author merges a pull request.

Name the editors and keep proposals in the same R2 bucket:

```ts
import { kemian, r2BundleStore, r2ProposalStore } from '@kemian/server/cloudflare';

export default kemian((env: Env) => ({
  // …as above
  editing: {
    proposals: r2ProposalStore(env.BUNDLES),
    editors: ['github:12345'],
    proposalsToken: env.KEMIAN_PROPOSALS_TOKEN,
  },
}));
```

Give files a review interval per `status` in `kemian.config.ts`, e.g. `review: { intervals: { evolving: 30, stable: 180 } }`, and record a `verified: YYYY-MM-DD` date in a file's frontmatter when you confirm it. New notes go in `inbox/` unless `proposals: { notes: '…' }` says otherwise.

Then pull proposals on a schedule. Each becomes a pull request with a `kemian/check` status and what each lower level gains or loses; `current` verdicts are committed straight to the default branch:

```yaml
on:
  schedule: [{ cron: '0 * * * *' }]
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
  statuses: write
jobs:
  pull:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24 }
      - run: npm ci
      - run: npx kemian proposals pull --url https://<your worker>
        env:
          KEMIAN_PROPOSALS_TOKEN: ${{ secrets.KEMIAN_PROPOSALS_TOKEN }}
          GITHUB_TOKEN: ${{ github.token }}
      - run: git pull --ff-only && npx kemian publish --url https://<your worker>
        env:
          KEMIAN_PUBLISH_TOKEN: ${{ secrets.KEMIAN_PUBLISH_TOKEN }}
```

Allow GitHub Actions to create pull requests in the repository's settings (Actions → General → Workflow permissions). The last step publishes the verified dates, because commits pushed with `GITHUB_TOKEN` don't start other workflows. A pull request whose `kemian/check` fails changes what a level may see, or adds errors: read why before merging it. `kemian proposals pull --dry-run` shows what would happen without writing anything.
