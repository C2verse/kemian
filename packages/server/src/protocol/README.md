# Protocol

The bundle format every other module depends on: the schemas of a **bundle** (everything one level may see from one build) and a **bundle set** (every level's bundle from one build), the version check that decodes untrusted JSON, and the standalone JSON Schema for bundlers in other languages. It also holds the **proposal** format the server and the CLI exchange for editing.

A **level** is a lowercase name such as `public` (`^[a-z][a-z0-9-]*$`), safe in URLs and as a markup tag. Levels are ordered by configuration, not by the protocol.

## Public Surface

- **Schemas**, each an Effect Schema with a type of the same name: `Bundle`, `BundleSet`, `BundleFile`, `BundleFolder`, `BundleSearchIndex`, `BuildInfo`, `Level`, `FilePath`, `FolderPath`.
- **`decodeBundle` and `decodeBundleSet`**: Effects that decode untrusted JSON, dropping unknown fields, and fail with `UnsupportedProtocolError` for another protocol version or `InvalidBundleError` with the formatted issues.
- **`buildBundleJsonSchema` and `buildBundleSetJsonSchema`**: standalone draft 2020-12 JSON Schema documents, also shipped as `@kemian/server/schema/*.v1.schema.json`.
- **`PROTOCOL_VERSION`**: `1`.
- **Proposals:** `Proposal`, a union on `kind` (`note`, `edit`, `stale`) and, for `stale`, on `verdict` (`current`, `outdated`, `obsolete`), with `TextEdit`, `ProposalAuthor`, `ProposalId`, `ProposalList` (what `GET /proposals` returns), and `ProposalAcknowledgement`. `PROPOSAL_LIMITS` caps their sizes. `decodeProposalList` decodes untrusted JSON, failing with `UnsupportedProtocolError` or `InvalidProposalError`.
- **Edit semantics:** `applyTextEdits(text, edits)` applies exact replacements, each of whose `old` must occur exactly once and none overlapping, or reports why they conflict. `contentHashOf(content)` is the SHA-256 an `obsolete` verdict ties to the content the agent read.

A bundle may say it's the **highest** level's with `highest: true`, which lets the server offer editing without knowing the order of levels. Files may carry `verified` and, in the highest bundle only, `reviewDue` dates.

## Files

| File                  | Contents                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `bundle.ts`           | `Bundle`, `BundleFile`, `BundleFolder`, `BundleSearchIndex`, `BuildInfo`, `Level`, paths |
| `bundle-set.ts`       | `BundleSet`, with the unique-level and same-build checks                                 |
| `protocol-version.ts` | `decodeBundle`, `decodeBundleSet`, and their two errors                                  |
| `json-schema.ts`      | The standalone JSON Schema documents                                                     |
| `proposal.ts`         | `Proposal` and its parts, `decodeProposalList`, `applyTextEdits`, and `contentHashOf`    |
| `uniqueness.ts`       | `isEachUnique`, internal                                                                 |

## Status

**stable.** Protocol version 1. Proposals are **working:** tested between the server and the CLI, not yet deployed.

Known gaps:

- JSON Schema can't express unique paths, unique levels, or matching build IDs; only the decoder checks them.
- A bundle's `search.data` is opaque to the protocol: the `search` module validates and loads it.
- Proposals have no standalone JSON Schema; only Kemian's server and CLI exchange them.
