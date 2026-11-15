import { Effect, FileSystem, Path } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import ignore, { type Ignore } from 'ignore';

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
 * Reads a knowledge base from disk, skipping dot files, dot folders, `node_modules`, and whatever its `.gitignore` files ignore.
 *
 * Only `.gitignore` files inside the root are read, not those of parent folders or Git's global excludes.
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

    const readGitignore = (folder: string): Effect.Effect<GitignoreScope, PlatformError> =>
      Effect.gen(function* () {
        const text = yield* fileSystem.readFileString(path.join(root, folder, '.gitignore'));
        return { folder, rules: ignore({ ignorecase: false }).add(text) };
      });

    const walk = (
      folder: string,
      scopesInherited: readonly GitignoreScope[],
    ): Effect.Effect<void, PlatformError> =>
      Effect.gen(function* () {
        folders.add(folder);
        const names = yield* fileSystem.readDirectory(path.join(root, folder));
        const scopes = names.includes('.gitignore')
          ? [...scopesInherited, yield* readGitignore(folder)]
          : scopesInherited;
        for (const name of names.toSorted()) {
          if (name.startsWith('.') || name === 'node_modules') continue;
          const relative = folder === '' ? name : `${folder}/${name}`;
          const info = yield* fileSystem.stat(path.join(root, relative));
          const isFolder = info.type === 'Directory';
          if (isGitignored(relative, { isFolder, scopes })) continue;
          if (isFolder) {
            yield* walk(relative, scopes);
          } else if (info.type === 'File') {
            files.add(relative);
            if (isMarkdown(relative)) {
              const text = yield* fileSystem.readFileString(path.join(root, relative));
              markdown.set(relative, normalizeLineEndings(text));
            }
          }
        }
      });

    yield* walk('', []);
    return { markdown, files, folders };
  });

interface GitignoreScope {
  readonly folder: string;
  readonly rules: Ignore;
}

const isGitignored = (
  path: string,
  options: { readonly isFolder: boolean; readonly scopes: readonly GitignoreScope[] },
): boolean => {
  let isIgnored = false;
  // Like Git, the deepest `.gitignore` with a matching rule decides, so a nested `!pattern` can re-include a path.
  for (const scope of options.scopes) {
    const relative = scope.folder === '' ? path : path.slice(scope.folder.length + 1);
    const result = scope.rules.test(options.isFolder ? `${relative}/` : relative);
    if (result.ignored) isIgnored = true;
    else if (result.unignored) isIgnored = false;
  }
  return isIgnored;
};

const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith('.md');

const normalizeLineEndings = (text: string): string => text.replaceAll('\r\n', '\n');
