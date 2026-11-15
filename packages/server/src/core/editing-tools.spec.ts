import { describe, expect, it } from '@effect/vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { bundleSetOf, privateBundle, publicBundle } from '../../test/bundles.ts';
import {
  type BundleFile,
  type BundleSet,
  contentHashOf,
  type Proposal,
} from '../protocol/index.ts';
import type { Identity } from './access.ts';
import { memoryBundleStore } from './bundle-store.memory.ts';
import type { EditingOptions } from './editing.ts';
import { createKemian, type Kemian, type KemianOptions } from './kemian.ts';
import { memoryProposalStore } from './proposal-store.memory.ts';
import type { ProposalStore } from './proposal-store.ts';

const robin: Identity = { provider: 'github', id: '12345', name: 'robin' };
const sam: Identity = { provider: 'github', id: '777', name: 'sam' };
const proposalsToken = 'proposals-token';
const today = () => new Date().toISOString().slice(0, 10);

const staleFiles: readonly BundleFile[] = [
  {
    path: 'journal/old.md',
    title: 'Old journal',
    verified: '2020-01-01',
    reviewDue: '2020-01-31',
    content: 'Robin moved to Lisbon.',
  },
  {
    path: 'projects/older.md',
    updated: '2019-06-01',
    reviewDue: '2019-12-01',
    content: 'Older project.',
  },
  { path: 'projects/future.md', reviewDue: '2999-01-01', content: 'Not due yet.' },
];

const editableBundleSet = (): BundleSet => {
  const set = bundleSetOf();
  const privateLevel = privateBundle();
  return {
    ...set,
    bundles: [publicBundle(), { ...privateLevel, files: [...privateLevel.files, ...staleFiles] }],
  };
};

const makeKemian = async (
  options: {
    readonly editing?: Partial<EditingOptions>;
    readonly bundleSet?: BundleSet;
    readonly levels?: KemianOptions['levels'];
  } = {},
) => {
  const store = memoryBundleStore();
  await store.replace(options.bundleSet ?? editableBundleSet());
  const proposals = options.editing?.proposals ?? memoryProposalStore();
  const kemian = createKemian({
    store,
    levels: options.levels ?? { private: ['github:12345', 'github:777'] },
    editing: { proposals, editors: ['github:12345'], proposalsToken, ...options.editing },
  });
  return { kemian, proposals };
};

const connect = async (kemian: Kemian, identity?: Identity) => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('https://kemian.test/mcp'), {
      fetch: (input, init) => kemian.handleMcp(new Request(input, init), { identity }),
    }),
  );
  return client;
};

const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content
    .map((part) => (typeof part === 'object' && part !== null ? Reflect.get(part, 'text') : ''))
    .join('');
  return { text, isError: result.isError === true };
};

const toolNamesOf = async (client: Client) =>
  (await client.listTools()).tools.map((tool) => tool.name).toSorted();

const onlyProposal = async (proposals: ProposalStore): Promise<Proposal> => {
  const list = await proposals.list();
  expect(list).toHaveLength(1);
  const [proposal] = list;
  if (proposal === undefined) throw new Error('no proposal');
  return proposal;
};

const lanternEdit = { old: 'YAML files', new: 'YAML and TOML files' };

const resolveStale = async (args: Record<string, unknown>) => {
  const { kemian, proposals } = await makeKemian();
  const result = await call(await connect(kemian, robin), 'resolve_stale', {
    path: 'journal/old.md',
    build: 'build-1',
    ...args,
  });
  return { result, proposals: await proposals.list() };
};

const proposalsRequest = (
  path: string,
  options: { readonly method?: string; readonly token?: string; readonly body?: string } = {},
) =>
  new Request(`https://kemian.test${path}`, {
    method: options.method ?? 'GET',
    headers: { authorization: `Bearer ${options.token ?? proposalsToken}` },
    ...(options.body === undefined ? {} : { body: options.body }),
  });

