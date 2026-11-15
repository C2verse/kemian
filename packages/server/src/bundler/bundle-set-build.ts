import { posix } from 'node:path';

import picomatch from 'picomatch';

import type {
  BuildInfo,
  Bundle,
  BundleFile,
  BundleFolder,
  BundleSet,
  Level,
} from '../protocol/index.ts';
import { buildSearchIndex } from '../search/index.ts';
import type { ResolvedConfig } from './config.ts';
import { type FrontmatterSplit, splitFrontmatter } from './frontmatter.ts';
import { extractHeading1, extractLinkTargets } from './markdown.ts';
import { type MarkupDocument, parseMarkup, renderMarkup } from './markup.ts';
import { type Problem, ProblemCollector } from './problem.ts';
import type { SourceTree } from './source-tree.ts';
import { parentFolderOf, VisibilityResolver } from './visibility.ts';

/**
 * Bundle set built from a knowledge base, with the problems found along the way.
 */
export interface BundleSetBuildResult {
  readonly bundleSet: BundleSet;
  readonly problems: readonly Problem[];
}

/**
 * Builds the bundle of every configured level from a knowledge base.
 *
 * Files with errors are left out of every bundle below the highest level.
 */
export const buildBundleSetFromTree = (options: {
  readonly tree: SourceTree;
  readonly config: ResolvedConfig;
  readonly build: BuildInfo;
}): BundleSetBuildResult => new BundleSetBuilder(options).build();

interface SourceDocument {
  readonly path: string;
  readonly split: FrontmatterSplit;
  readonly markup: MarkupDocument;
  readonly summary: MarkupDocument | undefined;
  readonly title: MarkupDocument | undefined;
  readonly visibility: Level;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const URL_WITH_SCHEME = /^[a-z][a-z0-9+.-]*:/u;

class BundleSetBuilder {
  readonly #tree: SourceTree;
  readonly #config: ResolvedConfig;
  readonly #buildInfo: BuildInfo;
  readonly #problems = new ProblemCollector();
  readonly #splits = new Map<string, FrontmatterSplit>();
  readonly #filterResults = new Map<string, boolean>();
  readonly #documents = new Map<string, SourceDocument>();
  readonly #pathsWithOwnErrors = new Set<string>();
  readonly #visibility: VisibilityResolver;
  readonly #isIncluded: (path: string) => boolean;

