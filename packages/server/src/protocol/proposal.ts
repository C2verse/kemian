import { Effect, Schema, SchemaIssue } from 'effect';

import { FilePath } from './bundle.ts';
import { PROTOCOL_VERSION, UnsupportedProtocolError } from './protocol-version.ts';

/**
 * Size limits of a proposal, enforced wherever one is decoded.
 */
export const PROPOSAL_LIMITS = {
  /** Characters of a title. */
  titleLength: 200,
  /** Characters of any other text field. */
  textLength: 20_000,
  /** Edits of one proposal. */
  edits: 20,
  /** Entries of `about` or `sources`. */
  references: 20,
} as const;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const Text = Schema.String.check(Schema.isMaxLength(PROPOSAL_LIMITS.textLength));
const NonEmptyText = Schema.NonEmptyString.check(Schema.isMaxLength(PROPOSAL_LIMITS.textLength));

/**
 * ID of a proposal, unique per server.
 */
export const ProposalId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/u)).annotate({
  identifier: 'ProposalId',
});
export type ProposalId = typeof ProposalId.Type;

/**
 * Exact replacement of one snippet of a file's body.
 */
export const TextEdit = Schema.Struct({
  old: NonEmptyText,
  new: Text,
}).annotate({ identifier: 'TextEdit' });
export type TextEdit = typeof TextEdit.Type;

/**
 * Identity that made a proposal, keyed like `github:12345`.
 */
export const ProposalAuthor = Schema.Struct({
  identity: Schema.NonEmptyString,
  name: Schema.optionalKey(Schema.String),
}).annotate({ identifier: 'ProposalAuthor' });
export type ProposalAuthor = typeof ProposalAuthor.Type;

const TextEdits = Schema.NonEmptyArray(TextEdit).check(Schema.isMaxLength(PROPOSAL_LIMITS.edits));

const proposalFields = {
  protocol: Schema.Literal(1),
  id: ProposalId,
  createdAt: Schema.String.check(Schema.isPattern(TIMESTAMP)),
  author: ProposalAuthor,
};

const fileFields = {
  path: FilePath,
  /** ID of the build the agent read the file in. */
  build: Schema.NonEmptyString,
};

/**
 * Proposal of a new note in the notes folder.
 */
export const NoteProposal = Schema.Struct({
  ...proposalFields,
  kind: Schema.Literal('note'),
  title: Schema.NonEmptyString.check(
    Schema.isMaxLength(PROPOSAL_LIMITS.titleLength),
    Schema.isPattern(/^[^\n\r]*$/u),
  ),
  body: NonEmptyText,
  about: Schema.optionalKey(
    Schema.Array(FilePath).check(Schema.isMaxLength(PROPOSAL_LIMITS.references)),
  ),
  sources: Schema.optionalKey(
    Schema.Array(NonEmptyText).check(Schema.isMaxLength(PROPOSAL_LIMITS.references)),
  ),
}).annotate({ identifier: 'NoteProposal' });
export type NoteProposal = typeof NoteProposal.Type;

/**
 * Proposal of exact replacements in one file.
 */
export const EditProposal = Schema.Struct({
  ...proposalFields,
  ...fileFields,
  kind: Schema.Literal('edit'),
  edits: TextEdits,
  reason: NonEmptyText,
}).annotate({ identifier: 'EditProposal' });
export type EditProposal = typeof EditProposal.Type;

/**
 * Verdict that a file is still true, which sets its verified date.
 */
export const StaleCurrentProposal = Schema.Struct({
  ...proposalFields,
  ...fileFields,
  kind: Schema.Literal('stale'),
  verdict: Schema.Literal('current'),
  /** Date the file was verified, `YYYY-MM-DD`. */
  verified: Schema.String.check(Schema.isPattern(CALENDAR_DATE)),
  note: Schema.optionalKey(Text),
}).annotate({ identifier: 'StaleCurrentProposal' });
export type StaleCurrentProposal = typeof StaleCurrentProposal.Type;

/**
 * Verdict that a file is outdated, with the edits that bring it up to date.
 */
export const StaleOutdatedProposal = Schema.Struct({
  ...proposalFields,
  ...fileFields,
  kind: Schema.Literal('stale'),
  verdict: Schema.Literal('outdated'),
  edits: TextEdits,
  note: Schema.optionalKey(Text),
}).annotate({ identifier: 'StaleOutdatedProposal' });
export type StaleOutdatedProposal = typeof StaleOutdatedProposal.Type;

/**
 * Verdict that a file is obsolete, tied to the content the agent read.
 */
