import { posix } from 'node:path';

import { parseDocument, stringify } from 'yaml';

import {
  applyTextEdits,
  contentHashOf,
  type Level,
  type NoteProposal,
  type Proposal,
  type TextEdit,
} from '../protocol/index.ts';
import type { ResolvedConfig } from './config.ts';
import { splitFrontmatter } from './frontmatter.ts';

/**
 * Change to one file of the knowledge base: its new text, or `null` to delete it.
 */
export interface FileChange {
  readonly path: string;
  readonly text: string | null;
}

/**
 * Result of applying a proposal to the source: the file changes, or why it doesn't apply.
 */
export type ProposalApplication =
  | { readonly _tag: 'Changed'; readonly changes: readonly FileChange[] }
  | { readonly _tag: 'Unchanged'; readonly reason: string }
  | { readonly _tag: 'Conflicted'; readonly reason: string };

/**
 * Source a proposal applies to.
 */
export interface ProposalSource {
  readonly config: ResolvedConfig;
  /** Text of every file in the source, by path relative to the root. */
  readonly texts: ReadonlyMap<string, string>;
  /** Content of every file in the highest level's bundle built from the source, by path. */
  readonly highestContents: ReadonlyMap<string, string>;
  /** Paths already taken by other changes of the same run, so new notes don't collide with them. */
  readonly pathsTaken: ReadonlySet<string>;
}

const SLUG_LENGTH = 60;

/**
 * Applies a proposal to the source.
 *
 * Proposals only touch files in the highest level's bundle, and new notes only go in the notes folder. Edits apply to a
 * file's body, never to its frontmatter.
 */
export const applyProposal = async (
  proposal: Proposal,
  source: ProposalSource,
): Promise<ProposalApplication> => {
  if (proposal.kind === 'note') {
    return { _tag: 'Changed', changes: [renderNote(proposal, source)] };
  }
  if (!source.highestContents.has(proposal.path)) {
    return { _tag: 'Conflicted', reason: `${proposal.path} is no longer in the knowledge base` };
  }
  const text = source.texts.get(proposal.path) ?? '';
  switch (proposal.kind) {
    case 'edit':
      return applyEditsToBody(proposal.path, text, proposal.edits);
    case 'stale':
      switch (proposal.verdict) {
        case 'current':
          return markVerified(proposal.path, text, { date: proposal.verified, source });
        case 'outdated':
          return applyEditsToBody(proposal.path, text, proposal.edits);
        case 'obsolete': {
          const content = source.highestContents.get(proposal.path) ?? '';
          if ((await contentHashOf(content)) !== proposal.contentHash) {
            return {
              _tag: 'Conflicted',
              reason: `${proposal.path} changed after build ${proposal.build}, where it was judged obsolete`,
            };
          }
          return retire(proposal.path, text, source);
        }
        default:
          return absurd(proposal);
      }
    default:
      return absurd(proposal);
  }
};

/**
 * Returns a note describing a proposal that couldn't be applied, so its content reaches the author anyway.
 */
export const conflictNoteOf = (proposal: Proposal, reason: string): NoteProposal => {
  const sections = [`Kemian couldn't apply this proposal: ${reason}.`];
  switch (proposal.kind) {
    case 'note':
      sections.push(proposal.body);
      break;
    case 'edit':
      sections.push(`Reason: ${proposal.reason}`, formatEdits(proposal.edits));
      break;
    case 'stale':
      sections.push(`Verdict: ${proposal.verdict}`);
      if (proposal.note !== undefined) sections.push(`Note: ${proposal.note}`);
      if (proposal.verdict === 'outdated') sections.push(formatEdits(proposal.edits));
      break;
    default:
      return absurd(proposal);
  }
  const target = proposal.kind === 'note' ? proposal.title : proposal.path;
  return {
    protocol: 1,
    id: proposal.id,
    createdAt: proposal.createdAt,
    author: proposal.author,
    kind: 'note',
    title: `Conflicted proposal for ${target}`.slice(0, 200),
    body: sections.join('\n\n'),
    ...(proposal.kind === 'note' ? {} : { about: [proposal.path] }),
  };
};

/**
 * Returns a one-line description of a proposal, e.g. `Edit projects/lantern.md`.
 */
export const describeProposal = (proposal: Proposal): string => {
  switch (proposal.kind) {
    case 'note':
      return `Note: ${proposal.title}`;
    case 'edit':
      return `Edit ${proposal.path}`;
    case 'stale':
      switch (proposal.verdict) {
        case 'current':
          return `Mark ${proposal.path} verified`;
        case 'outdated':
          return `Update outdated ${proposal.path}`;
        case 'obsolete':
          return `Retire obsolete ${proposal.path}`;
        default:
          return absurd(proposal);
      }
    default:
      return absurd(proposal);
  }
};

const renderNote = (proposal: NoteProposal, source: ProposalSource): FileChange => {
  const { config } = source;
  const day = proposal.createdAt.slice(0, 10);
  const path = freeNotePath(
    `${config.proposals.notesFolder}/${day}-${slugOf(proposal.title)}`,
    source,
  );
  const keys = config.frontmatterKeys;
  const frontmatter = stringify({
    [keys.visibility]: highestLevelOf(config),
    [keys.summary]: proposal.title,
    [keys.updated]: day,
  });
  const about = (proposal.about ?? []).map((target) => {
    const relative = posix.relative(posix.dirname(path), target);
    return `- [${target}](<${relative}>)`;
  });
  const sources = (proposal.sources ?? []).map((entry) => `- ${entry.replaceAll(/\s+/gu, ' ')}`);
  const author =
    proposal.author.name === undefined
      ? proposal.author.identity
      : `${proposal.author.name} (${proposal.author.identity})`;
  const sections = [
    `# ${proposal.title}`,
    proposal.body.trim(),
    ...(about.length === 0 ? [] : [`## About\n\n${about.join('\n')}`]),
    ...(sources.length === 0 ? [] : [`## Sources\n\n${sources.join('\n')}`]),
    `_Proposed by ${author} on ${day}._`,
  ];
  return { path, text: `---\n${frontmatter}---\n\n${sections.join('\n\n')}\n` };
};

