# Kemian design

Status: draft. Initial design from 2026-10-20; nothing is built yet. Update this file whenever a decision changes, and mark open questions `TODO:`.

## Problem

People keep their knowledge in a folder of Markdown files and want AI tools to work from it, but some of it is for anyone and some only for themselves. Today the choice is sharing all of it or none of it. Kemian lets one source folder serve both: private content is marked inline, a separate redacted bundle is built for each audience, and each bundle is served over MCP to whichever AI client holds the matching credential. The public bundle never contains private content, so a public chatbot or a stranger's agent can't leak what it was never given.

The name is 刻面 (*kèmiàn*), the gemology term for "facet": one body of knowledge, a different face for each viewer.

## Concepts

- **Content repo:** a user's folder of Markdown, usually a Git repo. Not part of Kemian.
- **Level:** a named access level, such as `public` or `private`. Levels are plain strings defined by configuration; no name is special in the code.
- **Bundle:** a JSON file with everything one level may see, already redacted.
- **Identity:** who a caller is, established by an auth provider (e.g. a GitHub user). Configuration maps identities to levels.

## Example deployment

The first deployment is the author's personal knowledge base:

| Audience | Client | Level |
|---|---|---|
| Employers | Chat widget on the author's portfolio | `public` |
| Employers' own agents | Their Claude, ChatGPT, etc., given the MCP URL | `public` |
| The author | Claude web, desktop, mobile | `private` |

## Packages

One monorepo. Each package has one focused responsibility, and service-specific code lives in its own package behind interfaces defined in `@kemian/core`.

| Package | Responsibility |
|---|---|
| `@kemian/protocol` | The bundle's JSON Schema, TypeScript types, and version check. The contract every other package depends on; other bundlers depend only on it. |
| `@kemian/bundler-markdown` | Parses the privacy markup and builds one bundle per level from a folder of Markdown. |
| `@kemian/core` | Platform-neutral logic: the `BundleSource` and `BundleStore` interfaces, `sync`, level resolution, and the MCP tools. No platform or service APIs. |
| `@kemian/server-cloudflare` | Wires core into a Cloudflare Worker: MCP handler, OAuth provider integration, a `BundleStore` on Cloudflare storage, and the scheduled sync. |
| `@kemian/auth-github` | GitHub login for the OAuth flow, producing an identity. |
| `@kemian/source-github` | A `BundleSource` that reads the latest bundle artifact from a GitHub Actions workflow. |
| `@kemian/chat` | The shared chat backend for website widgets. TODO: confirm the name. |

Also in the repo:

