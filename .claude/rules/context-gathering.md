Documentation here is designed to be explored top-down. The always-loaded root `README.md` is an abstract that links to the canonical documentation; don't rely on the abstract, or on an inferred understanding of a term, when the canonical documentation is a link away.

- When you read or touch anything that uses a term from the root `README.md`'s **Vocabulary**, read the linked documentation of that term before planning or changing code that depends on it.
- Before changing a file, read every `AGENTS.md` from the repository root down to the file's directory, with the `README.md` beside each, if they weren't loaded already.
- Before starting work, check `docs/roadmap.md` for the current status, the next steps, and known gaps that touch your task.
- When code deviates from its canonical documentation, trust the documentation and treat the code as the bug, unless the code documents a reason for the deviation. Then propose fixing one or the other.
