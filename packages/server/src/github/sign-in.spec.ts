import { describe, expect, it } from '@effect/vitest';

import { githubSignIn } from './sign-in.ts';

const fakeGitHub = (options: { readonly tokenStatus?: number; readonly user?: unknown } = {}) => {
  const requests: Request[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url.endsWith('/login/oauth/access_token')) {
      return options.tokenStatus === undefined
        ? Response.json({ access_token: 'gh-token' })
        : Response.json({ error: 'bad_verification_code' }, { status: options.tokenStatus });
    }
    return Response.json(options.user ?? { id: 12345, login: 'robin' });
  };
  return { fetch, requests };
};

describe('githubSignIn', () => {
  it('builds the authorize URL with PKCE', () => {
    const url = new URL(
      githubSignIn({ clientId: 'client', clientSecret: 'secret' }).authorizeUrl({
        state: 'state-1',
        redirectUri: 'https://kb.example.com/callback',
        codeChallenge: 'challenge',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client',
      redirect_uri: 'https://kb.example.com/callback',
      state: 'state-1',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      allow_signup: 'false',
    });
  });

  it('exchanges the code and returns the user as an identity', async () => {
    const github = fakeGitHub();
    const identity = await githubSignIn({
      clientId: 'client',
      clientSecret: 'secret',
      baseUrl: 'https://github.test/',
      apiBaseUrl: 'https://api.github.test',
      fetch: github.fetch,
    }).completeSignIn({
      code: 'code',
      redirectUri: 'https://kb.example.com/callback',
      codeVerifier: 'verifier',
    });
    expect(identity).toEqual({ provider: 'github', id: '12345', name: 'robin' });
    const [tokenRequest, userRequest] = github.requests;
    expect(tokenRequest?.url).toBe('https://github.test/login/oauth/access_token');
    expect(await tokenRequest?.json()).toMatchObject({
      code: 'code',
      code_verifier: 'verifier',
      client_secret: 'secret',
    });
    expect(userRequest?.url).toBe('https://api.github.test/user');
    expect(userRequest?.headers.get('authorization')).toBe('Bearer gh-token');
  });

  it('fails when GitHub refuses the code', async () => {
    const signIn = githubSignIn({
      clientId: 'c',
      clientSecret: 's',
      fetch: fakeGitHub({ tokenStatus: 400 }).fetch,
    });
    await expect(
      signIn.completeSignIn({ code: 'x', redirectUri: 'https://x', codeVerifier: 'v' }),
    ).rejects.toThrow('GitHub refused the sign-in: bad_verification_code');
  });

  it('fails when the user is malformed', async () => {
    const signIn = githubSignIn({
      clientId: 'c',
      clientSecret: 's',
      fetch: fakeGitHub({ user: { login: 'x' } }).fetch,
    });
    await expect(
      signIn.completeSignIn({ code: 'x', redirectUri: 'https://x', codeVerifier: 'v' }),
    ).rejects.toThrow("GitHub didn't return the user");
  });
});
