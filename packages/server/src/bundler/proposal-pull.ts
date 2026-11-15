import { posix } from 'node:path';

import { Effect, FileSystem, Path, Schema } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

import type {
  InvalidProposalError,
  Proposal,
  StaleCurrentProposal,
  UnsupportedProtocolError,
} from '../protocol/index.ts';
import { buildBundleSetFromTree } from './bundle-set-build.ts';
import { type ConfigLoadError, loadConfig } from './bundler.ts';
import type { InvalidConfigError, ResolvedConfig } from './config.ts';
import type { GitHubError, GitHubRepository } from './github-repository.ts';
import {
  applyProposal,
  conflictNoteOf,
  describeProposal,
  type FileChange,
  type ProposalApplication,
  type ProposalSource,
} from './proposal-apply.ts';
import { acknowledgeProposals, fetchProposals, type ProposalQueueError } from './proposal-queue.ts';
import {
  type ChangeReview,
  formatReview,
  isReviewPassing,
  reviewChanges,
} from './proposal-review.ts';
import { readSourceTree, type SourceTree } from './source-tree.ts';

/**
 * Error for a knowledge base that isn't inside a Git checkout.
 */
export class RepositoryNotFoundError extends Schema.TaggedError<
  RepositoryNotFoundError,
  { readonly brand: unique symbol }
>()('RepositoryNotFoundError', { root: Schema.String }) {
  override get message(): string {
    return `${this.root} isn't inside a Git checkout`;
  }
}

/**
 * What happened to one proposal.
 */
export interface ProposalPullEntry {
  readonly ids: readonly string[];
  readonly description: string;
  /**
   * `planned` is a dry run's outcome for proposals it would open or commit; `failed` ones stay queued for the next
   * run.
   */
  readonly outcome: 'opened' | 'committed' | 'unchanged' | 'dropped' | 'planned' | 'failed';
  readonly detail: string;
  readonly url?: string;
  readonly review?: ChangeReview;
}

/**
 * Where proposals are pulled from and applied to.
 */
export interface ProposalPullOptions {
  /** Path of the config file, relative to the working directory. */
  readonly configPath: string;
  /** URL of the Kemian server. */
  readonly serverUrl: string;
  readonly proposalsToken: string;
  /** Repository to open pull requests on, and the commit the local checkout is at; omit for a dry run. */
  readonly github?: { readonly repository: GitHubRepository; readonly base: string };
  readonly fetch?: typeof fetch;
}

/**
 * Status context the review's result is posted under.
 */
export const PROPOSAL_STATUS_CONTEXT = 'kemian/check';

const MAX_BODY_LENGTH = 60_000;

/**
 * Pulls pending proposals from a Kemian server and applies each to the local checkout.
 *
 * Each proposal becomes a pull request on its own branch, except `current` verdicts, which are committed together to
 * the default branch when GitHub allows it. A proposal that no longer applies becomes a note describing it. Every
 * handled proposal is acknowledged right after, so a failure part way leaves the rest for the next run. Without
 * `github`, it's a dry run: nothing is written or acknowledged.
 */
