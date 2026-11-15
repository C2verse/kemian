import { describe, expect, it } from '@effect/vitest';

import { noteProposal, testProposalStoreContract } from '../../test/proposal-store-contract.ts';
import { r2ProposalStore } from './proposal-store.r2.ts';
import { makeBucket } from './r2-bucket.spec-helper.ts';

describe('r2ProposalStore', () => {
  testProposalStoreContract(() => r2ProposalStore(makeBucket().bucket));

  it('keeps proposals under its prefix, beside the bundles', async () => {
    const { bucket, objects } = makeBucket();
    objects.set('current.json', '{"id":"build-1"}');
    const store = r2ProposalStore(bucket, { prefix: 'kb/proposals/' });
    await store.add(noteProposal('a'));
    const day = noteProposal('a').createdAt.slice(0, 10);
    expect([...objects.keys()].toSorted()).toEqual([
      'current.json',
      `kb/proposals/added/${day}/github%3A12345/a`,
      'kb/proposals/pending/a.json',
    ]);
  });

  it('forgets who added what two days after acknowledging', async () => {
    const { bucket, objects } = makeBucket();
    const store = r2ProposalStore(bucket);
    await store.add(noteProposal('old', { createdAt: '2020-01-01T00:00:00.000Z' }));
    await store.add(noteProposal('new'));
    await store.acknowledge(['old']);
    expect([...objects.keys()].filter((key) => key.includes('2020-01-01'))).toEqual([]);
    expect(await store.countAdded('github:12345', noteProposal('new').createdAt.slice(0, 10))).toBe(
      1,
    );
  });

  it('leaves out a stored proposal that is invalid, so it blocks nothing', async () => {
    const { bucket, objects } = makeBucket();
    const store = r2ProposalStore(bucket);
    await store.add(noteProposal('good'));
    objects.set('proposals/pending/bad.json', '{"protocol":1}');
    const errors: unknown[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    try {
      expect((await store.list()).map((proposal) => proposal.id)).toEqual(['good']);
    } finally {
      console.error = consoleError;
    }
    expect(errors).toEqual([
      'kemian: stored proposal proposals/pending/bad.json is invalid; leaving it out',
    ]);
  });

  it('deletes keys in batches R2 accepts', async () => {
    const { bucket } = makeBucket();
    const batches: number[] = [];
    const store = r2ProposalStore({
      ...bucket,
      delete: async (keys) => {
        batches.push(Array.isArray(keys) ? keys.length : 1);
        await bucket.delete(keys);
      },
    });
    await store.acknowledge(Array.from({ length: 2500 }, (_, index) => `p${index}`));
    expect(batches).toEqual([1000, 1000, 500]);
  });
});
