import type { Identity } from './access.ts';

/**
 * Third-party sign-in that establishes a caller's identity, e.g. GitHub.
 */
export interface SignInProvider {
  /** Name shown on the consent page, e.g. `GitHub`. */
  readonly displayName: string;
  /** Returns the URL that starts sign-in at the provider. */
  readonly authorizeUrl: (options: {
    readonly state: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
  }) => string;
  /** Exchanges the code the provider redirected back with for the signed-in identity. */
  readonly completeSignIn: (options: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
  }) => Promise<Identity>;
}