describe('editing access', () => {
  it('gives editors at the highest level the editing tools and their guidance', async () => {
    const { kemian } = await makeKemian();
    const client = await connect(kemian, robin);
    expect(await toolNamesOf(client)).toEqual([
      'list',
      'list_stale',
      'note',
      'propose_edit',
      'read',
      'resolve_stale',
      'search',
    ]);
    expect(client.getInstructions()).toContain('You may also propose changes.');
    expect((await call(client, 'list', {})).text).toContain('You may also propose changes.');
  });

  it.each([
    ['anonymous callers', undefined],
    ['identities at the highest level that are not editors', sam],
  ])('keeps %s read-only', async (_, identity) => {
    const { kemian } = await makeKemian();
    const client = await connect(kemian, identity);
    expect(await toolNamesOf(client)).toEqual(['list', 'read', 'search']);
    expect(client.getInstructions()).not.toContain('propose');
  });

  it('keeps editors read-only below the highest level', async () => {
    const { kemian } = await makeKemian({ levels: { public: ['github:12345'] } });
    const client = await connect(kemian, robin);
    expect(await toolNamesOf(client)).toEqual(['list', 'read', 'search']);
  });

  it('keeps editors read-only when the bundle does not say it is the highest', async () => {
    const set = bundleSetOf();
    const { highest: _, ...unmarked } = privateBundle();
    const { kemian } = await makeKemian({
      bundleSet: { ...set, bundles: [publicBundle(), unmarked] },
    });
    expect(await toolNamesOf(await connect(kemian, robin))).toEqual(['list', 'read', 'search']);
  });

  it('keeps everyone read-only without editing options', async () => {
    const store = memoryBundleStore();
    await store.replace(editableBundleSet());
    const kemian = createKemian({ store, levels: { private: ['github:12345'] } });
    expect(await toolNamesOf(await connect(kemian, robin))).toEqual(['list', 'read', 'search']);
  });

  it('shows editors the build ID when reading', async () => {
    const { kemian } = await makeKemian();
    const editor = await call(await connect(kemian, robin), 'read', { paths: ['journal/old.md'] });
    expect(editor.text).toContain('Build: build-1');
    expect(editor.text).toContain('Verified: 2020-01-01');
    expect(editor.text).toContain('Review due: 2020-01-31');
    const reader = await call(await connect(kemian, sam), 'read', { paths: ['journal/old.md'] });
    expect(reader.text).not.toContain('Build:');
  });
});

