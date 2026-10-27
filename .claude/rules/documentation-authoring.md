---
paths:
  - '**/*.{js,mjs,cjs,ts,mts,cts}'
  - '**/README.md'
  - '**/CLAUDE.md'
  - 'docs/**/*.md'
  - '.claude/rules/**/*.md'
---

Cross-cutting principles:

- `CLAUDE.md` must always `@`-include `README.md`.
- A document must not reference any higher-level document.
- Keep facts at the place nearest their source and expose them at a higher-level document via a link.
- Record only decided facts. Mark an open question `TODO:` where it belongs, without guessing the answer.
- Propose a fix when documentation and code disagree, or when a link is broken.
- Use Title Case for headings; prefer "&" over "and".

Where facts go:

- **Decisions and their reasons:** `docs/design.md`. Update it in the same change that makes or changes a decision.
- **Progress, next steps, open questions, and known gaps:** `docs/roadmap.md`. Update it in the same change that finishes a step, opens or closes a gap, or settles a question.
- **What a directory is and how to consume it:** that directory's `README.md`, including a **Status** section (`stable`, `working`, or `planned`, as defined in the roadmap) and its known gaps.
- **How to maintain a directory:** that directory's `CLAUDE.md`, after the `@README.md` include.
- **The privacy markup:** `docs/privacy-markup.md`, updated with any change to what the markup means.

Root docs:

- `/README.md` is an index: a short description, the status, the vocabulary, and a link for every component. It exposes just enough for the reader to know when to read more.
- `/CLAUDE.md` holds only the `@README.md` include, and `/AGENTS.md` only points to `CLAUDE.md`.
- `/.claude/rules/*.md` specify global rules:
  - Each targets an action or a system, named with a verb for an action or a noun for a system.
  - Each targets the whole repository or a file pattern, never a specific directory.
  - They expose no knowledge of the codebase beyond what's needed to follow them, covering only how to work with files, tools, and packages.
  - They prefer bullet points over prose.

Project and directory docs:

- A project's `README.md` is for consumers: an overview and the public surface. It may include a mermaid diagram.
- A directory's `README.md` gives the context for working in it: what each file is for, the status, and the known gaps.
- A `CLAUDE.md` covers internal design when the complexity warrants it, and the rules for working there.
- A new directory that holds a distinct concern, such as a module, gets both files.
