import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { NodeServices } from '@effect/platform-node';
import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { FakeGitHub } from '../../test/github-fake.ts';
import { contentHashOf, type Proposal } from '../protocol/index.ts';
import { makeGitHubRepository } from './github-repository.ts';
import { formatPullReport, hasFailures, pullProposals } from './proposal-pull.ts';

const files: Readonly<Record<string, string>> = {
  'kemian.config.ts': "export default { levels: ['public', 'private'] };\n",
  'README.md': '---\nvisibility: public\n---\n# Robin\n',
  'projects/lantern.md':
    '---\nvisibility: public\nstatus: stable\n---\n# Lantern\n\nLantern supports YAML. <private>Revenue is 95,000.</private>\n',
  'projects/atlas.md': '---\nstatus: evolving\nverified: 2026-12-01\n---\n# Atlas\n\nA map.\n',
};

const base = {
  protocol: 1,
  createdAt: '2026-11-14T09:30:00.000Z',
  author: { identity: 'github:12345', name: 'robin' },
} as const;
const fileBase = { ...base, build: 'build-1' } as const;

const note: Proposal = {
  ...base,
  id: 'note00000001',
  kind: 'note',
  title: 'TOML',
  body: 'Lantern supports TOML.',
};
const edit: Proposal = {
  ...fileBase,
  id: 'edit00000001',
  path: 'projects/lantern.md',
  kind: 'edit',
  edits: [{ old: 'supports YAML.', new: 'supports YAML and TOML.' }],
  reason: 'Robin said so.',
};
const conflicted: Proposal = {
  ...edit,
  id: 'edit00000002',
  edits: [{ old: 'supports JSON.', new: 'x' }],
};
const tagMove: Proposal = {
  ...edit,
  id: 'edit00000003',
  edits: [{ old: '<private>Revenue is ', new: 'Revenue is <private>' }],
};
const verified = (id: string, path: string, date: string): Proposal => ({
  ...fileBase,
  id,
  path,
  kind: 'stale',
  verdict: 'current',
  verified: date,
});

