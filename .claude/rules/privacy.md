---
paths:
  - 'packages/server/src/**'
  - 'apps/**'
  - 'fixtures/**'
  - '**/*.spec.ts'
---

Kemian's purpose is that a level never sees content it may not see. Every change is judged against that first.

- **Privacy is structural.** Code that serves a caller receives only that caller's bundle, never the store, the source, or another level's bundle.
- **Fail closed.** When markup, frontmatter, a level, a hook, or a link is in doubt, leave the content out below the highest level and report an error. Never guess toward showing content.
- **Lower levels are derived from what they may see.** Anything shipped in a level's bundle, including titles, summaries, metadata, and the search index, is computed from that level's redacted content only.
- **A missing file and a hidden file look the same** to callers.
- **Guard leaks with tests.** When adding private content to the fixture, add a distinctive phrase from it to the private facts in `packages/server/src/bundler/bundler.spec.ts`, which asserts no lower bundle contains them, case-insensitively.
- **No real personal data in this repository.** Tests and examples use the invented knowledge base in `fixtures/knowledge-base/`. Never copy content from the author's knowledge base here.
