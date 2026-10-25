import type { Identity, SignInProvider } from '../core/index.ts';

/**
 * Options of GitHub sign-in through a GitHub OAuth app.
 */
export interface GitHubSignInOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Defaults to `https://github.com`; set for GitHub Enterprise or tests. */
  readonly baseUrl?: string;
  /** Defaults to `https://api.github.com`. */
  readonly apiBaseUrl?: string;
  readonly fetch?: typeof fetch;
}

/**
 * Creates a {@link SignInProvider} that signs people in with GitHub; identities look like `github:12345`.
 *
 * The identity's ID is the numeric GitHub user ID, which survives renames, unlike the login.
 */
export const githubSignIn = (options: GitHubSignInOptions): SignInProvider => {
  const baseUrl = (options.baseUrl ?? 'https://github.com').replace(/\/+$/u, '');
  const apiBaseUrl = (options.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/u, '');
  const send = options.fetch ?? fetch;

  return {
    displayName: 'GitHub',
    authorizeUrl: ({ state, redirectUri, codeChallenge }) => {
      const url = new URL(`${baseUrl}/login/oauth/authorize`);
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        allow_signup: 'false',
      }).toString();
      return url.href;
    },
    completeSignIn: async ({ code, redirectUri, codeVerifier }): Promise<Identity> => {
      const tokenResponse = await send(`${baseUrl}/login/oauth/access_token`, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      const token: unknown = await tokenResponse.json();
      const accessToken = readField(token, 'access_token');
      if (!tokenResponse.ok || typeof accessToken !== 'string') {
        const error = readField(token, 'error');
        throw new Error(
          `GitHub refused the sign-in: ${typeof error === 'string' ? error : tokenResponse.status}`,
        );
      }

      const userResponse = await send(`${apiBaseUrl}/user`, {
        headers: {
          'accept': 'application/vnd.github+json',
          'authorization': `Bearer ${accessToken}`,
          'user-agent': 'kemian',
        },
      });
      const user: unknown = await userResponse.json();
      const id = readField(user, 'id');
      const login = readField(user, 'login');
      if (!userResponse.ok || typeof id !== 'number' || typeof login !== 'string') {
        throw new Error(`GitHub didn't return the user: ${userResponse.status}`);
      }
      return { provider: 'github', id: String(id), name: login };
    },
  };
};

const readField = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