export const pullProposals = (
  options: ProposalPullOptions,
): Effect.Effect<
  readonly ProposalPullEntry[],
  | ConfigLoadError
  | InvalidConfigError
  | PlatformError
  | ProposalQueueError
  | UnsupportedProtocolError
  | InvalidProposalError
  | GitHubError
  | RepositoryNotFoundError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const { config, root } = yield* loadConfig(options.configPath);
    const tree = yield* readSourceTree(root);
    const repositoryPrefix = yield* repositoryPrefixOf(root, {
      isRequired: options.github !== undefined,
    });
    const queue = {
      url: options.serverUrl,
      token: options.proposalsToken,
      ...fetchOption(options),
    };
    const { proposals } = yield* fetchProposals(queue);
    const source = sourceOf(tree, config);
    const target =
      options.github === undefined
        ? undefined
        : { ...options.github, defaultBranch: yield* options.github.repository.defaultBranch };
    const toRepositoryPath = (relative: string) =>
      repositoryPrefix === '' ? relative : posix.join(repositoryPrefix, relative);
    const acknowledge = (ids: readonly string[]) =>
      target === undefined ? Effect.void : acknowledgeProposals({ ...queue, ids });

    const entries: ProposalPullEntry[] = [];
    const pathsTaken = new Set<string>();
    const verdictsCurrent = proposals.filter(isCurrentVerdict);
    for (const proposal of proposals.filter((each) => !isCurrentVerdict(each))) {
      const planned = yield* Effect.promise(() =>
        planPullRequest(proposal, { tree, config, source: { ...source, pathsTaken } }),
      );
      if (planned._tag === 'Unchanged') {
        entries.push({
          ids: [proposal.id],
          description: describeProposal(proposal),
          outcome: 'unchanged',
          detail: planned.reason,
        });
        yield* acknowledge([proposal.id]);
        continue;
      }
      for (const change of planned.changes) pathsTaken.add(change.path);
      if (target === undefined) {
        entries.push({ ...planned.entry, outcome: 'planned' });
        continue;
      }
      const opened = yield* openPullRequest(target, {
        branch: `kemian/proposal-${proposal.createdAt.slice(0, 10)}-${proposal.id.slice(0, 12)}`,
        title: planned.entry.description,
        message: `${planned.entry.description}\n\nKemian proposal ${proposal.id}`,
        body: planned.body,
        changes: planned.changes.map((change) => ({
          ...change,
          path: toRepositoryPath(change.path),
        })),
        review: planned.review,
      }).pipe(asOutcome);
      if (opened._tag === 'Failed') {
        entries.push({ ...planned.entry, outcome: 'failed', detail: opened.reason });
        continue;
      }
      entries.push({ ...planned.entry, url: opened.value });
      yield* acknowledge([proposal.id]);
    }

    if (verdictsCurrent.length > 0) {
      const batch = yield* Effect.promise(() =>
        planVerdictsCurrent(verdictsCurrent, {
          tree,
          config,
          source: { ...source, pathsTaken },
        }),
      );
      entries.push(...batch.entriesSkipped);
      if (batch.changes.length > 0) {
        const entry = {
          ids: batch.idsApplied,
          description: `Mark ${batch.changes.length} file(s) verified`,
          detail: batch.detail,
          review: batch.review,
        };
        if (target === undefined) {
          entries.push({ ...entry, outcome: 'planned' });
        } else {
          const landed = yield* landVerdicts(target, {
            changes: batch.changes.map((change) => ({
              ...change,
              path: toRepositoryPath(change.path),
            })),
            batch,
            description: entry.description,
          }).pipe(asOutcome);
          if (landed._tag === 'Failed') {
            entries.push({ ...entry, outcome: 'failed', detail: landed.reason });
            return entries;
          }
          entries.push({ ...entry, ...landed.value });
        }
      }
      if (target !== undefined) yield* acknowledge(verdictsCurrent.map((proposal) => proposal.id));
    }
    return entries;
  });

/**
 * Returns whether any proposal of a pull failed and stays queued.
 */
export const hasFailures = (entries: readonly ProposalPullEntry[]): boolean =>
  entries.some((entry) => entry.outcome === 'failed');

/**
 * Formats a pull's entries as Markdown, e.g. for a GitHub Actions job summary.
 */
export const formatPullReport = (entries: readonly ProposalPullEntry[]): string => {
  if (entries.length === 0) return 'No pending proposals.';
  const lines = entries.map((entry) => {
    const check =
      entry.review === undefined ? '' : isReviewPassing(entry.review) ? ' ✅' : ' ⚠️ check failed';
    const link = entry.url === undefined ? '' : ` ${entry.url}`;
    return `- **${entry.outcome}**${check}: ${entry.description}: ${entry.detail}${link}`;
  });
  return [`${entries.length} proposal(s):`, ...lines].join('\n');
};

interface PlannedPullRequest {
  readonly _tag: 'Changed';
  readonly changes: readonly FileChange[];
  readonly review: ChangeReview;
  readonly body: string;
  readonly entry: Omit<ProposalPullEntry, 'outcome'> & { readonly outcome: 'opened' };
}