const makeKnowledgeBase = async (
  options: { readonly folder?: string; readonly isRepository?: boolean } = {},
) => {
  const repository = await mkdtemp(join(tmpdir(), 'kemian-pull-'));
  const root = join(repository, options.folder ?? '');
  if (options.isRepository !== false) await mkdir(join(repository, '.git'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
};

const makeQueue = (proposals: readonly Proposal[]) => {
  const pending = [...proposals];
  const acknowledged: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (request.headers.get('authorization') !== 'Bearer queue-token') {
      return Response.json({ error: 'Invalid proposals token.' }, { status: 401 });
    }
    if (new URL(request.url).pathname === '/proposals/acknowledge') {
      const body: unknown = await request.json();
      const ids: unknown = Reflect.get(Object(body), 'ids');
      for (const id of Array.isArray(ids) ? ids : []) {
        acknowledged.push(String(id));
        const index = pending.findIndex((proposal) => proposal.id === id);
        if (index !== -1) pending.splice(index, 1);
      }
      return Response.json({ acknowledged: Array.isArray(ids) ? ids.length : 0 });
    }
    return Response.json({ protocol: 1, proposals: pending });
  };
  return { fetch, pending, acknowledged };
};

const makeGitHub = (options: { readonly prefix?: string } = {}) =>
  new FakeGitHub({
    repo: 'robin/kb',
    token: 'gh-token',
    files: Object.fromEntries(
      Object.entries(files).map(([path, text]) => [`${options.prefix ?? ''}${path}`, text]),
    ),
  });

const pull = (options: {
  readonly root: string;
  readonly queue: ReturnType<typeof makeQueue>;
  readonly github?: FakeGitHub;
}) =>
  pullProposals({
    configPath: join(options.root, 'kemian.config.ts'),
    serverUrl: 'https://kemian.test/',
    proposalsToken: 'queue-token',
    fetch: options.queue.fetch,
    ...(options.github === undefined
      ? {}
      : {
          github: {
            base: 'base',
            repository: makeGitHubRepository({
              repo: 'robin/kb',
              token: 'gh-token',
              fetch: options.github.fetch,
            }),
          },
        }),
  }).pipe(Effect.provide(NodeServices.layer));

describe('pullProposals', () => {
  it.effect('opens a pull request per proposal, with the check as a status', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const queue = makeQueue([note, edit]);
      const github = makeGitHub();
      const entries = yield* pull({ root, queue, github });

      expect(
        entries.map(({ outcome, description, url }) => ({ outcome, description, url })),
      ).toEqual([
        { outcome: 'opened', description: 'Note: TOML', url: 'https://github.com/robin/kb/pull/1' },
        {
          outcome: 'opened',
          description: 'Edit projects/lantern.md',
          url: 'https://github.com/robin/kb/pull/2',
        },
      ]);
      expect(
        github.filesOf('kemian/proposal-2026-11-14-note00000001').get('inbox/2026-11-14-toml.md'),
      ).toContain('visibility: private');
      expect(
        github.filesOf('kemian/proposal-2026-11-14-edit00000001').get('projects/lantern.md'),
      ).toContain('Lantern supports YAML and TOML.');
      expect(github.filesOf('main')).toEqual(new Map(Object.entries(files)));
      expect(github.pulls[1]?.body).toContain(
        'Proposed by robin (`github:12345`) on 2026-11-14 through Kemian',
      );
      expect(github.pulls[1]?.body).toContain('> Robin said so.');
      expect(github.pulls[1]?.body).toContain('**public:**\n\n- `projects/lantern.md` changed');
      expect(github.statuses.map(({ context, state }) => ({ context, state }))).toEqual([
        { context: 'kemian/check', state: 'success' },
        { context: 'kemian/check', state: 'success' },
      ]);
      expect(queue.acknowledged).toEqual(['note00000001', 'edit00000001']);
      expect(queue.pending).toEqual([]);
    }),
  );

  it.effect('turns a proposal that no longer applies into a note', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const queue = makeQueue([conflicted]);
      const github = makeGitHub();
      const [entry] = yield* pull({ root, queue, github });
      expect(entry).toMatchObject({
        outcome: 'opened',
        description: 'Conflicted: Edit projects/lantern.md',
        detail:
          "the edits don't apply to projects/lantern.md: edit 1: `old` occurs 0 times, not exactly once; added a note instead",
      });
      const noteText = github
        .filesOf('kemian/proposal-2026-11-14-edit00000002')
        .get('inbox/2026-11-14-conflicted-proposal-for-projects-lantern-md.md');
      expect(noteText).toContain('```\nsupports JSON.\n```');
      expect(queue.acknowledged).toEqual(['edit00000002']);
    }),
  );

  it.effect('fails the check of an edit that moves a level tag', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const github = makeGitHub();
      const [entry] = yield* pull({ root, queue: makeQueue([tagMove]), github });
      expect(entry?.review?.markupChanges).toEqual([
        'edit 1 to projects/lantern.md touches a level tag or HTML comment',
      ]);
      expect(github.statuses[0]?.state).toBe('failure');
      expect(github.pulls[0]?.body).toContain('**Check failed.**');
      expect(github.pulls[0]?.body).toContain('+ Lantern supports YAML. Revenue is');
    }),
  );

  it.effect('retires an obsolete file the agent read in its current form', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const contentHash = yield* Effect.promise(() => contentHashOf('# Atlas\n\nA map.'));
      const obsolete: Proposal = {
        ...fileBase,
        id: 'obsolete0001',
        path: 'projects/atlas.md',
        kind: 'stale',
        verdict: 'obsolete',
        contentHash,
      };
      const github = makeGitHub();
      const [entry] = yield* pull({ root, queue: makeQueue([obsolete]), github });
      expect(entry?.description).toBe('Retire obsolete projects/atlas.md');
      expect(
        github.filesOf('kemian/proposal-2026-11-14-obsolete0001').get('projects/atlas.md'),
      ).toContain('status: archived');
    }),
  );

  it.effect('commits current verdicts together to the default branch, keeping later dates', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const queue = makeQueue([
        verified('current00001', 'projects/lantern.md', '2026-11-13'),
        verified('current00002', 'projects/lantern.md', '2026-11-14'),
        verified('current00003', 'projects/atlas.md', '2026-11-14'),
        verified('current00004', 'projects/gone.md', '2026-11-14'),
      ]);
      const github = makeGitHub();
      const entries = yield* pull({ root, queue, github });
      expect(entries.map(({ outcome, detail }) => ({ outcome, detail }))).toEqual([
        { outcome: 'unchanged', detail: 'projects/atlas.md was already verified on 2026-12-01' },
        { outcome: 'dropped', detail: 'projects/gone.md is no longer in the knowledge base' },
        { outcome: 'committed', detail: 'Verified projects/lantern.md. Committed to main.' },
      ]);
      expect(github.filesOf('main').get('projects/lantern.md')).toContain('verified: 2026-11-14\n');
      expect(github.pulls).toEqual([]);
      expect(queue.acknowledged.toSorted()).toEqual([
        'current00001',
        'current00002',
        'current00003',
        'current00004',
      ]);
    }),
  );

  it.effect('opens a pull request for current verdicts when the default branch is protected', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const github = makeGitHub();
      github.isDefaultBranchProtected = true;
      const queue = makeQueue([verified('current00001', 'projects/lantern.md', '2026-11-14')]);
      const [entry] = yield* pull({ root, queue, github });
      expect(entry).toMatchObject({ outcome: 'opened', url: 'https://github.com/robin/kb/pull/1' });
      expect(github.pulls[0]?.head).toBe('kemian/verified-2026-11-14-current00001');
      expect(github.filesOf('main').get('projects/lantern.md')).not.toContain('verified');
    }),
  );

  it.effect('writes paths relative to the repository when the knowledge base is in a folder', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase({ folder: 'kb' }));
      const github = makeGitHub({ prefix: 'kb/' });
      yield* pull({ root, queue: makeQueue([edit]), github });
      expect(
        github.filesOf('kemian/proposal-2026-11-14-edit00000001').get('kb/projects/lantern.md'),
      ).toContain('YAML and TOML');
      expect(
        github.filesOf('kemian/proposal-2026-11-14-edit00000001').has('projects/lantern.md'),
      ).toBe(false);
    }),
  );

  it.effect('updates the pull request a crashed run opened instead of opening another', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const github = makeGitHub();
      yield* pull({ root, queue: makeQueue([edit]), github });
      yield* pull({ root, queue: makeQueue([edit]), github });
      expect(github.pulls).toHaveLength(1);
    }),
  );

  it.effect('keeps going past a proposal GitHub refuses, leaving it queued', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const github = makeGitHub();
      github.branchesFailing.add('kemian/proposal-2026-11-14-note00000001');
      const queue = makeQueue([note, edit]);
      const entries = yield* pull({ root, queue, github });
      expect(entries.map((entry) => entry.outcome)).toEqual(['failed', 'opened']);
      expect(entries[0]?.detail).toContain('answered 500: Server Error');
      expect(queue.acknowledged).toEqual(['edit00000001']);
      expect(queue.pending.map((proposal) => proposal.id)).toEqual(['note00000001']);
      expect(hasFailures(entries)).toBe(true);
    }),
  );

  it.effect('opens a separate pull request for verdicts of a later run on the same day', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const github = makeGitHub();
      github.isDefaultBranchProtected = true;
      yield* pull({
        root,
        queue: makeQueue([verified('current00001', 'projects/lantern.md', '2026-11-14')]),
        github,
      });
      yield* pull({
        root,
        queue: makeQueue([verified('current00002', 'projects/atlas.md', '2026-12-02')]),
        github,
      });
      expect(github.pulls.map((request) => request.head)).toEqual([
        'kemian/verified-2026-11-14-current00001',
        'kemian/verified-2026-12-02-current00002',
      ]);
      expect(
        github.filesOf('kemian/verified-2026-11-14-current00001').get('projects/lantern.md'),
      ).toContain('verified: 2026-11-14');
    }),
  );

  it.effect('writes and acknowledges nothing in a dry run', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase({ isRepository: false }));
      const queue = makeQueue([
        note,
        verified('current00001', 'projects/lantern.md', '2026-11-14'),
      ]);
      const entries = yield* pull({ root, queue });
      expect(entries.map((entry) => entry.outcome)).toEqual(['planned', 'planned']);
      expect(queue.acknowledged).toEqual([]);
      expect(formatPullReport(entries)).toContain(
        '- **planned** ✅: Note: TOML: Changes inbox/2026-11-14-toml.md.',
      );
    }),
  );

  it.effect('fails outside a Git checkout', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase({ isRepository: false }));
      const error = yield* Effect.flip(
        pull({ root, queue: makeQueue([note]), github: makeGitHub() }),
      );
      expect(error._tag).toBe('RepositoryNotFoundError');
    }),
  );

  it.effect('fails when the server refuses the token', () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => makeKnowledgeBase());
      const queue = makeQueue([]);
      const error = yield* Effect.flip(
        pullProposals({
          configPath: join(root, 'kemian.config.ts'),
          serverUrl: 'https://kemian.test',
          proposalsToken: 'wrong',
          fetch: queue.fetch,
        }).pipe(Effect.provide(NodeServices.layer)),
      );
      expect(error.message).toContain('answered 401: Invalid proposals token.');
    }),
  );
});

describe('formatPullReport', () => {
  it('says when nothing is pending', () => {
    expect(formatPullReport([])).toBe('No pending proposals.');
  });
});
