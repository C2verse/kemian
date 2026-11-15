# Protocol

The bundle format every other module depends on: the schemas of a **bundle** (everything one level may see from one build) and a **bundle set** (every level's bundle from one build), the version check that decodes untrusted JSON, and the standalone JSON Schema for bundlers in other languages.

A **level** is a lowercase name such as `public` (`^[a-z][a-z0-9-]*$`), safe in URLs and as a markup tag. Levels are ordered by configuration, not by the protocol.

## Public Surface

- **Schemas**, each an Effect Schema with a type of the same name: `Bundle`, `BundleSet`, `BundleFile`, `BundleFolder`, `BundleSearchIndex`, `BuildInfo`, `Level`, `FilePath`, `FolderPath`.
- **`decodeBundle` and `decodeBundleSet`**: Effects that decode untrusted JSON, dropping unknown fields, and fail with `UnsupportedProtocolError` for another protocol version or `InvalidBundleError` with the formatted issues.
- **`buildBundleJsonSchema` and `buildBundleSetJsonSchema`**: standalone draft 2020-12 JSON Schema documents, also shipped as `@kemian/server/schema/*.v1.schema.json`.
- **`PROTOCOL_VERSION`**: `1`.

## Files

| File                  | Contents                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `bundle.ts`           | `Bundle`, `BundleFile`, `BundleFolder`, `BundleSearchIndex`, `BuildInfo`, `Level`, paths |
| `bundle-set.ts`       | `BundleSet`, with the unique-level and same-build checks                                 |
| `protocol-version.ts` | `decodeBundle`, `decodeBundleSet`, and their two errors                                  |
| `json-schema.ts`      | The standalone JSON Schema documents                                                     |
| `uniqueness.ts`       | `isEachUnique`, internal                                                                 |

## Status

**stable.** Protocol version 1.

Known gaps:

- JSON Schema can't express unique paths, unique levels, or matching build IDs; only the decoder checks them.
- A bundle's `search.data` is opaque to the protocol: the `search` module validates and loads it.
