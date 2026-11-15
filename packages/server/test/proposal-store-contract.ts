import { expect, it } from '@effect/vitest';

import type { ProposalStore } from '../src/core/index.ts';
import type { Proposal } from '../src/protocol/index.ts';

const DAY_IN_MS = 86_400_000;
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + DAY_IN_MS).toISOString().slice(0, 10);

export const noteProposal = (
  id: string,
  options: { readonly createdAt?: string; readonly identity?: string } = {},
): Proposal => ({
  protocol: 1,
  id,
  createdAt: options.createdAt ?? `${today}T09:00:00.000Z`,
  author: { identity: options.identity ?? 'github:12345', name: 'robin' },
  kind: 'note',
  title: `Note ${id}`,
  body: 'Lantern supports TOML now.',
});

/**
 * Defines the tests every {@link ProposalStore} must pass.
 */
export const testProposalStoreContract = (makeStore: () => ProposalStore): void => {
  it('starts empty', async () => {
    const store = makeStore();
    expect(await store.list()).toEqual([]);
    expect(await store.countAdded('github:12345', today)).toBe(0);
  });

  it('lists pending proposals oldest first', async () => {
    const store = makeStore();
    const later = noteProposal('b', { createdAt: `${today}T10:00:00.000Z` });
    const earlier = noteProposal('a', { createdAt: `${today}T08:00:00.000Z` });
    expect(await store.add(later)).toBe(true);
    expect(await store.add(earlier)).toBe(true);
    expect(await store.list()).toEqual([earlier, later]);
  });

  it('refuses a proposal whose ID is pending or was added the same day', async () => {
    const store = makeStore();
    expect(await store.add(noteProposal('a'))).toBe(true);
    expect(await store.add(noteProposal('a'))).toBe(false);
    await store.acknowledge(['a']);
    expect(await store.add(noteProposal('a'))).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('drops acknowledged proposals and ignores unknown IDs', async () => {
    const store = makeStore();
    await store.add(noteProposal('a'));
    await store.add(noteProposal('b'));
    await store.acknowledge(['a', 'unknown']);
    expect((await store.list()).map((proposal) => proposal.id)).toEqual(['b']);
  });

  it('counts proposals per identity and day, acknowledged ones included', async () => {
    const store = makeStore();
    await store.add(noteProposal('a'));
    await store.add(noteProposal('b'));
    await store.add(noteProposal('c', { identity: 'github:777' }));
    await store.add(noteProposal('d', { createdAt: `${tomorrow}T00:00:00.000Z` }));
    await store.acknowledge(['a']);
    expect(await store.countAdded('github:12345', today)).toBe(2);
    expect(await store.countAdded('github:777', today)).toBe(1);
    expect(await store.countAdded('github:12345', tomorrow)).toBe(1);
  });
};