const planPullRequest = async (
  proposal: Proposal,
  context: {
    readonly tree: SourceTree;
    readonly config: ResolvedConfig;
    readonly source: ProposalSource;
  },
): Promise<PlannedPullRequest | { readonly _tag: 'Unchanged'; readonly reason: string }> => {
  const application = await applyProposal(proposal, context.source);
  if (application._tag === 'Unchanged') return application;
  const conflict = application._tag === 'Conflicted' ? application.reason : undefined;
  const applied: ProposalApplication =
    conflict === undefined
      ? application
      : await applyProposal(conflictNoteOf(proposal, conflict), context.source);
  if (applied._tag !== 'Changed') throw new Error('unexpected note that does not apply');
  const edits =
    conflict === undefined &&
    (proposal.kind === 'edit' || (proposal.kind === 'stale' && proposal.verdict === 'outdated'))
      ? { path: proposal.path, edits: proposal.edits }
      : undefined;
  const review = reviewChanges({
    tree: context.tree,
    config: context.config,
    changes: applied.changes,
    ...(edits === undefined ? {} : { edits }),
  });
  const description =
    conflict === undefined
      ? describeProposal(proposal)
      : `Conflicted: ${describeProposal(proposal)}`;
  const detail =
    conflict === undefined ? changeSummaryOf(applied.changes) : `${conflict}; added a note instead`;
  return {
    _tag: 'Changed',
    changes: applied.changes,
    review,
    body: pullRequestBodyOf(proposal, { detail, review }),
    entry: { ids: [proposal.id], description, outcome: 'opened', detail, review },
  };
};

const planVerdictsCurrent = async (
  verdicts: readonly StaleCurrentProposal[],
  context: {
    readonly tree: SourceTree;
    readonly config: ResolvedConfig;
    readonly source: ProposalSource;
  },
) => {
  const texts = new Map(context.source.texts);
  const changed = new Map<string, FileChange>();
  const entriesSkipped: ProposalPullEntry[] = [];
  const idsApplied: string[] = [];
  for (const verdict of verdicts) {
    const application = await applyProposal(verdict, { ...context.source, texts });
    const description = describeProposal(verdict);
    switch (application._tag) {
      case 'Changed':
        for (const change of application.changes) {
          changed.set(change.path, change);
          if (change.text !== null) texts.set(change.path, change.text);
        }
        idsApplied.push(verdict.id);
        break;
      case 'Unchanged':
        entriesSkipped.push({
          ids: [verdict.id],
          description,
          outcome: 'unchanged',
          detail: application.reason,
        });
        break;
      case 'Conflicted':
        entriesSkipped.push({
          ids: [verdict.id],
          description,
          outcome: 'dropped',
          detail: application.reason,
        });
        break;
      default:
        throw new Error('unexpected proposal application');
    }
  }
  const changes = [...changed.values()];
  const day =
    verdicts
      .map((verdict) => verdict.verified)
      .toSorted()
      .at(-1) ?? '';
  return {
    changes,
    idsApplied,
    entriesSkipped,
    day,
    detail: `Verified ${changes.map((change) => change.path).join(', ')}.`,
    review: reviewChanges({ tree: context.tree, config: context.config, changes }),
  };
};

const openPullRequest = (
  target: {
    readonly repository: GitHubRepository;
    readonly base: string;
    readonly defaultBranch: string;
  },
  options: {
    readonly branch: string;
    readonly title: string;
    readonly message: string;
    readonly body: string;
    readonly changes: readonly FileChange[];
    readonly review: ChangeReview;
  },
): Effect.Effect<string, GitHubError> =>
  Effect.gen(function* () {
    const { repository } = target;
    const sha = yield* repository.commit({
      parent: target.base,
      message: options.message,
      changes: options.changes,
    });
    yield* repository.pushBranch(options.branch, sha);
    const url = yield* repository.openPullRequest({
      branch: options.branch,
      base: target.defaultBranch,
      title: options.title,
      body: truncate(options.body),
    });
    const isPassing = isReviewPassing(options.review);
    yield* repository.setStatus({
      sha,
      context: PROPOSAL_STATUS_CONTEXT,
      state: isPassing ? 'success' : 'failure',
      description: isPassing
        ? 'No new errors and no privacy markup changes.'
        : 'Changes what a level may see or adds errors: review deliberately.',
    });
    return url;
  });

