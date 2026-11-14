import MiniSearch, { type AsPlainObject, type Options, type SearchResult } from 'minisearch';

import type { Bundle, BundleFile, BundleSearchIndex } from '../protocol/index.ts';

/**
 * Format of the search indexes this code builds and reads.
 *
 * Change it whenever the indexed fields or the engine's serialization change, so readers rebuild stale indexes.
 */
export const SEARCH_INDEX_FORMAT = 'minisearch-7/path,title,summary,content/grouped-numbers';

// Like MiniSearch's default separator, but a comma or period between two digits stays in the term,
// so `110,000` is one term instead of `110` and `000`.
const TERM_SEPARATOR = /(?:(?<!\d)[.,]|[.,](?!\d)|(?![.,])[\n\r\p{Z}\p{P}])+/u;

const MIN_FUZZY_TERM_LENGTH = 4;

const splitTerms = (text: string): string[] =>
  text.split(TERM_SEPARATOR).filter((term) => term !== '');

const hasDigit = (term: string): boolean => /\d/u.test(term);

const INDEX_OPTIONS: Options<BundleFile> = {
  idField: 'path',
  fields: ['path', 'title', 'summary', 'content'],
  tokenize: splitTerms,
  searchOptions: {
    boost: { title: 3, summary: 2, path: 1.5 },
    prefix: (term) => !hasDigit(term),
    fuzzy: (term) => (hasDigit(term) || term.length < MIN_FUZZY_TERM_LENGTH ? false : 0.2),
  },
};

/**
 * File that matches a search query.
 */
export interface SearchMatch {
  readonly path: string;
  readonly score: number;
  readonly terms: readonly string[];
}

/**
 * Keyword index over a bundle's files.
 */
export interface SearchIndex {
  /** Returns the best matching files' paths, best first, with their scores and the terms that matched. */
  readonly search: (query: string) => readonly SearchMatch[];
}

/**
 * Builds the search index of a bundle's files, to ship in the bundle.
 *
 * Index only the files of the bundle it ships in, so the index holds no term that level may not see.
 */
export const buildSearchIndex = (files: readonly BundleFile[]): BundleSearchIndex => ({
  format: SEARCH_INDEX_FORMAT,
  // The engine's plain object holds `undefined` entries; round-tripping makes it what readers receive.
  data: JSON.parse(JSON.stringify(indexFiles(files))),
});

/**
 * Loads a bundle's prebuilt search index, or builds one from its files when it has none in a known format.
 */
export const loadSearchIndex = (bundle: Bundle): SearchIndex => {
  const prebuilt = bundle.search?.format === SEARCH_INDEX_FORMAT ? bundle.search.data : undefined;
  const index = isSerializedIndex(prebuilt) ? loadOrUndefined(prebuilt) : undefined;
  return wrap(index ?? indexFiles(bundle.files));
};

const indexFiles = (files: readonly BundleFile[]): MiniSearch<BundleFile> => {
  const index = new MiniSearch<BundleFile>(INDEX_OPTIONS);
  index.addAll([...files]);
  return index;
};

const loadOrUndefined = (data: AsPlainObject): MiniSearch<BundleFile> | undefined => {
  try {
    return MiniSearch.loadJS<BundleFile>(data, INDEX_OPTIONS);
  } catch {
    return undefined;
  }
};

const wrap = (index: MiniSearch<BundleFile>): SearchIndex => ({
  search: (query) =>
    index.search(query).map((result: SearchResult) => ({
      path: String(result.id),
      score: result.score,
      terms: result.terms,
    })),
});

const isSerializedIndex = (value: unknown): value is AsPlainObject =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'serializationVersion') === 'number' &&
  Array.isArray(Reflect.get(value, 'index'));