export const StaleObsoleteProposal = Schema.Struct({
  ...proposalFields,
  ...fileFields,
  kind: Schema.Literal('stale'),
  verdict: Schema.Literal('obsolete'),
  /** {@link contentHashOf} the file's content in the highest level's bundle of `build`. */
  contentHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  note: Schema.optionalKey(Text),
}).annotate({ identifier: 'StaleObsoleteProposal' });
export type StaleObsoleteProposal = typeof StaleObsoleteProposal.Type;

/**
 * Change an agent proposes to the knowledge base, applied to the source only after review.
 */
export const Proposal = Schema.Union([
  NoteProposal,
  EditProposal,
  StaleCurrentProposal,
  StaleOutdatedProposal,
  StaleObsoleteProposal,
]).annotate({ identifier: 'Proposal' });
export type Proposal = typeof Proposal.Type;

/**
 * Pending proposals, as a server lists them.
 */
export const ProposalList = Schema.Struct({
  protocol: Schema.Literal(1),
  proposals: Schema.Array(Proposal),
}).annotate({ identifier: 'ProposalList' });
export type ProposalList = typeof ProposalList.Type;

/**
 * Proposals a client has handled and the server may drop.
 */
export const ProposalAcknowledgement = Schema.Struct({
  ids: Schema.Array(ProposalId).check(Schema.isMaxLength(1000)),
}).annotate({ identifier: 'ProposalAcknowledgement' });
export type ProposalAcknowledgement = typeof ProposalAcknowledgement.Type;

/**
 * Error for input that doesn't match the proposal schema.
 */
export class InvalidProposalError extends Schema.TaggedError<
  InvalidProposalError,
  { readonly brand: unique symbol }
>()('InvalidProposalError', { issues: Schema.String }) {
  override get message(): string {
    return `invalid proposal: ${this.issues}`;
  }
}

const ProtocolHeader = Schema.Struct({ protocol: Schema.Unknown });
const formatIssue = SchemaIssue.makeFormatterDefault();

/**
 * Decodes a proposal list from untrusted JSON, dropping fields this version doesn't know.
 */
export const decodeProposalList = (
  input: unknown,
): Effect.Effect<ProposalList, UnsupportedProtocolError | InvalidProposalError> =>
  Effect.gen(function* () {
    const header = yield* Schema.decodeUnknownEffect(ProtocolHeader)(input).pipe(
      Effect.mapError((error) => new InvalidProposalError({ issues: formatIssue(error.issue) })),
    );
    if (header.protocol !== PROTOCOL_VERSION) {
      return yield* new UnsupportedProtocolError({ version: header.protocol });
    }
    return yield* Schema.decodeUnknownEffect(ProposalList)(input).pipe(
      Effect.mapError((error) => new InvalidProposalError({ issues: formatIssue(error.issue) })),
    );
  });

/**
 * Result of applying text edits: the edited text, or why the edits don't apply.
 */
export type TextEditResult =
  | { readonly _tag: 'Applied'; readonly text: string }
  | { readonly _tag: 'Conflicted'; readonly reason: string };

/**
 * Applies exact replacements to a text.
 *
 * Each `old` must occur exactly once in the original text, and no two may overlap; otherwise nothing is applied.
 */
export const applyTextEdits = (text: string, edits: readonly TextEdit[]): TextEditResult => {
  const located: { readonly start: number; readonly end: number; readonly edit: TextEdit }[] = [];
  for (const [index, edit] of edits.entries()) {
    const numOccurrences = countOccurrences(text, edit.old);
    if (numOccurrences !== 1) {
      return {
        _tag: 'Conflicted',
        reason: `edit ${index + 1}: \`old\` occurs ${numOccurrences} times, not exactly once`,
      };
    }
    const start = text.indexOf(edit.old);
    located.push({ start, end: start + edit.old.length, edit });
  }
  const sorted = located.toSorted((a, b) => a.start - b.start);
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous !== undefined && current !== undefined && current.start < previous.end) {
      return { _tag: 'Conflicted', reason: 'two edits overlap' };
    }
  }
  let result = text;
  for (const { start, end, edit } of sorted.toReversed()) {
    result = result.slice(0, start) + edit.new + result.slice(end);
  }
  return { _tag: 'Applied', text: result };
};

/**
 * Returns the SHA-256 of a file's content as lowercase hex.
 */
export const contentHashOf = async (content: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const countOccurrences = (text: string, snippet: string): number => {
  let count = 0;
  for (let index = text.indexOf(snippet); index !== -1; index = text.indexOf(snippet, index + 1)) {
    count++;
  }
  return count;
};
