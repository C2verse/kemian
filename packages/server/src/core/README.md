# Core

The platform-neutral server: publishing, access levels, the bundle reader, and the MCP tools, on web-standard `Request` and `Response`. Anything with the Fetch API can host it; the `cloudflare` module hosts it on Workers.

## Public Surface

- **`createKemian(options)`** returns a `Kemian` with `handleMcp(request, { identity })`, `handlePublish(request)`, and `resolveLevel(identity)`.
- **`BundleStore`**: the storage interface, plain Promises (`currentBuildId`, `getBundle`, `replace`); `memoryBundleStore()` is an in-memory one.
- **Access:** an **identity** is who a caller is (`provider`, `id`, optional `name`), keyed like `github:12345` by `identityKeyOf`. `makeAccessPolicy` maps identities to levels, and `resolveLevel` gives a caller's level: the anonymous level without an identity, the listed level with one, or none.
- **`SignInProvider`**: the interface a sign-in implementation provides: an authorize URL, and turning a callback code into an identity.
- **`BundleReader`**: list, read, and search over one bundle.
- **Extension:** `ExtendHook` receives an `Extension` with `registerTool` and the `Caller` (level, bundle, identity).

## Responses

| Situation                                      | `handleMcp` | `handlePublish` |
| ---------------------------------------------- | ----------- | --------------- |
| Identity without a level                       | 403         |                 |
| Nothing published, or nothing for the level    | 503 or 403  |                 |
| Wrong method                                   |             | 405             |
| No publish token configured                    |             | 403             |
| Wrong token                                    |             | 401             |
| Not JSON, invalid, or another protocol version |             | 400             |
| Store failure                                  | 500         | 500             |

A file the caller's level can't see reads as "Not found.", exactly like a missing one.

## Files

| File                     | Contents                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `kemian.ts`              | `createKemian`: the MCP and publish handlers, and the reader cache                 |
| `mcp-server.ts`          | `buildMcpServer`: instructions, the `list`, `read`, and `search` tools, extensions |
| `bundle-reader.ts`       | `BundleReader` and `normalizePath`                                                 |
| `access.ts`              | `Identity`, `AccessPolicy`, `makeAccessPolicy`, `resolveLevel`                     |
| `bundle-store.ts`        | The `BundleStore` interface and `fromStore`                                        |
| `bundle-store.memory.ts` | `memoryBundleStore`                                                                |
| `sign-in.ts`             | The `SignInProvider` interface                                                     |

## Status

**working.** Tested with the official MCP client, including 2025-era clients; not yet tried with Claude web.

Known gaps:

- Tool results are plain text, with no structured content.
- The reader cache holds a fixed 16 readers per Worker instance.
