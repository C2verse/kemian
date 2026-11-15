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
| `source-tree.ts`      | `SourceTree`, read from disk (honoring `.gitignore` files) or made from an object              |
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

**stable.** Tested on the fixture and on edge cases of the markup, and publishing the first real deployment's knowledge base.

Known gaps:

- Parsing is line based, so it doesn't recognize indented code blocks: tags in them count as markup, which errs toward hiding.
- Only Markdown files are bundled.
- Links to folders are checked against the folder's level only: a folder whose files a level can't see, or that are all excluded or filtered, passes as a link target.
- Link checks see a target's errors from analysis, not the link errors found alongside them, so a file left out for a link error of its own doesn't flag the files linking to it. The first error still fails the build.
