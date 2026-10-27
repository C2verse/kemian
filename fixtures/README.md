# Fixtures

- [knowledge-base/](knowledge-base/README.md): an invented personal knowledge base for Robin Example, a fictional software engineer. Tests and the demo deployment use it. Everything in it is made up.

## What It Covers

Two levels, `public` and `private`, configured in `knowledge-base/kemian.config.ts`:

- **Folders:** public folders (`about/`, `projects/`) and private ones by default (the root, `journal/`, `meta/`, `sources/`).
- **Files overriding their folder** in both directions: a private file in a public folder (`about/contact.md`, `projects/atlas.md`) and a public one in a private folder (`journal/highlights.md`).
- **Markup:** inline spans with and without `alt`, blocks with `reason`, a literal tag in inline and fenced code, and private links in public indexes.
- **Configuration:** an excluded raw folder (`sources/`, except its README), a draft filtered from the public level (`projects/tidepool.md`), public instructions, kept frontmatter, and URLs.

The public bundle has 5 files and the private one 14.

## Status

**stable.** Tests depend on its exact content.
