import { Schema } from 'effect';

import { dayOf, type ProposalStore } from '../core/index.ts';
import { Proposal } from '../protocol/index.ts';
import type { R2BucketLike } from './r2-bucket.ts';
import { listKeys } from './r2-key-listing.ts';

const DAY_IN_MS = 86_400_000;
const MAX_KEYS_PER_DELETE = 1000;
const isProposal = Schema.is(Proposal);

/**
 * Creates a {@link ProposalStore} on an R2 bucket, under `proposals/` unless another prefix is given.
 *
 * It can share a bucket with {@link r2BundleStore}. Records of which proposals each identity added are kept for two
 * days after acknowledging, for the daily limit and to refuse retries. A stored proposal that isn't valid is logged and
 * left out of the list, so it can't block the others.
 */
export const r2ProposalStore = (
  bucket: R2BucketLike,
  options: { readonly prefix?: string } = {},
): ProposalStore => {
  const prefix = options.prefix ?? 'proposals/';
  const pendingPrefix = `${prefix}pending/`;
  const addedPrefix = `${prefix}added/`;
  const pendingKey = (id: string) => `${pendingPrefix}${id}.json`;
  const addedFolder = (identity: string, day: string) =>
    `${addedPrefix}${day}/${encodeURIComponent(identity)}/`;

  const pruneAddedRecords = async () => {
    const oldestKept = new Date(Date.now() - 2 * DAY_IN_MS).toISOString().slice(0, 10);
    const expired = (await listKeys(bucket, addedPrefix)).filter(
      (key) => key.slice(addedPrefix.length, addedPrefix.length + 10) < oldestKept,
    );
    await deleteKeys(bucket, expired);
  };

  return {
    add: async (proposal) => {
      const addedKey = `${addedFolder(proposal.author.identity, dayOf(proposal.createdAt))}${proposal.id}`;
      const [pending, added] = await Promise.all([
        bucket.get(pendingKey(proposal.id)),
        bucket.get(addedKey),
      ]);
      if (pending !== null || added !== null) return false;
      await bucket.put(pendingKey(proposal.id), JSON.stringify(proposal));
      await bucket.put(addedKey, '{}');
      return true;
    },
    list: async () => {
      const keys = await listKeys(bucket, pendingPrefix);
      const proposals = await Promise.all(
        keys.map(async (key) => {
          const object = await bucket.get(key);
          if (object === null) return undefined;
          const proposal: unknown = JSON.parse(await object.text());
          if (isProposal(proposal)) return proposal;
          console.error(`kemian: stored proposal ${key} is invalid; leaving it out`);
          return undefined;
        }),
      );
      return proposals
        .filter((proposal) => proposal !== undefined)
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    acknowledge: async (ids) => {
      await deleteKeys(bucket, ids.map(pendingKey));
      await pruneAddedRecords();
    },
    countAdded: async (identity, day) =>
      (await listKeys(bucket, addedFolder(identity, day))).length,
  };
};

const deleteKeys = async (bucket: R2BucketLike, keys: readonly string[]): Promise<void> => {
  for (let start = 0; start < keys.length; start += MAX_KEYS_PER_DELETE) {
    await bucket.delete(keys.slice(start, start + MAX_KEYS_PER_DELETE));
  }
};
