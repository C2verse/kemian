import type { BundleFile, BundleSet, Level, TextEdit } from '../protocol/index.ts';
import { buildBundleSetFromTree } from './bundle-set-build.ts';
import type { ResolvedConfig } from './config.ts';
import { splitFrontmatter } from './frontmatter.ts';
import { type MarkupLine, parseMarkup } from './markup.ts';
import type { Problem } from './problem.ts';
import type { FileChange } from './proposal-apply.ts';
import { makeSourceTree, type SourceTree } from './source-tree.ts';

/**
 * How one file changes in one level's bundle.
 */
export interface FileDiff {
  readonly path: string;
  readonly status: 'added' | 'removed' | 'changed';
  readonly linesGained: readonly string[];
  readonly linesLost: readonly string[];
}

/**
 * How one level's bundle changes.
 */
export interface LevelDiff {
  readonly level: Level;
  readonly files: readonly FileDiff[];
}

/**
 * Review of file changes before they're proposed to the author.
 */
export interface ChangeReview {
  /** Problems `kemian check` reports after the changes but not before. */
  readonly problemsNew: readonly Problem[];
  /** Changes to what a level may see: privacy markup, visibility, or files a lower level gains. */
  readonly markupChanges: readonly string[];
  /** What each level below the highest gains or loses. */
  readonly levels: readonly LevelDiff[];
}

const REVIEW_BUILD = { id: 'review', createdAt: '2000-01-01T00:00:00Z' };

/**
 * Reviews file changes against the source they apply to.
 *
 * Given the edits that made the changes, it also flags any edit whose snippets touch a level tag or HTML comment,
 * which catches content moved across a tag that the tags alone don't show.
 */
export const reviewChanges = (options: {
  readonly tree: SourceTree;
  readonly config: ResolvedConfig;
  readonly changes: readonly FileChange[];
  readonly edits?: { readonly path: string; readonly edits: readonly TextEdit[] };
}): ChangeReview => {
  const { tree, config, changes } = options;
  const treeChanged = applyChangesToTree(tree, changes);
  const before = buildBundleSetFromTree({ tree, config, build: REVIEW_BUILD });
  const after = buildBundleSetFromTree({ tree: treeChanged, config, build: REVIEW_BUILD });
  const problemKeysBefore = new Set(before.problems.map(problemKeyOf));
  const lowerLevels = config.levels.slice(0, -1);
  const levels = lowerLevels.map((level) => ({
    level,
    files: diffBundles(filesOf(before.bundleSet, level), filesOf(after.bundleSet, level)),
  }));
  return {
    problemsNew: after.problems.filter((problem) => !problemKeysBefore.has(problemKeyOf(problem))),
    markupChanges: [
      ...changes.flatMap((change) => markupChangesOf(change, { tree, config })),
      ...(options.edits === undefined ? [] : editMarkupChangesOf(options.edits, config.levels)),
      ...levels.flatMap(({ level, files }) =>
        files
          .filter((file) => file.status === 'added')
          .map((file) => `${level} gains ${file.path}, which it didn't see before`),
      ),
    ],
    levels,
  };
};

/**
 * Returns whether a review passes: no new errors and no change to what a level may see.
 */
export const isReviewPassing = (review: ChangeReview): boolean =>
  review.markupChanges.length === 0 &&
  !review.problemsNew.some((problem) => problem.severity === 'error');

/**
 * Formats a review as Markdown for a pull request.
 */
export const formatReview = (review: ChangeReview): string => {
  const verdict = isReviewPassing(review)
    ? '**Check passed:** no new errors, and no change to the privacy markup.'
    : '**Check failed.** Merging this needs a deliberate decision.';
  const markup = review.markupChanges.map((change) => `- ⚠️ ${change}`);
  const problems = review.problemsNew.map(
    (problem) =>
      `- ${problem.severity}: \`${problem.path}\`${problem.line === undefined ? '' : ` line ${problem.line}`}: ${problem.message}`,
  );
  const levels = review.levels.map(formatLevelDiff);
  return [
    verdict,
    ...(markup.length === 0 ? [] : ['**Privacy markup changes:**', markup.join('\n')]),
    ...(problems.length === 0
      ? []
      : ['**New problems from `kemian check`:**', problems.join('\n')]),
    ...(levels.length === 0 ? [] : ['### What Each Level Gains or Loses', ...levels]),
  ].join('\n\n');
};

/**
 * Returns a source tree with file changes applied.
 */
export const applyChangesToTree = (
  tree: SourceTree,
  changes: readonly FileChange[],
): SourceTree => {
  const texts = new Map<string, string>(
    [...tree.files].map((path) => [path, tree.markdown.get(path) ?? '']),
  );
  for (const change of changes) {
    if (change.text === null) texts.delete(change.path);
    else texts.set(change.path, change.text);
  }
  return makeSourceTree(Object.fromEntries(texts));
};

