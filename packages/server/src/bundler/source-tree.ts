import { Effect, FileSystem, Path } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

/**
 * Files and folders of a knowledge base, by POSIX path relative to its root.
 */
export interface SourceTree {
  /** Text of every Markdown file. */
  readonly markdown: ReadonlyMap<string, string>;
  /** Every file, Markdown or not. */
  readonly files: ReadonlySet<string>;
  /** Every folder, with `''` for the root. */
  readonly folders: ReadonlySet<string>;
}

/**
 * Builds a source tree from file contents by path.
 */
export const makeSourceTree = (files: Readonly<Record<string, string>>): SourceTree => {
  const paths = Object.keys(files);
  const folders = new Set(['']);
  for (const path of paths) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index++) {
      folders.add(segments.slice(0, index).join('/'));
    }
  }
  return {
    markdown: new Map(
      Object.entries(files)
        .filter(([path]) => isMarkdown(path))
        .map(([path, text]) => [path, normalizeLineEndings(text)]),
    ),
    files: new Set(paths),
    folders,
  };
};

/**
 * Reads a knowledge base from disk, skipping dot files, dot folders, and `node_modules`.
 */
export const readSourceTree = (
  root: string,
): Effect.Effect<SourceTree, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const markdown = new Map<string, string>();
    const files = new Set<string>();
    const folders = new Set<string>();

    const walk = (folder: string): Effect.Effect<void, PlatformError> =>
      Effect.gen(function* () {
        folders.add(folder);
        const names = yield* fileSystem.readDirectory(path.join(root, folder));
        for (const name of names.toSorted()) {
          if (name.startsWith('.') || name === 'node_modules') continue;
          const relative = folder === '' ? name : `${folder}/${name}`;
          const info = yield* fileSystem.stat(path.join(root, relative));
          if (info.type === 'Directory') {
            yield* walk(relative);
          } else if (info.type === 'File') {
            files.add(relative);
            if (isMarkdown(relative)) {
              const text = yield* fileSystem.readFileString(path.join(root, relative));
              markdown.set(relative, normalizeLineEndings(text));
            }
          }
        }
      });

    yield* walk('');
    return { markdown, files, folders };
  });

const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith('.md');

const normalizeLineEndings = (text: string): string => text.replaceAll('\r\n', '\n');
