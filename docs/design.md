# Kemian design

Status: draft. Initial design from 2026-10-20; MVP decisions from 2026-10-25. M0 is done; M1 and M2 work locally, and the package is ready to publish (M3) once a license is chosen. Nothing is deployed yet. Update this file whenever a decision changes, and mark open questions `TODO:`.

## Problem

People keep their knowledge in a folder of Markdown files and want AI tools to work from it, but some of it is for anyone and some only for themselves. Today the choice is sharing all of it or none of it. Kemian lets one source folder serve both: private content is marked inline, a separate redacted bundle is built for each audience, and each bundle is served over MCP to whichever AI client holds the matching credential. The public bundle never contains private content, so a public chatbot or a stranger's agent can't leak what it was never given.

The name is 刻面 (_kèmiàn_), the gemology term for "facet": one body of knowledge, a different face for each viewer.

## Principles

- **Make things work first.** The MVP ships as one package deployed to Cloudflare; the structure is refined once it runs.
- **Configurable, not opinionated.** Levels, paths, frontmatter, instructions, and per-level filtering come from configuration and hooks, not hard-coded conventions.
- **Privacy can't be configured off.** Hooks can drop files or change content, but nothing makes a bundle contain more than the markup allows.

## Concepts

- **Content repo:** a user's folder of Markdown, usually a Git repo. Not part of Kemian.
- **Level:** a named access level, such as `public` or `private`. Configuration declares levels as an ordered list, lowest first; each level sees everything the levels below it see. No name is special in the code.
- **Bundle:** a JSON document with everything one level may see, already redacted.
- **Bundle set:** the bundles of every level from one build, published and replaced together.
- **Identity:** who a caller is, established by an auth provider (e.g. a GitHub user). Configuration maps identities to levels.

## Example deployment

The first deployment is the author's personal knowledge base:

| Audience              | Client                                         | Level     |
| --------------------- | ---------------------------------------------- | --------- |
| Employers             | Chat widget on the author's portfolio          | `public`  |
| Employers' own agents | Their Claude, ChatGPT, etc., given the MCP URL | `public`  |
| The author            | Claude web, desktop, mobile                    | `private` |

## Package

For the MVP, everything ships in one package, `@kemian/server`, organized into modules. Each module has its own subpath export, so it can become a package later without changing callers.

| Module       | Export                      | Responsibility                                                                                                                                                                      | Later package               |
| ------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `protocol`   | `@kemian/server/protocol`   | The bundle schema, its types, the version check, and the generated JSON Schema. The contract every other module depends on.                                                         | `@kemian/protocol`          |
| `bundler`    | `@kemian/server/bundler`    | Parses the privacy markup and builds a bundle set from a folder of Markdown. Ships the `kemian` CLI (`build`, `check`, `publish`). Runs on Node.                                    | `@kemian/bundler-markdown`  |
| `core`       | `@kemian/server/core`       | Platform-neutral logic on web-standard `Request` and `Response`: the `BundleStore` interface, publishing, level resolution, search, and the MCP tools. No platform or service APIs. | `@kemian/core`              |
| `cloudflare` | `@kemian/server/cloudflare` | Wires core into a Cloudflare Worker: routes, the MCP handler, the OAuth provider, and a `BundleStore` on R2.                                                                        | `@kemian/server-cloudflare` |
| `github`     | `@kemian/server/github`     | GitHub sign-in: a `SignInProvider` that turns a GitHub login into an identity like `github:12345`.                                                                                  | `@kemian/auth-github`       |

The chat backend (M4) will be another module.

Module rules, enforced by Oxlint:

- `protocol` imports no other module. `bundler` and `core` import only `protocol`. `cloudflare` and `github` import `core` and `protocol`. Nothing imports `cloudflare` or `github`; a deployment passes `githubSignIn(…)` to the Worker as a `SignInProvider`.
- Modules import each other only through their `index.ts`.
- Service-specific code lives in its own module behind an interface defined in `core`.

Also in the repo:

