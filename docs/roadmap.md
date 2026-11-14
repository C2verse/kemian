# Roadmap

Where Kemian stands, what comes next, and what is still undecided. Updated 2026-11-14. Update it in the same change that finishes a step, adds a gap, or settles a question; record a settled question's answer in [design.md](design.md).

## Status Vocabulary

- **stable:** deployed and relied on. Change with care and keep it compatible.
- **working:** implemented and tested locally, but not yet proven in a deployment. It may still change.
- **planned:** decided, not built.

Each module's `README.md` states its own status and known gaps; this file tracks the project as a whole.

## Milestones

| Milestone                      | Status           | What's left                                                                                           |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------- |
| M0: workspace                  | done             |                                                                                                       |
| M1: public MVP on Cloudflare   | done             |                                                                                                       |
| M2: private level              | deployed         | Confirm a GitHub account not in `PRIVATE_IDENTITIES` is refused.                                      |
| M3: first real deployment      | ready to publish | Publish `@kemian/server` 0.1.0, add `kemian publish` to the author's content repo, deploy its Worker. |
| M4: chat backend               | planned          | Everything: a chat module adding a `/chat` route.                                                     |
| M5: template and Deploy button | planned          | Everything, then splitting modules into packages once their boundaries hold.                          |

## Next Steps

In order:

1. Sign in to the demo's `?access=private` with a GitHub account not in `PRIVATE_IDENTITIES`, and confirm it's refused.
2. Deploy the demo again and republish the fixture, so it runs the new search matching and its bundles carry an index in the current format.
3. Release `@kemian/server` 0.1.0 with the manual release steps.
4. Run `kemian check` on the author's knowledge base, fix what it reports, then add its config and CI publish step there.

## Open Questions

- TODO: What ChatGPT support takes. It may need tools named `search` and `fetch` with specific shapes (unverified).
- TODO: Whether a level without its own instructions falls back to the nearest lower level's. Now it gets only the generic text, so the demo's private level misses the public guidance.
- TODO: Compare the privacy markup with Obsidian Smart Export's marker syntax before finalizing the markup.
- TODO: Whether Markdown is parsed line by line (as now) or with a Markdown parser (mdast). Line-based parsing doesn't recognize indented code blocks, so tags in them count as markup, which errs toward hiding.
- TODO: Whether non-Markdown files (images, PDFs) are ever bundled. For now only Markdown is.
- TODO: Whether the chat's system prompt is the public bundle's `instructions` or a chat-specific prompt layered on top of them.
- TODO: Whether Kemian also ships the chat widget (e.g. as a web component), or only the backend.

## Known Gaps

- **Search cost on the Workers free tier.** The free tier allows 10 ms of CPU per request. With the prebuilt index, a cold first search measured 13 ms at 100 synthetic files and 21 ms at 300, in Node. It happens once per Worker instance and build. Options: the paid plan, or keeping the index in its own R2 object so only searches load it.
- **`list` and `read` parse the index too.** The index is part of the bundle, so the first request of any kind in a Worker instance parses it. Storing it separately in R2 would fix this as well.
- **Client ID Metadata Documents are off.** Enabling them needs the `global_fetch_strictly_public` flag, which would block the end-to-end tests' local fake GitHub; enable them in production configuration if a client requires them.
- **Prior art isn't read in depth yet.** The projects listed in [design.md](design.md#prior-art) were judged from READMEs only.
- **Release is manual.** `nx release` needs `@nx/js`, which breaks the Nx project graph on TypeScript 7. Revisit when Nx supports TypeScript 7, or write custom version actions.
- **Declarations aren't bundled.** tsdown's declaration bundling needs TypeScript 7.1's API; switch to its `tsgo` generator once 7.1 is stable.
- **The demo's `wrangler.jsonc` holds the author's KV namespace ID.** Wrangler wrote it on the first deploy. Anyone else deploying the demo, or the template made from it, must remove it so Wrangler creates their own.
- **Sign-in is only covered end to end.** `cloudflare/oauth.ts` runs only in `workerd`, so the demo's tests cover it, with no unit tests.

## Later

- Replace `?access=<level>` with MCP step-up authorization (403 `insufficient_scope`) once clients handle it. Claude Code had open bugs on this as of 2026-10-20 ([#44652](https://github.com/anthropics/claude-code/issues/44652), [#68720](https://github.com/anthropics/claude-code/issues/68720)).
- Pulling bundle sets from GitHub Actions artifacts, as an alternative to pushing.
- A `propose_edit` tool that opens a pull request on the content repo, with the bundler's check run on the PR.
- Semantic search.
- Encryption of non-public bundles, only if bundles ever need storage more visible than their source.
