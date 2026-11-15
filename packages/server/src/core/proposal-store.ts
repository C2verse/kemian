import { Effect, Schema } from 'effect';

import type { Proposal } from '../protocol/index.ts';

/**
 * Queue of proposals from editors, waiting until the content repo pulls them.
 */
export interface ProposalStore {
  /**
   * Stores a proposal and returns `true`, or returns `false` when a proposal with its ID is pending or was added
   * the same UTC day.
   */
  readonly add: (proposal: Proposal) => Promise<boolean>;
  /** Returns the pending proposals, oldest first. */
  readonly list: () => Promise<readonly Proposal[]>;
  /** Drops pending proposals by ID, ignoring unknown IDs. */
  readonly acknowledge: (ids: readonly string[]) => Promise<void>;
  /** Returns how many proposals an identity added on a UTC day (`YYYY-MM-DD`), acknowledged ones included. */
  readonly countAdded: (identity: string, day: string) => Promise<number>;
}

/**
 * Error for a proposal store that failed to read or write.
 */
export class ProposalStoreError extends Schema.TaggedError<
  ProposalStoreError,
  { readonly brand: unique symbol }
>()('ProposalStoreError', { reason: Schema.String }) {
  override get message(): string {
    return `proposal store failed: ${this.reason}`;
  }
}

/**
 * Runs a proposal store operation, turning its rejection into a {@link ProposalStoreError}.
 */
export const fromProposalStore = <A>(
  operation: () => Promise<A>,
): Effect.Effect<A, ProposalStoreError> =>
  Effect.tryPromise({
    try: operation,
    catch: (error) => new ProposalStoreError({ reason: String(error) }),
  });

/**
 * Returns the UTC day of an ISO timestamp, `YYYY-MM-DD`.
 */
export const dayOf = (timestamp: string): string => timestamp.slice(0, 10);
