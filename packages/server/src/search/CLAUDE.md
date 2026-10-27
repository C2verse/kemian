@README.md

## Working Here

- **Change `SEARCH_INDEX_FORMAT`** whenever the indexed fields, any index-time option, or the engine's serialization changes. Readers rebuild indexes in other formats, so a stale index is never misread.
- Search-time options (`boost`, `prefix`, `fuzzy`) can change freely; they aren't part of the index.
- **Index only the files of the bundle the index ships in.** An index of anything else would leak terms into a level that may not see them.
- **Loading never throws.** Anything unexpected in `search.data` falls back to building from the files.
- **`data` is plain JSON.** The engine's serialized object holds `undefined` entries, so `buildSearchIndex` round-trips it through JSON to match what readers receive.
