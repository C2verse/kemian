import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { FakeGitHub } from '../../test/github-fake.ts';
import { makeGitHubRepository } from './github-repository.ts';

const setup = () => {
  const github = new FakeGitHub({
    repo: 'robin/kb',
    token: 'gh-token',
    files: { 'kb/a.md': 'a', 'kb/b.md': 'b' },
  });
  const repository = makeGitHubRepository({
    repo: 'robin/kb',
    token: 'gh-token',
    apiUrl: 'https://api.github.test/',
    fetch: github.fetch,
  });
  return { github, repository };
};

describe('makeGitHubRepository', () => {
  it.effect('reads the default branch', () =>
    Effect.gen(function* () {
      expect(yield* setup().repository.defaultBranch).toBe('main');
    }),
  );

  it.effect('commits changes and deletions on top of a parent', () =>
    Effect.gen(function* () {
      const { github, repository } = setup();
      const sha = yield* repository.commit({
        parent: 'base',
        message: 'edit',
        changes: [
          { path: 'kb/a.md', text: 'A' },
          { path: 'kb/b.md', text: null },
          { path: 'kb/c.md', text: 'c' },
        ],
      });
      expect(github.commits.get(sha)).toMatchObject({ message: 'edit', parents: ['base'] });
      expect([...(github.commits.get(sha)?.files ?? [])]).toEqual([
        ['kb/a.md', 'A'],
        ['kb/c.md', 'c'],
      ]);
    }),
  );

  it.effect('creates a branch, then moves it on a later push', () =>
    Effect.gen(function* () {
      const { github, repository } = setup();
      const first = yield* repository.commit({ parent: 'base', message: '1', changes: [] });
      const second = yield* repository.commit({ parent: 'base', message: '2', changes: [] });
      yield* repository.pushBranch('kemian/proposal-a', first);
      yield* repository.pushBranch('kemian/proposal-a', second);
      expect(github.refs.get('kemian/proposal-a')).toBe(second);
    }),
  );

  it.effect('fast-forwards the default branch, and reports when GitHub refuses', () =>
    Effect.gen(function* () {
      const { github, repository } = setup();
      const sha = yield* repository.commit({ parent: 'base', message: '1', changes: [] });
      github.isDefaultBranchProtected = true;
      expect(yield* repository.fastForward('main', sha)).toBe(false);
      github.isDefaultBranchProtected = false;
      expect(yield* repository.fastForward('main', sha)).toBe(true);
      expect(github.refs.get('main')).toBe(sha);
      const stale = yield* repository.commit({ parent: 'base', message: '2', changes: [] });
      expect(yield* repository.fastForward('main', stale)).toBe(false);
    }),
  );

  it.effect('opens a pull request, and updates it when one is open for the branch', () =>
    Effect.gen(function* () {
      const { github, repository } = setup();
      const options = { branch: 'kemian/proposal-a', base: 'main', title: 'Edit a.md', body: 'v1' };
      expect(yield* repository.openPullRequest(options)).toBe('https://github.com/robin/kb/pull/1');
      expect(yield* repository.openPullRequest({ ...options, body: 'v2' })).toBe(
        'https://github.com/robin/kb/pull/1',
      );
      expect(github.pulls).toMatchObject([{ head: 'kemian/proposal-a', base: 'main', body: 'v2' }]);
    }),
  );

  it.effect('sets a commit status, shortening the description', () =>
    Effect.gen(function* () {
      const { github, repository } = setup();
      yield* repository.setStatus({
        sha: 'base',
        context: 'kemian/check',
        state: 'failure',
        description: 'x'.repeat(200),
      });
      expect(github.statuses).toEqual([
        { sha: 'base', context: 'kemian/check', state: 'failure', description: 'x'.repeat(140) },
      ]);
    }),
  );

  it.effect('fails with what GitHub answered', () =>
    Effect.gen(function* () {
      const github = new FakeGitHub({ repo: 'robin/kb', token: 'right', files: {} });
      const repository = makeGitHubRepository({
        repo: 'robin/kb',
        token: 'wrong',
        fetch: github.fetch,
      });
      const error = yield* Effect.flip(repository.defaultBranch);
      expect(error.message).toBe(
        'GitHub request failed: GET /repos/robin/kb answered 401: Bad credentials',
      );
    }),
  );
});
