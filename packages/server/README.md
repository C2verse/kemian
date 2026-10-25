# @kemian/server

Serve one Markdown knowledge base to different audiences over MCP. Mark private content inline, build a redacted bundle for each access level, and let each AI client see only the level its credential maps to.

Everything ships in this package for now, as separate entry points:

| Entry point                 | What it's for                                                        |
| --------------------------- | -------------------------------------------------------------------- |
| `kemian` (CLI)              | Check the privacy markup, build bundles, and publish them            |
| `@kemian/server/bundler`    | `defineConfig` and the bundler's Promise API                         |
| `@kemian/server/cloudflare` | The Cloudflare Worker: MCP, publishing, sign-in, and an R2 store     |
| `@kemian/server/github`     | GitHub sign-in for levels above the anonymous one                    |
| `@kemian/server/core`       | Platform-neutral server logic, to host Kemian somewhere else         |
| `@kemian/server/protocol`   | The bundle schema; JSON Schema files are in `@kemian/server/schema/` |

## 1. Mark up the knowledge base

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

The full rules are in the [privacy markup spec](https://github.com/C2verse/kemian/blob/main/docs/privacy-markup.md). Add `kemian.config.ts` at the root of the knowledge base:

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

## 3. Publish from CI

```yaml
- run: npx kemian publish --url https://<your worker>
  env:
    KEMIAN_PUBLISH_TOKEN: ${{ secrets.KEMIAN_PUBLISH_TOKEN }}
```

`kemian publish` builds every level's bundle, refuses to publish when there are errors, and replaces all levels on the server together.

## 4. Connect a client

- Public: add `https://<your worker>/mcp` as a remote MCP server. No login needed.
- Private: add `https://<your worker>/mcp?access=private`. The client starts a GitHub login, and only identities listed under a level get in.

The server offers `list`, `read`, and `search` tools, and each level's instructions.
