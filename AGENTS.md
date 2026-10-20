# Kemian: instructions for AI agents

Kemian serves one Markdown knowledge base to different audiences over MCP. Private content is marked inline, the bundler builds a redacted bundle per access level, and the server serves each caller only the bundle their credential maps to. Read [docs/design.md](docs/design.md) before any task: it holds the decisions, the open questions, and the build order.

## Rules

- **The design doc is the source of truth.** When a decision is made or changed, update [docs/design.md](docs/design.md) in the same change. Record only decided facts; leave open questions as `TODO:`.
- **One responsibility per package.** `@kemian/core` uses no platform or service APIs. Code for a specific service (Cloudflare, GitHub, …) goes in its own package behind an interface defined in core.
- **`@kemian/protocol` is the contract.** Change it deliberately, with a version bump, and update every package that reads or writes bundles.
- **Privacy is structural.** Code that serves a caller receives only that caller's bundle, never the store or source. Redaction fails closed: when in doubt, leave content out.
- **No real personal data in this repo.** Tests and examples use an invented fixture knowledge base.
- **Commit messages** are lowercase sentences, e.g. "add bundle schema".

## The author's knowledge base

The first deployment is the author's personal knowledge base, a private repo at `~/projects/mindspace`. You may read it for context: why Kemian exists (`ideas/kemian.md`), the privacy markup spec (`meta/privacy-markup.md`), and the current implementation (`scripts/export-public.mjs`). Follow its `AGENTS.md` while there, and never copy its content into this repo, which is public.

## Tooling

TODO: package manager, build, test runner, and release process. Decide in the first implementation session and record them here.
