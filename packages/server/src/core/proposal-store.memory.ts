import type { Proposal } from '../protocol/index.ts';
import { dayOf, type ProposalStore } from './proposal-store.ts';

/**
 * Creates a {@link ProposalStore} that keeps proposals in memory, for tests and local development.
 */
export const memoryProposalStore = (): ProposalStore => {
  const pending = new Map<string, Proposal>();
  const added = new Map<string, { readonly identity: string; readonly day: string }>();

  return {
    add: async (proposal) => {
      const addedKey = addedKeyOf(proposal.author.identity, dayOf(proposal.createdAt), proposal.id);
      if (pending.has(proposal.id) || added.has(addedKey)) return false;
      pending.set(proposal.id, proposal);
      added.set(addedKey, { identity: proposal.author.identity, day: dayOf(proposal.createdAt) });
      return true;
    },
    list: async () =>
      [...pending.values()].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
    acknowledge: async (ids) => {
      for (const id of ids) pending.delete(id);
    },
    countAdded: async (identity, day) =>
      [...added.values()].filter((entry) => entry.day === day && entry.identity === identity)
        .length,
  };
};

const addedKeyOf = (identity: string, day: string, id: string): string =>
  JSON.stringify([day, identity, id]);
