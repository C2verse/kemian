@README.md

## Privacy Invariants

- **Only `renderMarkup` decides what a level sees.** Files are parsed once and rendered once per level; never add another path that emits a file's content, title, or summary into a bundle.
- **Everything in a level's bundle comes from its rendered files**: titles, summaries, folders, instructions, and the search index.
- **An error leaves the file out below the highest level.** For anything that could leak, report an error, not a warning.
- **Hooks only remove.** Call deployer hooks so a throw or an unexpected return value drops the file rather than keeping it.
- **Proposals touch only what they may.** Edits apply to a file's body, never its frontmatter, and only to files in the highest level's bundle; new notes go only in the notes folder, at the highest level. Anything that could change what a level sees fails the review: keep `reviewChanges` flagging tags, comments, and visibility, as written, as parsed, and in edit snippets, and any file a lower level newly sees.
- **A proposal is never lost or forced.** One that doesn't apply exactly becomes a note; it's acknowledged only after its pull request or commit exists.

## Working Here

- A new markup rule gets tests in `markup.spec.ts` for both a level that sees the content and one that doesn't.
- A new config option is documented in `KemianConfig`, validated in `ConfigData`, defaulted in `resolveConfig` and `ResolvedConfig`, and tested in `config.spec.ts`.
- The CLI writes reports to stderr and fails with `ProblemsFoundError` for exit code 1; `cli.spec.ts` runs it as a child process.
- This is the one module allowed `node:*` imports.