describe('note', () => {
  it('queues a note with its author', async () => {
    const { kemian, proposals } = await makeKemian();
    const client = await connect(kemian, robin);
    const result = await call(client, 'note', {
      title: 'Lantern supports TOML',
      body: 'Robin mentioned TOML support shipped in October.',
      about: ['/projects/lantern.md'],
      sources: ['conversation on 2026-11-14'],
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('Proposed the note "Lantern supports TOML"');
    const proposal = await onlyProposal(proposals);
    expect(proposal).toMatchObject({
      protocol: 1,
      kind: 'note',
      author: { identity: 'github:12345', name: 'robin' },
      title: 'Lantern supports TOML',
      about: ['projects/lantern.md'],
      sources: ['conversation on 2026-11-14'],
    });
    expect(proposal.id).toMatch(/^[0-9a-f]{32}$/u);
    expect(result.text).toContain(proposal.id);
  });

  it('refuses notes about files that do not exist', async () => {
    const { kemian, proposals } = await makeKemian();
    const result = await call(await connect(kemian, robin), 'note', {
      title: 'A',
      body: 'B',
      about: ['projects/missing.md'],
    });
    expect(result).toEqual({ text: 'Not found: projects/missing.md', isError: true });
    expect(await proposals.list()).toEqual([]);
  });

  it('does not queue a retried call twice', async () => {
    const { kemian, proposals } = await makeKemian();
    const client = await connect(kemian, robin);
    const note = { title: 'A', body: 'B' };
    await call(client, 'note', note);
    expect((await call(client, 'note', note)).text).toContain('Already proposed');
    await call(client, 'note', { ...note, id: 'retry-1' });
    expect((await call(client, 'note', { ...note, id: 'retry-1' })).text).toContain(
      'Already proposed',
    );
    expect(await proposals.list()).toHaveLength(2);
  });

  it('keeps a different proposal that reuses a client ID', async () => {
    const { kemian, proposals } = await makeKemian();
    const client = await connect(kemian, robin);
    await call(client, 'note', { title: 'A', body: 'first', id: 'note-1' });
    const second = await call(client, 'note', { title: 'A', body: 'second', id: 'note-1' });
    expect(second.text).toContain('Proposed the note');
    expect(new Set((await proposals.list()).map((proposal) => proposal.id)).size).toBe(2);
  });

  it('rejects input over the size limits', async () => {
    const { kemian } = await makeKemian();
    const result = await call(await connect(kemian, robin), 'note', {
      title: 'A',
      body: 'x'.repeat(20_001),
    });
    expect(result.isError).toBe(true);
  });
});

describe('propose_edit', () => {
  it('queues edits that apply to the current bundle', async () => {
    const { kemian, proposals } = await makeKemian();
    const result = await call(await connect(kemian, robin), 'propose_edit', {
      path: 'projects/lantern.md',
      build: 'build-1',
      edits: [lanternEdit],
      reason: 'Robin said TOML is supported now.',
    });
    expect(result.text).toContain('Proposed 1 edit(s) to projects/lantern.md');
    expect(await onlyProposal(proposals)).toMatchObject({
      kind: 'edit',
      path: 'projects/lantern.md',
      build: 'build-1',
      edits: [lanternEdit],
    });
  });

  it.each([
    ['a missing file', { path: 'projects/missing.md' }, 'Not found: projects/missing.md'],
    [
      'a snippet that is not in the file',
      { edits: [{ old: 'JSON files', new: 'x' }] },
      '`old` occurs 0 times',
    ],
    [
      'an edit that changes nothing',
      { edits: [{ old: 'YAML', new: 'YAML' }] },
      'Edit 1 changes nothing',
    ],
  ])('refuses %s', async (_, override, message) => {
    const { kemian, proposals } = await makeKemian();
    const result = await call(await connect(kemian, robin), 'propose_edit', {
      path: 'projects/lantern.md',
      build: 'build-1',
      edits: [lanternEdit],
      reason: 'r',
      ...override,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(message);
    expect(await proposals.list()).toEqual([]);
  });
});

describe('list_stale', () => {
  it('lists files due for review, most overdue first', async () => {
    const { kemian } = await makeKemian();
    const { text } = await call(await connect(kemian, robin), 'list_stale', {});
    expect(text).toContain(`2 file(s) due for review as of ${today()}`);
    expect(text).toContain('Build: build-1');
    expect(text.indexOf('projects/older.md')).toBeLessThan(text.indexOf('journal/old.md'));
    expect(text).toContain('1. projects/older.md\n   updated 2019-06-01; due 2019-12-01 (');
    expect(text).toContain(
      '2. journal/old.md — Old journal\n   verified 2020-01-01; due 2020-01-31',
    );
    expect(text).not.toContain('projects/future.md');
  });

  it('filters by folder and limits the list', async () => {
    const { kemian } = await makeKemian();
    const client = await connect(kemian, robin);
    const journal = await call(client, 'list_stale', { folder: 'journal/' });
    expect(journal.text).toContain('journal/old.md');
    expect(journal.text).not.toContain('projects/older.md');
    const limited = await call(client, 'list_stale', { limit: 1 });
    expect(limited.text).toContain('showing 1');
    expect(limited.text).not.toContain('journal/old.md');
  });

  it('skips files with a pending verdict', async () => {
    const { kemian } = await makeKemian();
    const client = await connect(kemian, robin);
    await call(client, 'resolve_stale', {
      path: 'projects/older.md',
      build: 'build-1',
      verdict: 'current',
    });
    const { text } = await call(client, 'list_stale', {});
    expect(text).not.toContain('projects/older.md');
    expect(text).toContain('journal/old.md');
  });

  it('says when nothing is due', async () => {
    const { kemian } = await makeKemian({ bundleSet: bundleSetOf() });
    expect((await call(await connect(kemian, robin), 'list_stale', {})).text).toBe(
      'No files are due for review.',
    );
  });
});

describe('resolve_stale', () => {
  it('records a current verdict as verified today', async () => {
    const { result, proposals } = await resolveStale({
      verdict: 'current',
      note: 'Still in Lisbon.',
    });
    expect(result.text).toContain(`Its verified date becomes ${today()} without review.`);
    expect(proposals).toMatchObject([
      { kind: 'stale', verdict: 'current', verified: today(), note: 'Still in Lisbon.' },
    ]);
  });

  it('records an outdated verdict with its edits', async () => {
    const edits = [{ old: 'Lisbon', new: 'Porto' }];
    const { result, proposals } = await resolveStale({ verdict: 'outdated', edits });
    expect(result.isError).toBe(false);
    expect(proposals).toMatchObject([{ kind: 'stale', verdict: 'outdated', edits }]);
  });

  it('records an obsolete verdict with the hash of the content read', async () => {
    const { result, proposals } = await resolveStale({ verdict: 'obsolete' });
    expect(result.text).toContain("After review it's archived, or deleted if it's a note.");
    expect(proposals).toMatchObject([
      { verdict: 'obsolete', contentHash: await contentHashOf('Robin moved to Lisbon.') },
    ]);
  });

  it.each([
    [
      'a current verdict with edits',
      { verdict: 'current', edits: [lanternEdit] },
      'takes no edits',
    ],
    ['an outdated verdict without edits', { verdict: 'outdated' }, 'needs the edits'],
    [
      'an outdated verdict whose edits do not apply',
      { verdict: 'outdated', edits: [{ old: 'Madrid', new: 'Porto' }] },
      '`old` occurs 0 times',
    ],
    [
      'an obsolete verdict on an older build',
      { verdict: 'obsolete', build: 'build-0' },
      'may have changed since build build-0',
    ],
    ['a missing file', { verdict: 'current', path: 'gone.md' }, 'Not found: gone.md'],
  ])('refuses %s', async (_, args, message) => {
    const { result, proposals } = await resolveStale(args);
    expect(result.isError).toBe(true);
    expect(result.text).toContain(message);
    expect(proposals).toEqual([]);
  });
});

describe('limits', () => {
  it('refuses proposals past the daily limit', async () => {
    const { kemian, proposals } = await makeKemian({ editing: { maxProposalsPerDay: 2 } });
    const client = await connect(kemian, robin);
    await call(client, 'note', { title: 'A', body: '1' });
    await call(client, 'note', { title: 'A', body: '2' });
    await proposals.acknowledge((await proposals.list()).map((proposal) => proposal.id));
    const third = await call(client, 'note', { title: 'A', body: '3' });
    expect(third.isError).toBe(true);
    expect(third.text).toContain("today's limit of 2 proposals");
  });

  it('reports a failing proposal store as a tool error', async () => {
    const failing: ProposalStore = {
      ...memoryProposalStore(),
      countAdded: async () => {
        throw new Error('R2 is down');
      },
    };
    const { kemian } = await makeKemian({ editing: { proposals: failing } });
    const result = await call(await connect(kemian, robin), 'note', { title: 'A', body: 'B' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('R2 is down');
  });
});

describe('/proposals', () => {
  it('lists pending proposals and drops acknowledged ones', async () => {
    const { kemian, proposals } = await makeKemian();
    await call(await connect(kemian, robin), 'note', { title: 'A', body: 'B' });
    const { id } = await onlyProposal(proposals);
    const listed = await kemian.handleProposals(proposalsRequest('/proposals'));
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      protocol: 1,
      proposals: [{ id, kind: 'note', title: 'A' }],
    });

    const acknowledged = await kemian.handleProposals(
      proposalsRequest('/proposals/acknowledge', {
        method: 'POST',
        body: JSON.stringify({ ids: [id] }),
      }),
    );
    expect(await acknowledged.json()).toEqual({ acknowledged: 1 });
    expect(await (await kemian.handleProposals(proposalsRequest('/proposals'))).json()).toEqual({
      protocol: 1,
      proposals: [],
    });
  });

  it.each([
    ['a wrong token', proposalsRequest('/proposals', { token: 'wrong' }), 401],
    ['a write to the list', proposalsRequest('/proposals', { method: 'POST' }), 405],
    ['a read of the acknowledgement', proposalsRequest('/proposals/acknowledge'), 405],
    [
      'an acknowledgement that is not JSON',
      proposalsRequest('/proposals/acknowledge', { method: 'POST', body: 'ids' }),
      400,
    ],
    [
      'an acknowledgement without IDs',
      proposalsRequest('/proposals/acknowledge', { method: 'POST', body: '{"ids":["a/b"]}' }),
      400,
    ],
  ])('rejects %s', async (_, input, status) => {
    const { kemian } = await makeKemian();
    expect((await kemian.handleProposals(input)).status).toBe(status);
  });

  it.each([
    ['without a proposals token', { proposalsToken: '' }],
    ['without editing', undefined],
  ])('is disabled %s', async (_, editing) => {
    const store = memoryBundleStore();
    const kemian = createKemian({
      store,
      ...(editing === undefined
        ? {}
        : { editing: { proposals: memoryProposalStore(), editors: [], ...editing } }),
    });
    expect((await kemian.handleProposals(proposalsRequest('/proposals'))).status).toBe(403);
  });
});