- **A publish Action** (GitHub Action) that content repos add to build and validate bundles and upload them as a workflow artifact.
- **A template** (`templates/cloudflare`): a ready-to-deploy Worker, see [Template](#template).

## Bundle contract

- The server knows nothing about a content repo's layout, frontmatter, or markup. It only reads bundles.
- Shape (to be finalized in `@kemian/protocol`):

  ```json
  {
    "protocol": 1,
    "level": "public",
    "instructions": "Guidance for agents reading this level…",
    "files": [
      { "path": "projects/example.md", "summary": "…", "updated": "2026-10-18", "content": "…already redacted Markdown…" }
    ]
  }
  ```

- One bundle per level. More levels means more files, with no schema change.
- Redaction happens in the bundler, before the server sees content. A server bug can expose at most the bundle the caller's level maps to.
- Bundles hold content only. The server builds its search index from a bundle at load time.
- `instructions` carry the guidance for that level (for the example deployment, also the chat's system prompt), so every client gets the same guidance.

## Privacy markup

The markup `@kemian/bundler-markdown` implements: frontmatter `visibility` for files and folders, and `<private>…</private>` blocks and inline spans with an optional `alt`. It fails closed: a file with malformed markup is left out of non-private bundles entirely.

The spec currently lives in the author's knowledge base and moves here as the bundler's spec. TODO: move it to this repo. The author's existing implementation (`export-public.mjs`, with a `--check` mode) is the starting point for the bundler.

## Pipeline

```
content repo ── publish Action ──▶ workflow artifact
                                        │
                              BundleSource.fetchLatest()
                                        │
                                   sync() ──▶ BundleStore ──▶ MCP tools
```

Interfaces in `@kemian/core` (sketch):

```ts
interface BundleSource {         // where new bundles come from
  fetchLatest(): Promise<{ version: string; bundles: Map<Level, Bundle> } | null>;
}

interface BundleStore {          // where the server keeps them
  get(level: Level): Promise<Bundle | null>;
  put(version: string, bundles: Map<Level, Bundle>): Promise<void>;
  version(): Promise<string | null>;
}

function sync(source: BundleSource, store: BundleStore): Promise<SyncResult>;
```

- **Bundling runs in CI**, not on the server: markup errors fail the build where the author sees them, and serverless CPU limits (e.g. Workers' free tier) may not fit bundling a whole repo.
- **The server pulls and persists.** It keeps the last good bundles in its own store, so artifact expiry (90 days by default on GitHub), GitHub downtime, and rate limits never affect requests.
- **`sync` validates against `@kemian/protocol` and replaces all levels together.** If validation fails, the previous version stays, so a broken build never takes the server down.
- **Triggers:** a scheduled sync (e.g. every 15 minutes) as the reliable baseline, plus an optional notification from the publish Action (a POST to `/sync` signed with a shared secret) that only tells the server to pull now. It carries no content or credentials.
- **Credentials:** the content repo needs none from the server's platform. The server holds one read-only GitHub token for the content repo.
- **Visibility:** an artifact is visible to exactly the people who can read the content repo's source, so storing bundles there exposes nothing new.

## MCP server

- One `/mcp` endpoint. Tools are named by action:
  - `list(path)`: a folder's entries with their summaries.
  - `read(paths)`: one or more files per call, to cut round trips.
  - `search(query)`: keyword search over the caller's bundle.
- **The credential decides the level.** No token resolves to the configured anonymous level (`public` by default, or none to require login). A token resolves to an identity, and configuration maps it to a level. A caller with no matching level sees nothing.
- **`/mcp?access=<level>` triggers a login.** Clients like Claude web only start OAuth after a 401, and an endpoint that accepts anonymous requests never sends one. The argument only makes the server demand a login; the token alone decides what a request sees.
- **Read-only** in v1.
- **Instructions:** the bundle's `instructions` go into the MCP initialize response and state the access level explicitly. Because not every client shows server instructions to the model, they're also returned from `list("/")`.
- **Cloudflare implementation:** built on the Agents SDK's `createMcpHandler` (not `McpAgent`, which Cloudflare has deprecated), wrapped in the Workers OAuth Provider. Tools read identity with `getMcpAuthContext()`.

### Extension

A deployment's Worker imports Kemian as one feature and can add its own:

- **Custom tools** through an `extend` hook. The hook receives the MCP server and the caller's resolved level, bundle, and identity, never the store or source, so custom code can't read another level's bundle by accident.
- **Custom routes** through a `fallback` handler for requests that aren't MCP or OAuth (e.g. a `/chat` route).

API sketch for `@kemian/server-cloudflare` (names not final):

```ts
export default kemian({
  source: githubArtifacts({ repo: "owner/notes", workflow: "publish.yml" }),
  store: kvStore({ binding: "BUNDLES" }),
  auth: githubLogin({ levels: { private: [/* GitHub user IDs */] } }),
  anonymous: "public",
  extend(server, { level, bundle, identity }) { /* server.registerTool(…) */ },
  fallback(request, env, ctx) { /* other routes */ },
});
```

## Chat backend (`@kemian/chat`)

A backend for an "ask about me" widget on a website. The widget only renders streamed responses and holds no secrets or logic.

- **Model-agnostic:** the backend is its own MCP client running its own loop, using the Vercel AI SDK (`createMCPClient` from `@ai-sdk/mcp`), so deployers can compare models from different providers. Not Anthropic's MCP connector, which ties the chat to Claude. The example deployment starts with Claude Haiku 5.5.
- **Anonymous only:** the backend connects to the MCP server with no credential. Even a fully jailbroken model can't reach private content.
- **Grounded answers:** answers come only from tool results, with a link to the source page, and "that's not in my profile" otherwise. A wrong claim shown to an employer does more damage than a refusal.
- **Defenses against cost and abuse:** a monthly spend limit at the model provider, per-IP rate limiting, a bot check on the widget (e.g. Cloudflare Turnstile), a cap on turns per conversation, prompt caching of the system prompt and tool definitions, and a system prompt scoped to the deployment's subject.
- **Transcript logging** as an option, with a notice in the widget.

TODO: whether Kemian also ships the widget (e.g. as a web component), or only the backend.

## Template

A ready-to-deploy starter project in `templates/cloudflare`: a ~20-line Worker entry, a Wrangler config declaring the storage it needs, and a README. Deployers copy it once and own it; the logic stays in packages they update with `npm update`.

- A [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/configuration/deploy-button/) in the README copies the template into the user's GitHub, provisions the storage declared in the Wrangler config, and deploys.
- The button accepts a subdirectory, but the app must be fully self-contained there, so the template depends on **published** `@kemian/*` versions. CI tests it against the workspace by overriding those versions.
- Manual steps: create a GitHub OAuth app and set its secrets, set the GitHub token for the source, add the deployer's GitHub ID to the level config, and add the publish Action to the content repo.

## Build order

1. `@kemian/protocol` and `@kemian/bundler-markdown`. Test locally against a fixture knowledge base.
2. `@kemian/core` and `@kemian/server-cloudflare`, serving a public bundle placed in the store by hand. Test from Claude web as an anonymous connector.
3. The publish Action, `@kemian/source-github`, and `sync`.
4. `@kemian/auth-github` and `?access=<level>`.
5. `@kemian/chat`.
6. The template and Deploy button.

Each step ships on its own.

## Later

- Replace `?access=<level>` with MCP step-up authorization (403 `insufficient_scope`) once clients handle it. Claude Code had open bugs on this as of 2026-10-20 ([#44652](https://github.com/anthropics/claude-code/issues/44652), [#68720](https://github.com/anthropics/claude-code/issues/68720)).
- A `propose_edit` tool that opens a pull request on the content repo, with the bundler's check run on the PR.
- Semantic search.
- Encryption of non-public bundles, only if bundles ever need storage more visible than their source.

## Open questions

- TODO: Search library (MiniSearch or Fuse.js).
- TODO: Which Cloudflare storage backs `BundleStore` (KV or R2), given bundle sizes.
- TODO: How the bundler excludes paths (e.g. raw source material) from every level: configuration or markup.
- TODO: Which clients to support besides Claude and the chat widget. ChatGPT may need tools named `search` and `fetch` with specific shapes (unverified).
- TODO: Compare the privacy markup with Obsidian Smart Export's marker syntax before finalizing.
- TODO: Tooling: package manager, build, test runner, release process.

## Prior art

Researched 2026-10-20 from search results and READMEs; the code wasn't read. Nothing found combines tiered access, inline privacy markup, and a generic bundle format.

Read in depth before writing code:

- [cloudflare-mcp-for-static-sites](https://glama.ai/mcp/servers/@lennyzeltser/cloudflare-mcp-for-static-sites): builds a search index ahead of time, uploads it to R2, and serves it from a Worker with Fuse.js. The closest to the bundle design.
- [Cloudflare's remote MCP server guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/) and its GitHub OAuth template (`remote-mcp-github-oauth`): the login wiring. Its README calls it a demo that needs more security work for production.
- [skywalklab/portfolio-mcp](https://github.com/skywalklab/portfolio-mcp): a portfolio MCP server that also backs a chatbot on the author's site.

Also relevant:

- Other portfolio MCP servers, all single-level with hand-written data: [aim-t/portfolio-mcp](https://glama.ai/mcp/servers/aim-t/portfolio-mcp), [ayush-s-tomar/portfolio-mcp-server](https://github.com/ayush-s-tomar/portfolio-mcp-server), [HireMe MCP](https://dev.to/djoudad292/i-turned-my-portfolio-into-an-mcp-server-so-ai-agents-can-hire-me-227l).
- [PersonalKnowledgeMCP](https://github.com/sethships/PersonalKnowledgeMCP): separate Private, Work, and Public knowledge bases; a reference for level design.
- [Basic Memory](https://mcpservers.org/servers/basicmachines-co/basic-memory): a reference for edit features.
- [Smart Export](https://community.obsidian.md/plugins/smart-export) (Obsidian): removes sections marked private from its exports.
- [docs-to-mcp](https://glama.ai/mcp/servers/@fayazara/docs-to-mcp): MCP over Cloudflare's managed AI Search.
- [GitMCP](https://gitmcp.io): serves any public GitHub repo as an MCP server.
- [Cloudflare MCP authorization docs](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/) and [handler API](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/).
- [Vercel AI SDK MCP integration](https://vercel.com/docs/mcp/integrations/ai-sdk).
