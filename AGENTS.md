@README.md

## Finding Instructions

Instructions sit next to what they govern. Read the ones that cover the files you change:

- **Per directory:** a directory with its own concern has a `README.md` (what it is, its status, and its known gaps) and an `AGENTS.md` (the rules for working there) that starts by including the `README.md`. Both apply to everything below the directory. Before changing a file, read every `AGENTS.md` from the root down to that file's directory, with the `README.md` beside each. A `CLAUDE.md` only includes the `AGENTS.md` beside it, for Claude Code.
- **Per file pattern:** each rule in `.claude/rules/` applies to the files its `paths` frontmatter matches, or to every file when it has none. Claude Code and VS Code load them on their own; other agents read every rule matching a file before changing it.

| Rule                                                                | Applies to                                                                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [context-gathering](.claude/rules/context-gathering.md)             | all files                                                                                                               |
| [git](.claude/rules/git.md)                                         | all files                                                                                                               |
| [module-organizing](.claude/rules/module-organizing.md)             | all files                                                                                                               |
| [naming](.claude/rules/naming.md)                                   | all files                                                                                                               |
| [tooling](.claude/rules/tooling.md)                                 | all files                                                                                                               |
| [coding](.claude/rules/coding.md)                                   | `**/*.{js,mjs,cjs,ts,mts,cts}`                                                                                          |
| [commenting](.claude/rules/commenting.md)                           | `**/*.{js,mjs,cjs,ts,mts,cts}`                                                                                          |
| [errors](.claude/rules/errors.md)                                   | `**/*.{js,mjs,cjs,ts,mts,cts}`                                                                                          |
| [barrel-exporting](.claude/rules/barrel-exporting.md)               | `**/index.ts`                                                                                                           |
| [package-deps](.claude/rules/package-deps.md)                       | `**/package.json`                                                                                                       |
| [testing](.claude/rules/testing.md)                                 | `**/*.spec.ts`, `**/*.spec-helper.ts`, `**/test/**`                                                                     |
| [privacy](.claude/rules/privacy.md)                                 | `packages/server/src/**`, `apps/**`, `fixtures/**`, `**/*.spec.ts`                                                      |
| [documentation-authoring](.claude/rules/documentation-authoring.md) | `**/*.{js,mjs,cjs,ts,mts,cts}`, `**/README.md`, `**/AGENTS.md`, `**/CLAUDE.md`, `docs/**/*.md`, `.claude/rules/**/*.md` |
