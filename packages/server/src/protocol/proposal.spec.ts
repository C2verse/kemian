import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';

import {
  applyTextEdits,
  contentHashOf,
  decodeProposalList,
  PROPOSAL_LIMITS,
  Proposal,
} from './index.ts';

const base = {
  protocol: 1,
  id: 'abc_123-XYZ',
  createdAt: '2026-11-14T09:30:00.000Z',
  author: { identity: 'github:12345', name: 'robin' },
};

const note = { ...base, kind: 'note', title: 'Lantern ships', body: 'Version 2 is out.' };
const edit = {
  ...base,
  kind: 'edit',
  path: 'projects/lantern.md',
  build: 'build-1',
  edits: [{ old: 'YAML', new: 'YAML and TOML' }],
  reason: 'Robin said TOML is supported now.',
};

describe('Proposal', () => {
  const isProposal = Schema.is(Proposal);

  it.each([
    ['a note', note],
    ['a note with references', { ...note, about: ['projects/lantern.md'], sources: ['chat'] }],
    ['an edit', edit],
    [
      'a current verdict',
      {
        ...base,
        kind: 'stale',
        path: 'a.md',
        build: 'b',
        verdict: 'current',
        verified: '2026-11-14',
      },
    ],
    [
      'an outdated verdict',
      { ...base, kind: 'stale', path: 'a.md', build: 'b', verdict: 'outdated', edits: edit.edits },
    ],
    [
      'an obsolete verdict',
      {
        ...base,
        kind: 'stale',
        path: 'a.md',
        build: 'b',
        verdict: 'obsolete',
        contentHash: 'a'.repeat(64),
      },
    ],
  ])('accepts %s', (_, proposal) => {
    expect(isProposal(proposal)).toBe(true);
  });

  it.each([
    ['a title with a line break', { ...note, title: 'one\ntwo' }],
    ['an over-long title', { ...note, title: 'x'.repeat(PROPOSAL_LIMITS.titleLength + 1) }],
    ['an over-long body', { ...note, body: 'x'.repeat(PROPOSAL_LIMITS.textLength + 1) }],
    ['an empty body', { ...note, body: '' }],
    ['an about path with ..', { ...note, about: ['../secrets.md'] }],
    ['an edit without edits', { ...edit, edits: [] }],
    ['an edit with an empty old', { ...edit, edits: [{ old: '', new: 'x' }] }],
    [
      'too many edits',
      { ...edit, edits: Array.from({ length: PROPOSAL_LIMITS.edits + 1 }, () => edit.edits[0]) },
    ],
    ['an ID with a slash', { ...note, id: 'a/b' }],
    [
      'an outdated verdict without edits',
      { ...base, kind: 'stale', path: 'a.md', build: 'b', verdict: 'outdated' },
    ],
    [
      'an obsolete verdict without a hash',
      { ...base, kind: 'stale', path: 'a.md', build: 'b', verdict: 'obsolete' },
    ],
    ['an unknown kind', { ...note, kind: 'delete' }],
  ])('rejects %s', (_, proposal) => {
    expect(isProposal(proposal)).toBe(false);
  });
});

describe('decodeProposalList', () => {
  it.effect('decodes proposals and drops unknown fields', () =>
    Effect.gen(function* () {
      const list = yield* decodeProposalList({
        protocol: 1,
        proposals: [{ ...note, extra: true }],
        extra: true,
      });
      expect(list).toEqual({ protocol: 1, proposals: [note] });
    }),
  );

  it.effect('fails on another protocol version', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodeProposalList({ protocol: 2, proposals: [] }));
      expect(error._tag).toBe('UnsupportedProtocolError');
    }),
  );

  it.effect('fails on an invalid proposal', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeProposalList({ protocol: 1, proposals: [{ ...note, body: '' }] }),
      );
      expect(error._tag).toBe('InvalidProposalError');
    }),
  );
});

describe('applyTextEdits', () => {
  it('replaces each snippet', () => {
    expect(
      applyTextEdits('one two three', [
        { old: 'three', new: '3' },
        { old: 'one', new: '1' },
      ]),
    ).toEqual({ _tag: 'Applied', text: '1 two 3' });
  });

  it('applies every edit to the original text, not to earlier results', () => {
    expect(
      applyTextEdits('a b', [
        { old: 'a', new: 'b' },
        { old: 'b', new: 'c' },
      ]),
    ).toEqual({ _tag: 'Applied', text: 'b c' });
  });

  it.each([
    ['missing', 'one two', [{ old: 'three', new: '3' }], 'edit 1: `old` occurs 0 times'],
    ['repeated', 'one one', [{ old: 'one', new: '1' }], 'edit 1: `old` occurs 2 times'],
    ['overlapping with itself', 'aaa', [{ old: 'aa', new: 'b' }], 'edit 1: `old` occurs 2 times'],
    [
      'overlapping another edit',
      'one two',
      [
        { old: 'one t', new: '' },
        { old: 'two', new: '' },
      ],
      'two edits overlap',
    ],
  ])('conflicts on a snippet %s', (_, text, edits, reason) => {
    const result = applyTextEdits(text, edits);
    expect(result._tag).toBe('Conflicted');
    expect(result._tag === 'Conflicted' ? result.reason : '').toContain(reason);
  });
});

describe('contentHashOf', () => {
  it('returns the SHA-256 as hex', async () => {
    expect(await contentHashOf('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