const landVerdicts = (
  target: {
    readonly repository: GitHubRepository;
    readonly base: string;
    readonly defaultBranch: string;
  },
  options: {
    readonly changes: readonly FileChange[];
    readonly batch: {
      readonly day: string;
      readonly detail: string;
      readonly review: ChangeReview;
      readonly idsApplied: readonly string[];
    };
    readonly description: string;
  },
): Effect.Effect<Pick<ProposalPullEntry, 'outcome' | 'detail' | 'url'>, GitHubError> =>
  Effect.gen(function* () {
    const { batch, changes } = options;
    const message = `${options.description}\n\n${batch.detail}`;
    const sha = yield* target.repository.commit({ parent: target.base, message, changes });
    const isCommitted =
      isReviewPassing(batch.review) &&
      (yield* target.repository.fastForward(target.defaultBranch, sha));
    if (isCommitted) {
      return {
        outcome: 'committed',
        detail: `${batch.detail} Committed to ${target.defaultBranch}.`,
      };
    }
    const url = yield* openPullRequest(target, {
      branch: `kemian/verified-${batch.day}-${(batch.idsApplied[0] ?? '').slice(0, 12)}`,
      title: options.description,
      message,
      body: [
        batch.detail,
        `${target.defaultBranch} refused a direct commit, or the check failed, so this needs a merge.`,
        formatReview(batch.review),
      ].join('\n\n'),
      changes,
      review: batch.review,
    });
    return { outcome: 'opened', detail: batch.detail, url };
  });

const asOutcome = <A>(
  effect: Effect.Effect<A, GitHubError>,
): Effect.Effect<
  | { readonly _tag: 'Done'; readonly value: A }
  | { readonly _tag: 'Failed'; readonly reason: string }
> =>
  effect.pipe(
    Effect.map((value) => ({ _tag: 'Done' as const, value })),
    Effect.catchTag('GitHubError', (error) =>
      Effect.succeed({ _tag: 'Failed' as const, reason: error.message }),
    ),
  );

const pullRequestBodyOf = (
  proposal: Proposal,
  options: { readonly detail: string; readonly review: ChangeReview },
): string => {
  const author =
    proposal.author.name === undefined
      ? `\`${proposal.author.identity}\``
      : `${proposal.author.name} (\`${proposal.author.identity}\`)`;
  const build = proposal.kind === 'note' ? '' : `, having read build \`${proposal.build}\``;
  const why =
    proposal.kind === 'edit'
      ? [`> ${proposal.reason.replaceAll('\n', '\n> ')}`]
      : proposal.kind === 'stale' && proposal.note !== undefined
        ? [`> ${proposal.note.replaceAll('\n', '\n> ')}`]
        : [];
  return [
    `Proposed by ${author} on ${proposal.createdAt.slice(0, 10)} through Kemian${build}.`,
    ...why,
    options.detail,
    formatReview(options.review),
    `---\nProposal \`${proposal.id}\`, opened by \`kemian proposals pull\`.`,
  ].join('\n\n');
};

const changeSummaryOf = (changes: readonly FileChange[]): string =>
  changes
    .map((change) => (change.text === null ? `Deletes ${change.path}.` : `Changes ${change.path}.`))
    .join(' ');

const sourceOf = (tree: SourceTree, config: ResolvedConfig): Omit<ProposalSource, 'pathsTaken'> => {
  const { bundleSet } = buildBundleSetFromTree({
    tree,
    config,
    build: { id: 'pull', createdAt: new Date().toISOString() },
  });
  const highest = bundleSet.bundles.at(-1);
  return {
    config,
    texts: tree.markdown,
    highestContents: new Map((highest?.files ?? []).map((file) => [file.path, file.content])),
  };
};

const repositoryPrefixOf = (root: string, options: { readonly isRequired: boolean }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (let folder = path.resolve(root); ; folder = path.dirname(folder)) {
      if (yield* fileSystem.exists(path.join(folder, '.git'))) {
        return path.relative(folder, path.resolve(root)).split(path.sep).join('/');
      }
      if (path.dirname(folder) === folder) break;
    }
    if (options.isRequired) return yield* new RepositoryNotFoundError({ root });
    return '';
  });

const isCurrentVerdict = (proposal: Proposal): proposal is StaleCurrentProposal =>
  proposal.kind === 'stale' && proposal.verdict === 'current';

const fetchOption = (options: ProposalPullOptions) =>
  options.fetch === undefined ? {} : { fetch: options.fetch };

const truncate = (body: string): string =>
  body.length <= MAX_BODY_LENGTH ? body : `${body.slice(0, MAX_BODY_LENGTH)}\n\n…(truncated)`;
