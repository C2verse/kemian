# Core

The platform-neutral server: publishing, access levels, the bundle reader, the MCP tools, and the editing tools with their proposal queue, on web-standard `Request` and `Response`. Anything with the Fetch API can host it; the `cloudflare` module hosts it on Workers.

## Public Surface

- **`createKemian(options)`** returns a `Kemian` with `handleMcp(request, { identity })`, `handlePublish(request)`, `handleProposals(request)`, and `resolveLevel(identity)`.
- **`BundleStore`**: the storage interface, plain Promises (`currentBuildId`, `getBundle`, `replace`); `memoryBundleStore()` is an in-memory one.
- **Access:** an **identity** is who a caller is (`provider`, `id`, optional `name`), keyed like `github:12345` by `identityKeyOf`. `makeAccessPolicy` maps identities to levels, and `resolveLevel` gives a caller's level: the anonymous level without an identity, the listed level with one, or none.
- **`SignInProvider`**: the interface a sign-in implementation provides: an authorize URL, and turning a callback code into an identity.
- **`BundleReader`**: list, read, and search over one bundle.
- **Extension:** `ExtendHook` receives an `Extension` with `registerTool` and the `Caller` (level, bundle, identity).
- **Editing:** `EditingOptions` (the `ProposalStore`, the `editors`, the `proposalsToken`, and `maxProposalsPerDay`) turn on the editing tools for editors whose level's bundle is marked `highest`. `ProposalStore` is the queue's interface, plain Promises (`add`, `list`, `acknowledge`, `countAdded`); `memoryProposalStore()` is an in-memory one.

## Editing Tools

| Tool            | Does                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `note`          | Queues a note, refusing `about` paths that aren't in the bundle                                           |
| `propose_edit`  | Queues exact replacements, refusing edits that don't apply to the file in the current bundle              |
| `list_stale`    | Lists files whose `reviewDue` has passed, most overdue first, leaving out files with a pending verdict    |
| `resolve_stale` | Queues a verdict: `current` (verified today), `outdated` (with edits), or `obsolete` (current build only) |

Editors also see `Build: <id>` when reading, and the guidance on the tools in the instructions. A proposal's ID is a hash of the identity, the proposal, and the client's optional `id`, so a retried call is refused as already proposed, while a different proposal that reuses an `id` is kept.

## Responses

| Situation                                      | `handleMcp` | `handlePublish` | `handleProposals` |
| ---------------------------------------------- | ----------- | --------------- | ----------------- |
| Identity without a level                       | 403         |                 |                   |
| Nothing published, or nothing for the level    | 503 or 403  |                 |                   |
| Wrong method                                   |             | 405             | 405               |
| No token configured                            |             | 403             | 403               |
| Wrong token                                    |             | 401             | 401               |
| Not JSON, invalid, or another protocol version |             | 400             | 400               |
| Store failure                                  | 500         | 500             | 500               |

`handleProposals` answers `GET …/proposals` with `{ protocol: 1, proposals }`, oldest first, and `POST …/proposals/acknowledge` with `{ ids }` by dropping those proposals.

A file the caller's level can't see reads as "Not found.", exactly like a missing one.

## Files

| File                       | Contents                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `kemian.ts`                | `createKemian`: the MCP, publish, and proposals handlers, and the reader cache     |
| `mcp-server.ts`            | `buildMcpServer`: instructions, the `list`, `read`, and `search` tools, extensions |
| `mcp-tool.ts`              | Helpers for tool schemas and results, internal                                     |
| `editing.ts`               | `EditingOptions` and `EditorContext`                                               |
| `editing-tools.ts`         | The four editing tools and their guidance, internal                                |
| `proposal-store.ts`        | The `ProposalStore` interface, `fromProposalStore`, and `dayOf`                    |
| `proposal-store.memory.ts` | `memoryProposalStore`                                                              |
| `bundle-reader.ts`         | `BundleReader` and `normalizePath`                                                 |
| `access.ts`                | `Identity`, `AccessPolicy`, `makeAccessPolicy`, `resolveLevel`                     |
| `bundle-store.ts`          | The `BundleStore` interface and `fromStore`                                        |
| `bundle-store.memory.ts`   | `memoryBundleStore`                                                                |
| `sign-in.ts`               | The `SignInProvider` interface                                                     |

## Status

**stable**, except editing, which is **working:** tested with the official MCP client and in the demo's end-to-end tests, not yet deployed. The rest is tested with the official MCP client, including 2025-era clients, and with Claude web and Claude Code against the deployed demo.

Known gaps:

- Tool results are plain text, with no structured content.
- The reader cache holds a fixed 16 readers per Worker instance.
- The daily proposal limit and the retry check read, then write, so simultaneous calls can slip past them.
- `list_stale` dates come from the last publish, so a verdict hides its file only until the pull acknowledges it.
