# Bundler

Turns a folder of Markdown with privacy markup into a bundle set, ships the `kemian` CLI, and applies agents' proposals to the source as pull requests. It's the only module that runs on Node, and the only one that ever sees unredacted content.

## Public Surface

- **Configuration:** `KemianConfig` documents every option; `defineConfig` types a config file; `resolveConfig` validates one and applies defaults, failing with `InvalidConfigError`.
- **Building:** `buildBundleSet(options)` (Promise) and `buildKnowledgeBase(options)` (Effect) load a config file, read the folder, and return the bundle set with the problems found. `buildBundleSetFromTree` does the same from an in-memory `SourceTree` (`makeSourceTree` builds one from an object).
- **Problems:** `Problem` (path, line, severity, message), `hasErrors`, and `formatProblems`.
- **Publishing:** `sendBundleSet` PUTs a bundle set to a server's `/publish`, failing with `PublishError`; `publishEndpointOf` derives the endpoint from a server URL.
- **CLI** (`cli.ts`, the package's `kemian` binary): `check`, `build`, `publish`, and `proposals pull`. The first three exit with 1 when the build has errors; `publish` then refuses to send.
- **`kemian proposals pull`** reads `KEMIAN_URL` (or `--url`), `KEMIAN_PROPOSALS_TOKEN`, `GITHUB_REPOSITORY` (or `--repo`), `GITHUB_SHA` (or `--base`), `GITHUB_TOKEN`, and optionally `GITHUB_API_URL`, all set in GitHub Actions except the two Kemian ones. It appends its report to `$GITHUB_STEP_SUMMARY` when set. `--dry-run` needs only the Kemian ones, and writes and acknowledges nothing. Its modules aren't exported; the CLI is the interface.

## Pulling Proposals

For each pending proposal, oldest first, `pullProposals`:

1. applies it to the checked-out source with `applyProposal`: a note becomes a new file in the notes folder at the highest level; edits replace snippets in a file's body; `obsolete` deletes a note or sets the archived status, if the file's content in the highest bundle still hashes as the agent read it;
2. turns one that no longer applies into a note describing it, with `conflictNoteOf`;
3. reviews the changes with `reviewChanges`, which builds the bundle set before and after: new problems, changes to tags, comments, or visibility (as written and as parsed), files a lower level newly sees, and each lower level's lines gained and lost; edits that would create or change frontmatter conflict instead;
4. commits on top of `--base` through GitHub's REST API, pushes `kemian/proposal-<date>-<id>`, opens (or updates) the pull request with the review in its body, and posts the `kemian/check` status;
5. acknowledges it.

`current` verdicts are applied together, keeping the later date, and fast-forwarded onto the default branch; when GitHub refuses or the review fails, they become a `kemian/verified-<date>-<id>` pull request. A proposal GitHub refuses is reported as `failed` and stays queued while the rest go ahead; the command then exits with 1. A re-run updates the same branches and pull requests.

## Files

| File                   | Contents                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `config.ts`            | `KemianConfig`, `defineConfig`, `resolveConfig`, and the resolved form                         |
| `bundler.ts`           | `loadConfig`, `buildKnowledgeBase`, and `buildBundleSet`                                       |
| `source-tree.ts`       | `SourceTree`, read from disk (honoring `.gitignore` files) or made from an object              |
| `frontmatter.ts`       | YAML frontmatter, reporting malformed frontmatter instead of guessing                          |
| `markup.ts`            | The privacy markup: `parseMarkup` into a tree, `renderMarkup` for one level                    |
| `markdown.ts`          | Scanning shared by markup and links: code fences, inline code, link targets, the first heading |
| `visibility.ts`        | `VisibilityResolver`: the level of a file or folder                                            |
| `bundle-set-build.ts`  | `buildBundleSetFromTree`: analyze every file, check links, then build each level's bundle      |
| `problem.ts`           | `Problem`, formatting, and a collector that ignores duplicates                                 |
| `publish.ts`           | `sendBundleSet`, the client side of `/publish`                                                 |
| `proposal-apply.ts`    | `applyProposal`: a proposal's file changes; `conflictNoteOf` and `describeProposal`            |
| `proposal-review.ts`   | `reviewChanges`: new problems, markup changes, and each lower level's diff; `formatReview`     |
| `proposal-queue.ts`    | `fetchProposals` and `acknowledgeProposals`, the client side of `/proposals`                   |
| `github-repository.ts` | `makeGitHubRepository`: commits, branches, pull requests, and statuses over GitHub's REST API  |
| `proposal-pull.ts`     | `pullProposals`: the whole pull, and `formatPullReport`                                        |
| `cli.ts`               | The `kemian` CLI, on `effect/cli`                                                              |

`markup.ts` is the part to read most carefully. A line becomes `Text`, `Comment`, and `Span` parts, and a block becomes a `Block` node. Rendering is a switch over those tags, so each rule about what a level sees is one `case`.

## Status

**stable**, except `proposals pull`, which is **working:** tested against a fake GitHub, end to end from the MCP tools, and as a dry run against the demo Worker, not yet against GitHub. The rest is tested on the fixture and on edge cases of the markup, and publishing the first real deployment's knowledge base.

Known gaps:

- Parsing is line based, so it doesn't recognize indented code blocks: tags in them count as markup, which errs toward hiding.
- Only Markdown files are bundled.
- Editing a file rewrites its line endings as LF, since sources are read with CRLF turned into LF.
- Changed files are committed as regular files, so editing a symlinked or executable Markdown file replaces it with a plain one.
- Links to folders are checked against the folder's level only: a folder whose files a level can't see, or that are all excluded or filtered, passes as a link target.
- Link checks see a target's errors from analysis, not the link errors found alongside them, so a file left out for a link error of its own doesn't flag the files linking to it. The first error still fails the build.
