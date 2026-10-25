import MiniSearch from 'minisearch';

import type { Bundle, BundleFile } from '../protocol/index.ts';

/**
 * Entry of a folder listing.
 */
export type FolderEntry =
  | { readonly kind: 'folder'; readonly path: string; readonly summary?: string }
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly title?: string;
      readonly summary?: string;
    };

/**
 * Search result with a snippet of the matching content.
 */
export interface SearchHit {
  readonly file: BundleFile;
  readonly score: number;
  readonly snippet: string;
}

const SNIPPET_RADIUS = 100;

/**
 * Read-only view of one bundle: listing folders, reading files, and searching.
 */
export class BundleReader {
  readonly #filesByPath: ReadonlyMap<string, BundleFile>;
  readonly #folderSummaries: ReadonlyMap<string, string | undefined>;
  #index: MiniSearch<BundleFile> | undefined;

  readonly bundle: Bundle;

  constructor(bundle: Bundle) {
    this.bundle = bundle;
    this.#filesByPath = new Map(bundle.files.map((file) => [file.path, file]));
    const folders = new Map<string, string | undefined>([['', undefined]]);
    for (const file of bundle.files) {
      for (const folder of ancestorsOf(file.path)) folders.set(folder, undefined);
    }
    for (const folder of bundle.folders) folders.set(folder.path, folder.summary);
    this.#folderSummaries = folders;
  }

  /**
   * Returns the entries directly inside a folder, folders first, or `undefined` when the folder doesn't exist.
   */
  list(folderPath: string): FolderEntry[] | undefined {
    const folder = normalizePath(folderPath);
    if (!this.#folderSummaries.has(folder)) return undefined;
    const folders = [...this.#folderSummaries]
      .filter(([path]) => path !== '' && parentOf(path) === folder)
      .map(([path, summary]): FolderEntry => ({
        kind: 'folder',
        path,
        ...(summary === undefined ? {} : { summary }),
      }));
    const files = this.bundle.files
      .filter((file) => parentOf(file.path) === folder)
      .map((file): FolderEntry => ({
        kind: 'file',
        path: file.path,
        ...(file.title === undefined ? {} : { title: file.title }),
        ...(file.summary === undefined ? {} : { summary: file.summary }),
      }));
    return [...folders.toSorted(byPath), ...files.toSorted(byPath)];
  }

  /**
   * Returns the summary of a folder, if it has one.
   */
  folderSummary(folderPath: string): string | undefined {
    return this.#folderSummaries.get(normalizePath(folderPath));
  }

  /**
   * Returns whether a path names a file in the bundle.
   */
  isFile(path: string): boolean {
    return this.#filesByPath.has(normalizePath(path));
  }

  /**
   * Returns a file by path, or `undefined` when the bundle doesn't contain it.
   */
  read(path: string): BundleFile | undefined {
    return this.#filesByPath.get(normalizePath(path));
  }

  /**
   * Searches titles, summaries, paths, and content by keyword, best matches first.
   */
  search(query: string, options: { readonly limit: number }): SearchHit[] {
    return this.#getIndex()
      .search(query)
      .slice(0, options.limit)
      .flatMap((result) => {
        const file = this.#filesByPath.get(String(result.id));
        return file === undefined
          ? []
          : [{ file, score: result.score, snippet: snippetOf(file.content, result.terms) }];
      });
  }

  #getIndex(): MiniSearch<BundleFile> {
    if (this.#index !== undefined) return this.#index;
    const index = new MiniSearch<BundleFile>({
      idField: 'path',
      fields: ['path', 'title', 'summary', 'content'],
      searchOptions: { boost: { title: 3, summary: 2, path: 1.5 }, prefix: true, fuzzy: 0.2 },
    });
    index.addAll([...this.bundle.files]);
    this.#index = index;
    return index;
  }
}

/**
 * Returns a path without leading or trailing slashes, where `''`, `.`, and `/` name the root.
 */
export const normalizePath = (path: string): string => {
  const trimmed = path
    .trim()
    .replace(/^\.?\/+/u, '')
    .replace(/\/+$/u, '');
  return trimmed === '.' ? '' : trimmed;
};

const parentOf = (path: string): string => {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
};

const ancestorsOf = (path: string): string[] => {
  const ancestors: string[] = [];
  for (let folder = parentOf(path); folder !== ''; folder = parentOf(folder))
    ancestors.push(folder);
  return ancestors;
};

const byPath = (a: FolderEntry, b: FolderEntry): number => a.path.localeCompare(b.path);

const snippetOf = (content: string, terms: readonly string[]): string => {
  const lowered = content.toLowerCase();
  const positions = terms
    .map((term) => lowered.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0);
  const position = positions.length === 0 ? 0 : Math.min(...positions);
  const start = Math.max(0, position - SNIPPET_RADIUS);
  const end = Math.min(content.length, position + SNIPPET_RADIUS);
  const text = content.slice(start, end).replace(/\s+/gu, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${end < content.length ? '…' : ''}`;
};