const applyEditsToBody = (
  path: string,
  text: string,
  edits: readonly TextEdit[],
): ProposalApplication => {
  const split = splitFrontmatter(text);
  if (split.problem !== undefined) {
    return { _tag: 'Conflicted', reason: `${path} has malformed frontmatter: ${split.problem}` };
  }
  const result = applyTextEdits(split.body, edits);
  if (result._tag === 'Conflicted') {
    return { _tag: 'Conflicted', reason: `the edits don't apply to ${path}: ${result.reason}` };
  }
  const header = text
    .split('\n')
    .slice(0, split.bodyFirstLine - 1)
    .join('\n');
  const edited = split.bodyFirstLine === 1 ? result.text : `${header}\n${result.text}`;
  const splitEdited = splitFrontmatter(edited);
  if (splitEdited.bodyFirstLine !== split.bodyFirstLine || splitEdited.body !== result.text) {
    return { _tag: 'Conflicted', reason: `the edits would change the frontmatter of ${path}` };
  }
  return { _tag: 'Changed', changes: [{ path, text: edited }] };
};

const markVerified = (
  path: string,
  text: string,
  options: { readonly date: string; readonly source: ProposalSource },
): ProposalApplication => {
  const key = options.source.config.frontmatterKeys.verified;
  const split = splitFrontmatter(text);
  if (split.problem !== undefined) {
    return { _tag: 'Conflicted', reason: `${path} has malformed frontmatter: ${split.problem}` };
  }
  const existing = dateOf(split.frontmatter[key]);
  if (existing !== undefined && existing >= options.date) {
    return { _tag: 'Unchanged', reason: `${path} was already verified on ${existing}` };
  }
  return { _tag: 'Changed', changes: [{ path, text: setFrontmatterKey(text, key, options.date) }] };
};

const retire = (path: string, text: string, source: ProposalSource): ProposalApplication => {
  const { config } = source;
  const isNote = path.startsWith(`${config.proposals.notesFolder}/`);
  if (isNote && config.proposals.obsoleteNotes === 'delete') {
    return { _tag: 'Changed', changes: [{ path, text: null }] };
  }
  const split = splitFrontmatter(text);
  if (split.problem !== undefined) {
    return { _tag: 'Conflicted', reason: `${path} has malformed frontmatter: ${split.problem}` };
  }
  const key = config.frontmatterKeys.status;
  if (split.frontmatter[key] === config.proposals.archivedStatus) {
    return { _tag: 'Unchanged', reason: `${path} is already ${config.proposals.archivedStatus}` };
  }
  return {
    _tag: 'Changed',
    changes: [{ path, text: setFrontmatterKey(text, key, config.proposals.archivedStatus) }],
  };
};

/**
 * Returns the text with one frontmatter key set, keeping the rest of the frontmatter as written.
 *
 * Expects frontmatter that {@link splitFrontmatter} reads without problems.
 */
const setFrontmatterKey = (text: string, key: string, value: string): string => {
  const split = splitFrontmatter(text);
  if (split.bodyFirstLine === 1) return `---\n${stringify({ [key]: value })}---\n${text}`;
  const lines = text.split('\n');
  const document = parseDocument(lines.slice(1, split.bodyFirstLine - 2).join('\n'));
  document.set(key, value);
  return `---\n${document.toString()}---\n${split.body}`;
};

const dateOf = (value: unknown): string | undefined => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  return undefined;
};

const freeNotePath = (stem: string, source: ProposalSource): string => {
  const isTaken = (path: string) => source.texts.has(path) || source.pathsTaken.has(path);
  if (!isTaken(`${stem}.md`)) return `${stem}.md`;
  for (let suffix = 2; ; suffix++) {
    const path = `${stem}-${suffix}.md`;
    if (!isTaken(path)) return path;
  }
};

const slugOf = (title: string): string => {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .slice(0, SLUG_LENGTH)
    .replaceAll(/^-+|-+$/gu, '');
  return slug === '' ? 'note' : slug;
};

const formatEdits = (edits: readonly TextEdit[]): string =>
  edits
    .map((edit, index) => {
      const fence = fenceFor(`${edit.old}\n${edit.new}`);
      return [
        `Edit ${index + 1}, replacing:`,
        `${fence}\n${edit.old}\n${fence}`,
        'with:',
        `${fence}\n${edit.new}\n${fence}`,
      ].join('\n\n');
    })
    .join('\n\n');

const fenceFor = (text: string): string => {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  return '`'.repeat(Math.max(3, longestRun + 1));
};

const highestLevelOf = (config: ResolvedConfig): Level => {
  const highest = config.levels.at(-1);
  if (highest === undefined) throw new Error('unexpected config without levels');
  return highest;
};

const absurd = (value: never): never => {
  throw new Error(`unexpected value: ${JSON.stringify(value)}`);
};