- **`apps/demo`:** a private Worker that serves the fixture knowledge base. It becomes the [template](#template).
- **`fixtures/knowledge-base`:** an invented knowledge base used by tests and the demo.

### Effect

The implementation uses [Effect](https://effect.website) v4: services and layers for the interfaces in `core`, typed errors for every failure path, and Effect Schema for the protocol.

- **The public API is plain TypeScript.** Deployers configure Kemian with plain objects and functions returning Promises, and never need to write Effect.
- **The extension API is Kemian's own** (see [Extension](#extension)), so the MCP library underneath can change without affecting deployers.
- **MCP goes through the official SDK.** Effect's `McpServer` serves Workers only with the sessionless 2026-07-28 revision, while clients such as Claude web negotiate 2025-era versions, so the MCP layer uses `@modelcontextprotocol/server` v2 instead (see [MCP server](#mcp-server)).
- **`effect` is pinned to an exact version.** The HTTP router, HTTP API, CLI, and AI modules are marked unstable in 4.0.

## Bundle contract

- The server knows nothing about a content repo's layout, frontmatter, or markup. It only reads bundles.
- Redaction happens in the bundler, before the server sees content. A server bug can expose at most the bundle the caller's level maps to.
- Bundles hold content only. The server builds its search index from a bundle at load time.
- `instructions` carry the guidance for that level, so every client gets the same guidance.

Protocol version 1:

```ts
interface Bundle {
  protocol: 1;
  level: string;
  build: { id: string; createdAt: string; source?: string }; // source: e.g. a commit SHA
  instructions?: string;
  folders: { path: string; summary?: string }[]; // '' is the root
  files: {
    path: string; // POSIX, relative, unique, no leading '/', no '..'
    visibility?: string; // the file's level when it's above the lowest; omitted in the lowest level's bundle
    title?: string;
    summary?: string;
    updated?: string; // YYYY-MM-DD
    url?: string;
    meta?: Record<string, JsonValue>; // allowlisted frontmatter only
    content: string; // Markdown without frontmatter, redacted for this level
  }[];
}

interface BundleSet {
  // what `kemian publish` sends; replaces all levels together
  protocol: 1;
  build: Bundle['build'];
  bundles: Bundle[]; // levels are unique, and every bundle's build.id matches
}
```

- **Level names** are lowercase letters, digits, and hyphens, starting with a letter (`^[a-z][a-z0-9-]*$`), so they're safe in URLs and as tag names.
- **Compatibility:** adding an optional field keeps the protocol version; any other change increments it. Readers drop fields they don't know. The server rejects a protocol version it doesn't support and keeps its current build.
- **The JSON Schema covers structure only.** Unique paths, unique levels, and matching build IDs can't be expressed in JSON Schema; the decoder checks them.
- **No transformations in protocol schemas.** Wire types are plain JSON, so the generated JSON Schema matches the wire format exactly. Conversions happen inside the code.
- **The generated JSON Schema is checked in.** CI fails when it changes unintentionally, so the contract only changes deliberately.

## Privacy markup

The full spec is [privacy-markup.md](privacy-markup.md). In short:

- **Files and folders:** frontmatter `visibility: <level>` names the lowest level that may see a file. A folder's `README.md` sets the default for the folder, and the root defaults to the highest level.
- **Blocks and inline spans:** a tag named after a level, e.g. `<private>…</private>`, marks content visible to that level and above, with optional `alt` and `reason` attributes. The author's existing markup keeps working, and a new level adds a new tag. Tags match in any case. No nesting.
- **Higher levels keep the tags** around content they may see, so agents at those levels know what is restricted. Configuration can turn this off.
- **Below the highest level,** HTML comments are removed. Frontmatter is never part of `content`; only the summary, title, update date, and allowlisted keys reach a bundle.
- **Fails closed:** a file with malformed markup, frontmatter, or visibility, an unclosed HTML comment or code fence, or a link to something its level can't see is left out of every bundle below the highest level, and `kemian check` reports it. `kemian publish` refuses to publish a build with errors, so the exclusion is a second layer.

The bundler started from the author's `export-public.mjs`: its line-based parser is kept, generalized to any number of levels, and its fail-open holes are fixed (tag case, HTML comments, frontmatter, unclosed fences, reference-style and HTML links).

## Configuration

Content repo, `kemian.config.ts` (loaded with Node's built-in TypeScript support; `KemianConfig` in the `bundler` module documents every option):

```ts
export default defineConfig({
  levels: ['public', 'private'], // lowest first; the root defaults to the highest
  exclude: ['sources/**', '!sources/README.md'],
  frontmatter: { keep: ['status'] },
  filter: ({ level, frontmatter }) => level !== 'public' || frontmatter['status'] !== 'draft',
  instructions: { public: 'meta/public-instructions.md', private: 'AGENTS.md' },
  url: ({ path }) => `https://example.com/${path}`,
});
```

- Hooks can only leave content out: `filter` drops files from a level, and a hook that throws or returns something unexpected drops the file too.
- The CLI is `kemian check` and `kemian build` (to `dist/kemian/bundle-set.json`); both exit with code 1 when there are errors.

Worker (`apps/demo` is a complete example):

```ts
export default kemian((env: Env) => ({
  store: r2BundleStore(env.BUNDLES),
  anonymous: 'public', // or false to require login
  levels: { private: ['github:12345'] }, // identities per level
  publishToken: env.KEMIAN_PUBLISH_TOKEN,
  signIn: githubSignIn({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }),
  extend({ registerTool }, { level, bundle, identity }) {},
  fallback: (request, env, ctx) => new Response('…'),
}));
```

- Options are built once per Worker environment, so reader and search caches survive across requests in a Worker instance.
- Routes: `/mcp` (with permissive CORS, since access is decided by bearer tokens, not cookies), `/publish`, the OAuth endpoints when sign-in is configured (`/authorize`, `/callback`, `/token`, `/register`, `/.well-known/…`), and everything else to `fallback` (404 by default).

## Pipeline

```
content repo ── kemian build ──▶ bundle set ── kemian publish ──▶ PUT /publish ──▶ BundleStore (R2) ──▶ MCP tools
```

- **Bundling runs in CI**, not on the server: markup errors fail the build where the author sees them, and serverless CPU limits (e.g. Workers' free tier) may not fit bundling a whole repo.
- **The content repo pushes.** Its CI runs `kemian publish`, which sends the bundle set to the Worker's `PUT /publish` with a bearer token. A leaked token lets someone replace the content, but not read it.
- **`/publish` validates against the protocol and replaces all levels together.** If validation fails, the current build stays, so a broken build never takes the server down.
- **The `BundleStore` is on R2.** It writes a build's bundles under the build's ID, then switches a pointer to it; R2 is strongly consistent, so readers see one build or the other, never a mix. It keeps the previous build for readers still on it and deletes older ones. KV holds only OAuth tokens (M2).
- **Credentials:** the content repo holds the publish token. The server holds no GitHub credentials.

## MCP server

- One `/mcp` endpoint. Tools are named by action:
  - `list(path)`: a folder's entries with their summaries.
  - `read(paths)`: one or more files per call, to cut round trips.
  - `search(query)`: keyword search over the caller's bundle, with MiniSearch. The index is cached per Worker instance and build.
- **The credential decides the level.** No token resolves to the configured anonymous level (`public` by default, or none to require login). A token resolves to an identity, and configuration maps it to a level. A caller with no matching level sees nothing. The level is resolved on every request, so configuration changes apply immediately.
- **`/mcp?access=<level>` triggers a login.** Clients like Claude web only start OAuth after a 401, and an endpoint that accepts anonymous requests never sends one. The argument only makes the server demand a login; the token alone decides what a request sees.
- **Read-only** in v1.
- **Instructions:** the bundle's `instructions` go into the MCP initialize response and state the access level explicitly. Because not every client shows server instructions to the model, they're also returned from `list("/")`.
- **Implementation:** `core` builds a fresh MCP server for every request with the caller's bundle and instructions, and serves it with the MCP SDK v2's `createMcpHandler`. That serves 2025-era clients statelessly and the 2026-07-28 revision per request, so nothing depends on sessions surviving between requests or Worker instances. Tool inputs are Effect schemas passed to the SDK as Standard Schema.
- **Responses:** a caller whose identity maps to no level gets 403; before the first publish, every caller gets 503. A file the caller's level can't see reads as "Not found.", exactly like a missing one.
- **`BundleStore` is a plain Promise interface** (`currentBuildId`, `getBundle`, `replace`), so deployments can bring their own storage without Effect. Readers and search indexes are cached per Worker instance, keyed by build and level.

### Sign-in

- **The Worker is its own OAuth authorization server**, built on the Workers OAuth Provider, with tokens and grants in a KV namespace bound as `OAUTH_KV`. Clients register dynamically at `/register`. TODO: Client ID Metadata Documents are off, since they need the `global_fetch_strictly_public` compatibility flag; enable them if a client requires them.
- **Anonymous requests skip it.** A request to `/mcp` without a token goes straight to the anonymous level. A request with a token, with `?access=<level>`, or to a Worker with `anonymous: false` goes through the OAuth server, which answers 401 with the resource metadata to start sign-in.
- **Consent comes first.** `/authorize` shows which client is asking and where the token will go, then hands the browser to the sign-in provider. The library's helpers bind the consent page and the provider's `state` to the browser, so a forged page or a stolen code is refused. This guards against the MCP confused-deputy problem, since every client signs in through the same OAuth app.
- **Identities without a level are refused at sign-in** with `access_denied`, so strangers never get a token. Since the level is resolved on every request, a token whose identity later loses its level gets 403.
- **GitHub sign-in** uses PKCE and identifies users by numeric ID, which survives renames. Grants are stored per user as `github.12345`, since the provider reserves `:`.

### Extension

A deployment's Worker imports Kemian as one feature and can add its own:

- **Custom tools** through an `extend` hook. The hook receives a `registerTool({ name, description, input, handler })` function, where `input` is a [Standard Schema](https://standardschema.dev) that also implements Standard JSON Schema (zod 4, Valibot, ArkType, or Effect via `Schema.toStandardJSONSchemaV1`), and `handler` returns text or an MCP tool result. It also receives the caller's resolved level, bundle, and identity, never the store, so custom code can't read another level's bundle by accident.
- **Custom routes** through a `fallback` handler for requests that aren't MCP, OAuth, or publishing (e.g. a `/chat` route).

## Chat backend

A backend for an "ask about me" widget on a website. The widget only renders streamed responses and holds no secrets or logic.

- **Model-agnostic:** the backend is its own MCP client running its own loop, using the Vercel AI SDK (`createMCPClient` from `@ai-sdk/mcp`), so deployers can compare models from different providers. Not Anthropic's MCP connector, which ties the chat to Claude. The example deployment starts with Claude Haiku 5.5.
- **Anonymous only:** the backend connects to the MCP server with no credential. Even a fully jailbroken model can't reach private content.
- **Grounded answers:** answers come only from tool results, with a link to the source page, and "that's not in my profile" otherwise. A wrong claim shown to an employer does more damage than a refusal.
- **Defenses against cost and abuse:** a monthly spend limit at the model provider, per-IP rate limiting, a bot check on the widget (e.g. Cloudflare Turnstile), a cap on turns per conversation, prompt caching of the system prompt and tool definitions, and a system prompt scoped to the deployment's subject.
- **Transcript logging** as an option, with a notice in the widget.

TODO: whether the chat's system prompt is the public bundle's `instructions` or a chat-specific prompt layered on top of them.

TODO: whether Kemian also ships the widget (e.g. as a web component), or only the backend.

## Template

A ready-to-deploy starter project: a ~20-line Worker entry, a Wrangler config declaring the storage it needs, and a README. Deployers copy it once and own it; the logic stays in the package they update with `npm update`.

- A [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/configuration/deploy-button/) in the README copies the template into the user's GitHub, provisions the storage declared in the Wrangler config, and deploys.
- The button accepts a subdirectory, but the app must be fully self-contained there, so the template depends on the **published** `@kemian/server`. CI tests it against the workspace by overriding that version.
- Manual steps: create a GitHub OAuth app and set its secrets, set the publish token, add the deployer's GitHub ID to the level config, and add `kemian publish` to the content repo's CI.

## Tooling

| Concern         | Choice                                                         |
| --------------- | -------------------------------------------------------------- |
| Package manager | pnpm, pinned with `packageManager`                             |
| Runtime         | Node 24                                                        |
| Monorepo        | Nx: explicit targets, caching, `affected`, and `nx release`    |
| Type checking   | TypeScript 7, patched by `@effect/tsgo` for Effect diagnostics |
| Lint            | Oxlint, type-aware                                             |
| Format          | Oxfmt                                                          |
| Tests           | Vitest 5 with `@effect/vitest`                                 |
| Library build   | tsdown                                                         |
| Worker          | Vite with `@cloudflare/vite-plugin`, deployed with Wrangler    |
| Git hooks       | lefthook                                                       |
| CI              | GitHub Actions                                                 |

- Vitest 5 rules out `@cloudflare/vitest-pool-workers`, which supports only Vitest 4. Modules are tested in Node with in-memory stores and the official MCP client; `apps/demo` runs end-to-end tests in local `workerd` through Wrangler's `createTestHarness`, publishing the fixture with the real CLI and reading it back over MCP.
- tsdown can't emit declarations with TypeScript 7, which has no JS API, so `tsc` emits them. For the same reason `nx release`, which needs `@nx/js`, isn't used: releases are a manual pnpm version-and-publish for now.
- Vite+ isn't used yet: its task runner duplicates Nx, and it pins tool versions the Cloudflare tooling doesn't support yet. It wraps the same tools, so switching later is cheap.

## Milestones

- **M0, workspace:** the tooling above, coding conventions, CI, and the fixture knowledge base.
- **M1, public MVP on Cloudflare:** the `protocol`, `bundler`, `core`, and `cloudflare` modules; the anonymous level only; `apps/demo` deployed to `workers.dev`. Done when Claude web, connected anonymously to the demo, answers from the fixture knowledge base. Everything but the deployment works and is tested locally.
- **M2, private level:** the Workers OAuth Provider with GitHub login, `?access=<level>`, and the identity-to-level mapping. Works and is tested locally against a fake GitHub.
- **M3, first real deployment:** publish `@kemian/server` 0.x; the author's content repo runs `kemian publish` in CI and the author deploys a Worker. The package builds and packs, and a test installs the packed result and runs it. TODO: choose a license, create the GitHub repo, and pick the Cloudflare account before publishing and deploying.
- **M4, chat backend:** a chat module adding a `/chat` route.
- **M5, template:** the template and Deploy button, then splitting modules into packages once their boundaries hold.

## Later

- Replace `?access=<level>` with MCP step-up authorization (403 `insufficient_scope`) once clients handle it. Claude Code had open bugs on this as of 2026-10-20 ([#44652](https://github.com/anthropics/claude-code/issues/44652), [#68720](https://github.com/anthropics/claude-code/issues/68720)).
- Pulling bundle sets from GitHub Actions artifacts, as an alternative to pushing.
- A `propose_edit` tool that opens a pull request on the content repo, with the bundler's check run on the PR.
- Semantic search.
- Encryption of non-public bundles, only if bundles ever need storage more visible than their source.

## Open questions

- TODO: Which clients to support besides Claude and the chat widget. ChatGPT may need tools named `search` and `fetch` with specific shapes (unverified).
- TODO: Compare the privacy markup with Obsidian Smart Export's marker syntax before finalizing.
- TODO: Whether Markdown is parsed line by line (as now) or with a Markdown parser (mdast). Line-based parsing doesn't recognize indented code blocks, so tags in them count as markup, which errs toward hiding.
- TODO: Whether non-Markdown files (images, PDFs) are ever bundled. For now only Markdown is.
- TODO: How search fits the Workers free tier's 10 ms of CPU per request. Measured on 2026-10-25 in Node with synthetic files of about 3.7 KiB: parsing and decoding a bundle takes under 5 ms even at 1,000 files, but building the MiniSearch index takes 15 ms at 100 files, 60 ms at 300, and 160 ms at 1,000, while loading a prebuilt index takes 1 to 6 ms. The index is built lazily on the first search per Worker instance, so `list` and `read` never pay for it. Options: the paid plan, or building the index ahead of time (in the bundler, or at publish).

## Prior art

Researched 2026-10-20 from search results and READMEs; the code wasn't read. Nothing found combines tiered access, inline privacy markup, and a generic bundle format.

Read in depth before writing the server:

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