  constructor(options: {
    readonly tree: SourceTree;
    readonly config: ResolvedConfig;
    readonly build: BuildInfo;
  }) {
    this.#tree = options.tree;
    this.#config = options.config;
    this.#buildInfo = options.build;
    this.#visibility = new VisibilityResolver({
      tree: this.#tree,
      levels: this.#config.levels,
      defaultVisibility: this.#config.defaultVisibility,
      key: this.#config.frontmatterKeys.visibility,
      frontmatterOf: (path) => this.#splitOf(path),
      problems: this.#problems,
    });
    this.#isIncluded = makePathMatcher(this.#config);
  }

  build(): BundleSetBuildResult {
    const documents = [...this.#tree.markdown.keys()]
      .filter(this.#isIncluded)
      .toSorted()
      .map((path) => this.#analyze(path));
    for (const document of documents) {
      this.#documents.set(document.path, document);
      if (this.#problems.hasErrorsIn(document.path)) this.#pathsWithOwnErrors.add(document.path);
    }
    for (const document of documents) this.#checkLinks(document);

    const [lowest, ...rest] = this.#config.levels;
    if (lowest === undefined) throw new Error('unexpected config without levels');
    const bundleSet: BundleSet = {
      protocol: 1,
      build: this.#buildInfo,
      bundles: [
        this.#bundleFor(lowest, documents),
        ...rest.map((level) => this.#bundleFor(level, documents)),
      ],
    };
    return { bundleSet, problems: this.#problems.problems };
  }

  #analyze(path: string): SourceDocument {
    const split = this.#splitOf(path);
    if (split.problem !== undefined) {
      this.#problems.add({ path, line: 1, severity: 'error', message: split.problem });
    }
    const markup = parseMarkup(split.body, {
      levels: this.#config.levels,
      firstLine: split.bodyFirstLine,
    });
    for (const problem of markup.problems) this.#problems.add({ path, ...problem });

    const keys = this.#config.frontmatterKeys;
    return {
      path,
      split,
      markup,
      summary: this.#parseInlineField(path, split.frontmatter, keys.summary),
      title: this.#parseInlineField(path, split.frontmatter, keys.title),
      visibility: this.#visibility.ofFile(path),
    };
  }

  #parseInlineField(
    path: string,
    frontmatter: Readonly<Record<string, unknown>>,
    key: string,
  ): MarkupDocument | undefined {
    const value = frontmatter[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.includes('\n')) {
      this.#problems.add({
        path,
        line: 1,
        severity: 'error',
        message: `${key} must be one line of text`,
      });
      return undefined;
    }
    const document = parseMarkup(value, { levels: this.#config.levels });
    for (const problem of document.problems) {
      this.#problems.add({
        path,
        line: 1,
        severity: problem.severity,
        message: `${key}: ${problem.message}`,
      });
    }
    return document;
  }

  #checkLinks(document: SourceDocument): void {
    if (this.#problems.hasErrorsIn(document.path)) return;
    for (const level of this.#config.levels) {
      if (!this.#isVisible(document.visibility, level)) continue;
      if (!this.#passesFilter(document, level)) continue;
      const content = this.#render(document.markup, level);
      for (const target of extractLinkTargets(content)) {
        this.#checkLink(document.path, target, level);
      }
    }
  }

  #checkLink(path: string, target: string, level: Level): void {
    const resolved = resolveLinkTarget(path, target);
    if (resolved === undefined) {
      this.#problems.add({
        path,
        severity: 'warning',
        message: `link points outside the knowledge base: ${target}`,
      });
      return;
    }
    const targetVisibility = this.#visibility.ofPath(resolved);
    if (targetVisibility === undefined) {
      this.#problems.add({ path, severity: 'warning', message: `broken link: ${target}` });
      return;
    }
    const highest = this.#highestLevel();
    if (level !== highest && this.#pathsWithOwnErrors.has(resolved)) {
      this.#problems.add({
        path,
        severity: 'error',
        message: `${level} content links to ${resolved}, which is left out below ${highest} for its own errors; fix them first`,
      });
      return;
    }
    if (!this.#isVisible(targetVisibility, level)) {
      this.#problems.add({
        path,
        severity: 'error',
        message: `${level} content links to ${resolved}, which only ${targetVisibility} can see; wrap the link in <${targetVisibility}>`,
      });
      return;
    }
    if (!this.#tree.markdown.has(resolved)) return;
    const targetDocument = this.#documents.get(resolved);
    if (targetDocument === undefined) {
      this.#problems.add({
        path,
        severity: 'warning',
        message: `link points to ${resolved}, which the config excludes`,
      });
      return;
    }
    if (this.#passesFilter(targetDocument, level)) return;
    this.#problems.add({
      path,
      severity: 'error',
      message: `${level} content links to ${resolved}, which the filter leaves out of ${level}`,
    });
  }

  #bundleFor(level: Level, documents: readonly SourceDocument[]): Bundle {
    const files = documents
      .filter((document) => this.#isInBundle(document, level))
      .map((document) => this.#fileFor(document, level));
    const instructions = this.#instructionsFor(level);
    return {
      protocol: 1,
      level,
      ...(this.#isHighest(level) ? { highest: true } : {}),
      build: this.#buildInfo,
      ...(instructions === undefined ? {} : { instructions }),
      ...(this.#config.searchIndex ? { search: buildSearchIndex(files) } : {}),
      folders: this.#foldersFor(files),
      files,
    };
  }

  #isInBundle(document: SourceDocument, level: Level): boolean {
    if (!this.#isVisible(document.visibility, level)) return false;
    if (!this.#isHighest(level) && this.#problems.hasErrorsIn(document.path)) return false;
    return this.#passesFilter(document, level);
  }

  #passesFilter(document: SourceDocument, level: Level): boolean {
    const key = JSON.stringify([level, document.path]);
    const cached = this.#filterResults.get(key);
    if (cached !== undefined) return cached;
    const passes = this.#runFilter(document, level);
    this.#filterResults.set(key, passes);
    return passes;
  }

  #runFilter(document: SourceDocument, level: Level): boolean {
    try {
      const result: unknown = this.#config.filter({
        level,
        path: document.path,
        frontmatter: document.split.frontmatter,
      });
      return result === true;
    } catch (error) {
      this.#problems.add({
        path: document.path,
        severity: 'error',
        message: `filter failed: ${String(error)}`,
      });
      return false;
    }
  }

  #fileFor(document: SourceDocument, level: Level): BundleFile {
    const { path, split } = document;
    const hasErrors = this.#problems.hasErrorsIn(path);
    const content = trimBlankLines(hasErrors ? split.body : this.#render(document.markup, level));
    const title = hasErrors ? undefined : this.#renderInline(document.title, level);
    const summary = hasErrors ? undefined : this.#renderInline(document.summary, level);
    const updated = this.#dateOf(path, split.frontmatter, this.#config.frontmatterKeys.updated);
    const verified = this.#dateOf(path, split.frontmatter, this.#config.frontmatterKeys.verified);
    const reviewDue = this.#isHighest(level)
      ? this.#reviewDueOf(split.frontmatter, verified ?? updated)
      : undefined;
    const url = this.#urlOf(path, level);
    const meta = this.#metaOf(path, split.frontmatter);
    const heading = title ?? extractHeading1(content);
    return {
      path,
      ...(this.#rankOf(document.visibility) > 0 ? { visibility: document.visibility } : {}),
      ...(heading === undefined ? {} : { title: heading }),
      ...(summary === undefined ? {} : { summary }),
      ...(updated === undefined ? {} : { updated }),
      ...(verified === undefined ? {} : { verified }),
      ...(reviewDue === undefined ? {} : { reviewDue }),
      ...(url === undefined ? {} : { url }),
      ...(meta === undefined ? {} : { meta }),
      content,
    };
  }

  #foldersFor(files: readonly BundleFile[]): BundleFolder[] {
    const folders = new Set(['']);
    for (const file of files) {
      for (let folder = parentFolderOf(file.path); folder !== ''; folder = parentFolderOf(folder)) {
        folders.add(folder);
      }
    }
    const summaries = new Map(files.map((file) => [file.path, file.summary]));
    return [...folders].toSorted().map((path) => {
      const summary = summaries.get(path === '' ? 'README.md' : `${path}/README.md`);
      return summary === undefined ? { path } : { path, summary };
    });
  }

  #instructionsFor(level: Level): string | undefined {
    const path = this.#config.instructions.get(level);
    if (path === undefined) return undefined;
    const text = this.#tree.markdown.get(path);
    if (text === undefined) {
      this.#problems.add({
        path,
        severity: 'error',
        message: `instructions for ${level} not found`,
      });
      return undefined;
    }
    const split = this.#splitOf(path);
    const markup = parseMarkup(split.body, {
      levels: this.#config.levels,
      firstLine: split.bodyFirstLine,
    });
    for (const problem of markup.problems) this.#problems.add({ path, ...problem });
    if (split.problem !== undefined) {
      this.#problems.add({ path, line: 1, severity: 'error', message: split.problem });
    }
    if (!this.#isHighest(level) && this.#problems.hasErrorsIn(path)) return undefined;
    const instructions = this.#render(markup, level).trim();
    return instructions === '' ? undefined : instructions;
  }

  #dateOf(
    path: string,
    frontmatter: Readonly<Record<string, unknown>>,
    key: string,
  ): string | undefined {
    const value = frontmatter[key];
    if (value === undefined) return undefined;
    if (typeof value === 'string' && DATE.test(value)) return value;
    if (value instanceof Date && !Number.isNaN(value.getTime()))
      return value.toISOString().slice(0, 10);
    this.#problems.add({
      path,
      line: 1,
      severity: 'warning',
      message: `${key} must be a YYYY-MM-DD date`,
    });
    return undefined;
  }

  #reviewDueOf(
    frontmatter: Readonly<Record<string, unknown>>,
    lastChecked: string | undefined,
  ): string | undefined {
    const status = frontmatter[this.#config.frontmatterKeys.status];
    if (typeof status !== 'string') return undefined;
    const interval = this.#config.reviewIntervals.get(status);
    if (interval === undefined) return undefined;
    return lastChecked === undefined
      ? this.#buildInfo.createdAt.slice(0, 10)
      : addDaysTo(lastChecked, interval);
  }

  #urlOf(path: string, level: Level): string | undefined {
    try {
      const url = this.#config.url({ level, path });
      if (url === undefined || URL_WITH_SCHEME.test(url)) return url;
      this.#problems.add({ path, severity: 'warning', message: `url must be absolute: ${url}` });
    } catch (error) {
      this.#problems.add({ path, severity: 'warning', message: `url failed: ${String(error)}` });
    }
    return undefined;
  }

  #metaOf(
    path: string,
    frontmatter: Readonly<Record<string, unknown>>,
  ): Record<string, JsonValue> | undefined {
    const entries = this.#config.keep.flatMap((key) => {
      const value = frontmatter[key];
      if (value === undefined) return [];
      if (isJsonValue(value)) return [[key, value] as const];
      this.#problems.add({
        path,
        line: 1,
        severity: 'warning',
        message: `${key} isn't plain JSON, so it's left out`,
      });
      return [];
    });
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
  }

  #render(markup: MarkupDocument, level: Level): string {
    return renderMarkup(markup, {
      level,
      levels: this.#config.levels,
      markers: this.#config.markers,
    });
  }

  #renderInline(markup: MarkupDocument | undefined, level: Level): string | undefined {
    if (markup === undefined) return undefined;
    const rendered = this.#render(markup, level).trim();
    return rendered === '' ? undefined : rendered;
  }

  #splitOf(path: string): FrontmatterSplit {
    const cached = this.#splits.get(path);
    if (cached !== undefined) return cached;
    const split = splitFrontmatter(this.#tree.markdown.get(path) ?? '');
    this.#splits.set(path, split);
    return split;
  }

  #highestLevel(): Level {
    const highest = this.#config.levels.at(-1);
    if (highest === undefined) throw new Error('unexpected config without levels');
    return highest;
  }

  #isVisible(visibility: Level, level: Level): boolean {
    return this.#rankOf(visibility) <= this.#rankOf(level);
  }

  #isHighest(level: Level): boolean {
    return this.#rankOf(level) === this.#config.levels.length - 1;
  }

  #rankOf(level: Level): number {
    return this.#config.levels.indexOf(level);
  }
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
};

const makePathMatcher = (config: ResolvedConfig): ((path: string) => boolean) => {
  const isIncluded = picomatch([...config.include], { dot: true });
  const exclusions = config.exclude.map((pattern) => {
    const isNegated = pattern.startsWith('!');
    return { isNegated, matches: picomatch(isNegated ? pattern.slice(1) : pattern, { dot: true }) };
  });
  return (path) => {
    if (!isIncluded(path)) return false;
    let isExcluded = false;
    for (const exclusion of exclusions) {
      if (exclusion.matches(path)) isExcluded = !exclusion.isNegated;
    }
    return !isExcluded;
  };
};

const addDaysTo = (date: string, days: number): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

const trimBlankLines = (text: string): string => text.replace(/^(?:[ \t]*\n)+/u, '').trimEnd();

const resolveLinkTarget = (from: string, target: string): string | undefined => {
  const joined = target.startsWith('/')
    ? target.slice(1)
    : posix.join(parentFolderOf(from), target);
  const normalized = posix.normalize(joined).replace(/\/+$/u, '');
  if (normalized === '..' || normalized.startsWith('../')) return undefined;
  return normalized === '.' ? '' : normalized;
};
