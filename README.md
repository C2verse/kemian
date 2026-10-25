# Kemian

Serve one Markdown knowledge base to different audiences over MCP. Private content is marked inline, the bundler builds a redacted bundle per access level, and the server serves each caller only the bundle their credential maps to.

The name is 刻面 (_kèmiàn_), the gemology term for "facet": one body of knowledge, a different face for each viewer.

- [packages/server](packages/server/README.md): `@kemian/server`, the CLI, bundler, and Cloudflare Worker. Start here to use Kemian.
- [apps/demo](apps/demo): a Worker serving the invented fixture knowledge base.
- [fixtures](fixtures/README.md): the invented knowledge base used by tests and the demo.
- [docs/design.md](docs/design.md): decisions, open questions, and milestones.
- [docs/privacy-markup.md](docs/privacy-markup.md): the privacy markup spec.
