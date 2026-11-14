# Bundler

Turns a folder of Markdown with privacy markup into a bundle set, and ships the `kemian` CLI. It's the only module that runs on Node, and the only one that ever sees unredacted content.

## Public Surface

- **Configuration:** `KemianConfig` documents every option; `defineConfig` types a config file; `resolveConfig` validates one and applies defaults, failing with `InvalidConfigError`.
- **Building:** `buildBundleSet(options)` (Promise) and `buildKnowledgeBase(options)` (Effect) load a config file, read the folder, and return the bundle set with the problems found. `buildBundleSetFromTree` does the same from an in-memory `SourceTree` (`makeSourceTree` builds one from an object).
- **Problems:** `Problem` (path, line, severity, message), `hasErrors`, and `formatProblems`.
- **Publishing:** `sendBundleSet` PUTs a bundle set to a server's `/publish`, failing with `PublishError`; `publishEndpointOf` derives the endpoint from a server URL.
- **CLI** (`cli.ts`, the package's `kemian` binary): `check`, `build`, and `publish`. Each exits with 1 when the build has errors; `publish` then refuses to send.

## Files

| File                  | Contents                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `config.ts`           | `KemianConfig`, `defineConfig`, `resolveConfig`, and the resolved form                         |
| `bundler.ts`          | `loadConfig`, `buildKnowledgeBase`, and `buildBundleSet`                                       |
| `source-tree.ts`      | `SourceTree`, read from disk or made from an object                                            |
| `frontmatter.ts`      | YAML frontmatter, reporting malformed frontmatter instead of guessing                          |
| `markup.ts`           | The privacy markup: `parseMarkup` into a tree, `renderMarkup` for one level                    |
| `markdown.ts`         | Scanning shared by markup and links: code fences, inline code, link targets, the first heading |
| `visibility.ts`       | `VisibilityResolver`: the level of a file or folder                                            |
| `bundle-set-build.ts` | `buildBundleSetFromTree`: analyze every file, check links, then build each level's bundle      |
| `problem.ts`          | `Problem`, formatting, and a collector that ignores duplicates                                 |
| `publish.ts`          | `sendBundleSet`, the client side of `/publish`                                                 |
| `cli.ts`              | The `kemian` CLI, on `effect/cli`                                                              |

`markup.ts` is the part to read most carefully. A line becomes `Text`, `Comment`, and `Span` parts, and a block becomes a `Block` node. Rendering is a switch over those tags, so each rule about what a level sees is one `case`.

## Status

**working.** Tested on the fixture and on edge cases of the markup; not yet run on a real knowledge base.

Known gaps:

- Parsing is line based, so it doesn't recognize indented code blocks: tags in them count as markup, which errs toward hiding.
- Only Markdown files are bundled.
- A link to a file that exists but is excluded or filtered from a level isn't reported.
- A link to a file left out for errors is reported as visible only to the highest level, even when the file's own level is lower, so the real error (the file's) is easy to miss.
- `.gitignore` isn't read: git-ignored output folders such as `dist/` are bundled unless the config excludes them.
