# Privacy Markup

The markup the Markdown bundler reads to decide what each level sees. It's plain Markdown plus HTML-style tags, so files still render on GitHub and in editors: the tags are hidden in rendered views and visible in the source.

Levels are configured as an ordered list, lowest first, e.g. `['public', 'private']`. Each level sees everything the levels below it see. The examples use those two levels.

## Files & Folders

Frontmatter names the lowest level that may see a file:

```yaml
---
visibility: public
---
```

- A folder's `README.md` sets the level of the folder and of everything in it that doesn't declare its own.
- A file or folder without a declaration inherits its parent folder's level. The root defaults to the highest level, so anything not declared otherwise is visible only at the top. Configuration can change the default.
- A file can override its folder in either direction.
- The key is `visibility` unless configured otherwise.

## Blocks

A tag named after a level marks content that only that level and the levels above it see:

```markdown
<private reason="negotiation position">

## Compensation

Any Markdown: headings, lists, tables, code blocks.

</private>
```

- The opening and closing tags each sit alone on their own line.
- Leave a blank line before and after each tag. Without them, renderers show the Markdown inside as raw text. `kemian check` warns about missing blank lines.

## Inline Spans

```markdown
I lead <private alt="a team">the plugin platform team at Quillwork</private>.
```

The public version reads "I lead a team."

- An inline span opens and closes on the same line.
- Without `alt`, the span is removed. Write the sentence so it still reads well without it, or give an `alt`.
- A line that held only removed content disappears.

## Attributes

| Attribute | Meaning                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| `alt`     | Optional. Text that replaces the content for lower levels. On a block, it's a paragraph. |
| `reason`  | Optional. Why the content is restricted, to help later decisions about unmarking it.     |

Values use double quotes. No other attributes are allowed.

## What Each Level Gets

- Content above a level is removed, or replaced by its `alt`.
- Content a level may see keeps its tags in that level's bundle, so agents at that level know what's restricted. Tags of the lowest level are always removed. Configuration can remove all tags instead.
- HTML comments (`<!-- … -->`) are removed below the highest level, since renderers hide them and authors may treat them as private.
- Frontmatter isn't part of a file's content. Only the configured summary, title, and update date, plus explicitly kept keys, reach a bundle. Summaries and titles can use inline spans.

## Rules

- **Tags match in any case.** `<Private>` is markup, not text.
- **No nesting.**
- **Code is literal.** Tags inside fenced code blocks and inline code aren't markup. To show a tag in prose, put it in inline code.
- **Fail closed.** A file with an unclosed, nested, or malformed tag, an unclosed HTML comment, an unclosed code fence, malformed frontmatter, or an invalid level is left out of every bundle below the highest level, and `kemian check` reports it.
- **No links up.** Content a level sees may link only to files and folders that level can see. A link to something more restricted goes inside markup for that level, e.g. an index entry for a private file goes inside `<private>`. A file the `filter` hook leaves out of a level counts as more restricted for that level, and so does a file with errors below the highest level. Broken links and links to files the configuration excludes are warnings.
- **When unsure, mark it restricted.**

## Tooling

- `kemian check` validates the knowledge base without writing anything, and exits with code 1 if there are errors.
- Files and folders that the knowledge base's `.gitignore` files ignore are never read, like dot files and `node_modules`.
- `kemian build` writes the bundle set to `dist/kemian/bundle-set.json`, reports the same problems, and exits with code 1 if there are errors.
