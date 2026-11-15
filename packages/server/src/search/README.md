# Search

The search index that ships in each bundle. The bundler builds it from one level's own files with `buildSearchIndex`; the server loads it on the first search with `loadSearchIndex`, which builds an index from the files instead when the bundle has none, has one in another format, or has one it can't load.

## Public Surface

- **`buildSearchIndex(files)`**: the `BundleSearchIndex` to put in a bundle, as plain JSON.
- **`loadSearchIndex(bundle)`**: a `SearchIndex` whose `search(query)` returns `SearchMatch`es (path, score, matched terms), best first. It never throws.
- **`SEARCH_INDEX_FORMAT`**: the format this code writes and reads, naming the engine, the indexed fields, and how text splits into terms.

It's exported so bundlers other than Kemian's can ship compatible indexes.

## Files

| File              | Contents                                                       |
| ----------------- | -------------------------------------------------------------- |
| `search-index.ts` | The index options, building, loading with fallback, and search |

## Status

**stable.** MiniSearch 7, indexing `path`, `title`, `summary`, and `content`. Numbers like `110,000` stay one term and match only exactly; words of 4 letters or more also match by prefix and with a typo.

Known gaps:

- The index is part of the bundle, so the first request of any kind in a Worker instance parses it, not only searches.
- At 300 files, a cold first search still exceeds the Workers free tier's 10 ms of CPU.