const markupChangesOf = (
  change: FileChange,
  options: { readonly tree: SourceTree; readonly config: ResolvedConfig },
): string[] => {
  const textBefore = options.tree.markdown.get(change.path);
  if (textBefore === undefined || change.text === null) return [];
  const before = splitFrontmatter(textBefore);
  const after = splitFrontmatter(change.text);
  const key = options.config.frontmatterKeys.visibility;
  const found: string[] = [];
  if (JSON.stringify(before.frontmatter[key]) !== JSON.stringify(after.frontmatter[key])) {
    found.push(`${change.path} changes its ${key}`);
  }
  const { levels } = options.config;
  const isTagsChanged =
    markupTokensOf(before.body, levels).join('\n') !==
    markupTokensOf(after.body, levels).join('\n');
  const isStructureChanged =
    markupStructureOf(before.body, levels).join('\n') !==
    markupStructureOf(after.body, levels).join('\n');
  if (isTagsChanged || isStructureChanged) {
    found.push(`${change.path} adds, removes, or changes a level tag or HTML comment`);
  }
  return found;
};

const editMarkupChangesOf = (
  edits: { readonly path: string; readonly edits: readonly TextEdit[] },
  levels: readonly Level[],
): string[] =>
  edits.edits.flatMap((edit, index) =>
    markupTokensOf(edit.old, levels).length > 0 || markupTokensOf(edit.new, levels).length > 0
      ? [`edit ${index + 1} to ${edits.path} touches a level tag or HTML comment`]
      : [],
  );

const markupPartsOf = (line: MarkupLine): string[] =>
  line.parts.flatMap((part) => {
    switch (part._tag) {
      case 'Text':
        return [];
      case 'Comment':
        return ['comment'];
      case 'Span':
        return [`span ${part.level} ${part.open}`];
      default:
        throw new Error('unexpected markup part');
    }
  });

/**
 * Returns the markup the parser sees, in order, so content that turns code or stops being code shows as a change.
 */
const markupStructureOf = (body: string, levels: readonly Level[]): string[] => {
  return parseMarkup(body, { levels }).nodes.flatMap((node) => {
    switch (node._tag) {
      case 'Line':
        return markupPartsOf(node.line);
      case 'Block':
        return [
          `block ${node.level} ${node.open}`,
          ...node.lines.flatMap(markupPartsOf),
          'end block',
        ];
      default:
        throw new Error('unexpected markup node');
    }
  });
};

const markupTokensOf = (body: string, levels: readonly Level[]): string[] => {
  const names = levels.map((level) => level.replaceAll('-', '\\-')).join('|');
  const pattern = new RegExp(`</?(?:${names})\\b[^>]*>|<!--|-->`, 'giu');
  return [...body.matchAll(pattern)].map((match) => match[0].toLowerCase());
};

const filesOf = (bundleSet: BundleSet, level: Level): ReadonlyMap<string, BundleFile> =>
  new Map(
    (bundleSet.bundles.find((bundle) => bundle.level === level)?.files ?? []).map((file) => [
      file.path,
      file,
    ]),
  );

const diffBundles = (
  before: ReadonlyMap<string, BundleFile>,
  after: ReadonlyMap<string, BundleFile>,
): FileDiff[] => {
  const paths = [...new Set([...before.keys(), ...after.keys()])].toSorted();
  return paths.flatMap((path): FileDiff[] => {
    const linesBefore = linesOf(before.get(path));
    const linesAfter = linesOf(after.get(path));
    const linesGained = subtractLines(linesAfter, linesBefore);
    const linesLost = subtractLines(linesBefore, linesAfter);
    if (!before.has(path)) return [{ path, status: 'added', linesGained, linesLost }];
    if (!after.has(path)) return [{ path, status: 'removed', linesGained, linesLost }];
    if (linesGained.length === 0 && linesLost.length === 0) return [];
    return [{ path, status: 'changed', linesGained, linesLost }];
  });
};

const linesOf = (file: BundleFile | undefined): string[] => {
  if (file === undefined) return [];
  const metadata = (
    [
      ['title', file.title],
      ['summary', file.summary],
      ['visibility', file.visibility],
      ['updated', file.updated],
      ['verified', file.verified],
      ...Object.entries(file.meta ?? {}).map(
        ([key, value]) => [key, JSON.stringify(value)] as const,
      ),
    ] as const
  )
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `[${key}] ${value}`);
  return [...metadata, ...file.content.split('\n')];
};

const subtractLines = (lines: readonly string[], removed: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  for (const line of removed) counts.set(line, (counts.get(line) ?? 0) + 1);
  return lines.filter((line) => {
    const count = counts.get(line) ?? 0;
    if (count === 0) return true;
    counts.set(line, count - 1);
    return false;
  });
};

const formatLevelDiff = ({ level, files }: LevelDiff): string => {
  if (files.length === 0) return `**${level}:** no change.`;
  const entries = files.map((file) => {
    const lines = [
      ...file.linesLost.map((line) => `- ${line}`),
      ...file.linesGained.map((line) => `+ ${line}`),
    ];
    const fence = '`'.repeat(Math.max(3, longestBacktickRunOf(lines.join('\n')) + 1));
    return `- \`${file.path}\` ${file.status}\n\n${fence}diff\n${lines.join('\n')}\n${fence}`;
  });
  return [`**${level}:**`, ...entries].join('\n\n');
};

const longestBacktickRunOf = (text: string): number =>
  Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));

const problemKeyOf = (problem: Problem): string =>
  JSON.stringify([problem.path, problem.severity, problem.message]);
