import { posix } from 'node:path';

import type { Level } from '../protocol/index.ts';
import type { FrontmatterSplit } from './frontmatter.ts';
import type { ProblemCollector } from './problem.ts';
import type { SourceTree } from './source-tree.ts';

/**
 * Resolver of the level that files and folders are visible to.
 *
 * A file's own frontmatter wins, then its folder's `README.md`, then the parent folders', then the default.
 * Invalid or unreadable declarations resolve to the highest level.
 */
export class VisibilityResolver {
  readonly #folders = new Map<string, Level>();
  readonly #tree: SourceTree;
  readonly #levels: readonly Level[];
  readonly #defaultVisibility: Level;
  readonly #key: string;
  readonly #frontmatterOf: (path: string) => FrontmatterSplit;
  readonly #problems: ProblemCollector;

  constructor(options: {
    readonly tree: SourceTree;
    readonly levels: readonly Level[];
    readonly defaultVisibility: Level;
    readonly key: string;
    readonly frontmatterOf: (path: string) => FrontmatterSplit;
    readonly problems: ProblemCollector;
  }) {
    this.#tree = options.tree;
    this.#levels = options.levels;
    this.#defaultVisibility = options.defaultVisibility;
    this.#key = options.key;
    this.#frontmatterOf = options.frontmatterOf;
    this.#problems = options.problems;
  }

  /**
   * Returns the level a file is visible to.
   */
  ofFile(path: string): Level {
    const declared = this.#tree.markdown.has(path) ? this.#declaredIn(path) : undefined;
    return declared ?? this.ofFolder(parentFolderOf(path));
  }

  /**
   * Returns the level a folder is visible to, where `''` is the root.
   */
  ofFolder(folder: string): Level {
    const cached = this.#folders.get(folder);
    if (cached !== undefined) return cached;
    const readme = folder === '' ? 'README.md' : `${folder}/README.md`;
    const declared = this.#tree.markdown.has(readme) ? this.#declaredIn(readme) : undefined;
    const level =
      declared ?? (folder === '' ? this.#defaultVisibility : this.ofFolder(parentFolderOf(folder)));
    this.#folders.set(folder, level);
    return level;
  }

  /**
   * Returns the level of a file or folder by path, or `undefined` when nothing exists there.
   */
  ofPath(path: string): Level | undefined {
    if (this.#tree.files.has(path)) return this.ofFile(path);
    if (this.#tree.folders.has(path)) return this.ofFolder(path);
    return undefined;
  }

  #declaredIn(path: string): Level | undefined {
    const highest = this.#levels[this.#levels.length - 1] ?? this.#defaultVisibility;
    const split = this.#frontmatterOf(path);
    if (split.problem !== undefined) return highest;
    const value = split.frontmatter[this.#key];
    if (value === undefined) return undefined;
    const level = this.#levels.find(
      (candidate) => typeof value === 'string' && candidate === value.trim().toLowerCase(),
    );
    if (level !== undefined) return level;
    this.#problems.add({
      path,
      line: 1,
      severity: 'error',
      message: `invalid ${this.#key} ${JSON.stringify(value)} (use ${this.#levels.join(', ')})`,
    });
    return highest;
  }
}

/**
 * Returns the folder containing a path, where `''` is the root.
 */
export const parentFolderOf = (path: string): string => {
  const parent = posix.dirname(path);
  return parent === '.' ? '' : parent;
};
