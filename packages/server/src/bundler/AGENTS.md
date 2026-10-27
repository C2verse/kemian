@README.md

## Privacy Invariants

- **Only `renderMarkup` decides what a level sees.** Files are parsed once and rendered once per level; never add another path that emits a file's content, title, or summary into a bundle.
- **Everything in a level's bundle comes from its rendered files**: titles, summaries, folders, instructions, and the search index.
- **An error leaves the file out below the highest level.** For anything that could leak, report an error, not a warning.
- **Hooks only remove.** Call deployer hooks so a throw or an unexpected return value drops the file rather than keeping it.

## Working Here

- A new markup rule gets tests in `markup.spec.ts` for both a level that sees the content and one that doesn't.
- A new config option is documented in `KemianConfig`, validated in `ConfigData`, defaulted in `resolveConfig` and `ResolvedConfig`, and tested in `config.spec.ts`.
- The CLI writes reports to stderr and fails with `ProblemsFoundError` for exit code 1; `cli.spec.ts` runs it as a child process.
- This is the one module allowed `node:*` imports.
