import type { Identity } from './access.ts';
import type { ProposalStore } from './proposal-store.ts';

/**
 * Options that let editors propose changes to the knowledge base.
 */
export interface EditingOptions {
  /** Where proposals wait until the content repo pulls them. */
  readonly proposals: ProposalStore;
  /**
   * Identities that may propose changes, keyed like `github:12345`.
   *
   * An editor gets the editing tools only while their identity resolves to the highest level.
   */
  readonly editors: readonly string[];
  /** Bearer token `kemian proposals pull` must send; reading proposals is disabled without one. */
  readonly proposalsToken?: string;
  /** Proposals one editor may make per UTC day. Defaults to 50. */
  readonly maxProposalsPerDay?: number;
}

/**
 * Editor a request is served for, with what the editing tools need.
 */
export interface EditorContext {
  readonly identity: Identity;
  readonly proposals: ProposalStore;
  readonly maxProposalsPerDay: number;
}
