import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { NodeServices } from '@effect/platform-node';
import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { readSourceTree } from './source-tree.ts';

const withFolder = (files: Readonly<Record<string, string>>) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const root = await mkdtemp(join(tmpdir(), 'kemian-source-tree-'));
      for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      }
      return root;
    }),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  );

const readFiles = (files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const root = yield* withFolder(files);
    const tree = yield* readSourceTree(root);
    return { files: [...tree.files].toSorted(), folders: [...tree.folders].toSorted() };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe('readSourceTree', () => {
  it.effect('skips dot files, node_modules, and what the root .gitignore ignores', () =>
    Effect.gen(function* () {
      const tree = yield* readFiles({
        '.gitignore': 'dist/\n*.draft.md\n',
        '.hidden.md': '',
        'README.md': '',
        'dist/kemian/out.md': '',
        'node_modules/pkg/README.md': '',
        'notes/idea.draft.md': '',
        'notes/idea.md': '',
      });
      expect(tree.files).toEqual(['README.md', 'notes/idea.md']);
      expect(tree.folders).toEqual(['', 'notes']);
    }),
  );

  it.effect("reads a nested .gitignore relative to its own folder, after its parents'", () =>
    Effect.gen(function* () {
      const tree = yield* readFiles({
        '.gitignore': '*.draft.md\n',
        'build/kept.md': '',
        'notes/.gitignore': '/build\n!keep.draft.md\n',
        'notes/build/out.md': '',
        'notes/keep.draft.md': '',
        'notes/other.draft.md': '',
        'other.draft.md': '',
      });
      expect(tree.files).toEqual(['build/kept.md', 'notes/keep.draft.md']);
    }),
  );

  it.effect('matches case-sensitively, like Git on Linux', () =>
    Effect.gen(function* () {
      const tree = yield* readFiles({ '.gitignore': 'Dist/\n', 'dist/out.md': '' });
      expect(tree.files).toEqual(['dist/out.md']);
    }),
  );
});
