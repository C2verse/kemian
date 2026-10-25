import type { Level } from '../protocol/index.ts';

/**
 * Caller identity established by an auth provider, e.g. a GitHub user.
 */
export interface Identity {
  /** Auth provider, e.g. `github`. */
  readonly provider: string;
  /** Stable ID of the user at the provider, e.g. a GitHub user ID. */
  readonly id: string;
  /** Display name, e.g. a GitHub login. */
  readonly name?: string;
}

/**
 * Policy that decides which level a caller sees.
 */
export interface AccessPolicy {
  /** Level of callers without an identity, or `undefined` to require login. */
  readonly anonymous: Level | undefined;
  /** Level of each identity, keyed by {@link identityKeyOf}. */
  readonly identities: ReadonlyMap<string, Level>;
}

/**
 * Returns the key of an identity in an {@link AccessPolicy}, e.g. `github:12345`.
 */
export const identityKeyOf = (identity: Pick<Identity, 'provider' | 'id'>): string =>
  `${identity.provider}:${identity.id}`;

/**
 * Builds an access policy from the identities allowed into each level.
 *
 * @throws {Error} if an identity is listed under more than one level
 */
export const makeAccessPolicy = (options: {
  readonly anonymous: Level | undefined;
  readonly levels: Readonly<Record<Level, readonly string[]>>;
}): AccessPolicy => {
  const identities = new Map<string, Level>();
  for (const [level, keys] of Object.entries(options.levels)) {
    for (const key of keys) {
      const existing = identities.get(key);
      if (existing !== undefined && existing !== level) {
        throw new Error(`identity ${key} is listed under both ${existing} and ${level}`);
      }
      identities.set(key, level);
    }
  }
  return { anonymous: options.anonymous, identities };
};

/**
 * Returns the level a caller sees, or `undefined` when the caller sees nothing.
 */
export const resolveLevel = (
  policy: AccessPolicy,
  identity: Identity | undefined,
): Level | undefined =>
  identity === undefined ? policy.anonymous : policy.identities.get(identityKeyOf(identity));
