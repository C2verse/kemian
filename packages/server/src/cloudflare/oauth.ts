import {
  AuthorizationError,
  authorizationErrorRedirect,
  CimdFetchError,
  type ConsentDescription,
  getOAuthApi,
  type OAuthHelpers,
  OAuthProvider,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider';

import { type Identity, identityKeyOf, type Kemian, type SignInProvider } from '../core/index.ts';

/**
 * Paths of the OAuth endpoints a Kemian Worker serves when sign-in is enabled.
 */
export const OAUTH_PATHS = {
  authorize: '/authorize',
  callback: '/callback',
  token: '/token',
  register: '/register',
} as const;

/**
 * Execution context of a Worker request.
 */
export type WorkerContext = Parameters<OAuthProvider<object>['fetch']>[2];

/**
 * Handler shape the OAuth provider and the Worker share.
 */
export interface FetchHandler<Env> {
  fetch(request: Request, env: Env, context: WorkerContext): Promise<Response>;
}

/**
 * Creates the OAuth authorization server of a Kemian Worker, protecting the MCP endpoint at `origin`.
 *
 * Callers sign in with the sign-in provider after a consent page; an identity without a level is refused.
 */
export const makeOAuthServer = <Env extends object>(options: {
  readonly origin: string;
  readonly mcpPath: string;
  readonly kemian: Kemian;
  readonly signIn: SignInProvider;
  readonly serveMcp: (request: Request, identity: Identity) => Promise<Response>;
  readonly fallback: (request: Request, env: Env, context: WorkerContext) => Promise<Response>;
}): FetchHandler<Env> => {
  const providerOptions: OAuthProviderOptions<Env> = {
    apiRoute: options.mcpPath,
    apiHandler: {
      fetch: async (request: Request, _env: Env, context: object) => {
        const identity = readIdentity(Reflect.get(context, 'props'));
        if (identity === undefined)
          return new Response('Invalid token properties', { status: 401 });
        return options.serveMcp(request, identity);
      },
    },
    defaultHandler: {
      fetch: async (request: Request, env: Env, context: WorkerContext) => {
        const { pathname } = new URL(request.url);
        if (pathname === OAUTH_PATHS.authorize || pathname === OAUTH_PATHS.callback) {
          return handleSignIn(request, getOAuthApi(providerOptions, env), options);
        }
        return options.fallback(request, env, context);
      },
    },
    authorizeEndpoint: OAUTH_PATHS.authorize,
    tokenEndpoint: OAUTH_PATHS.token,
    clientRegistrationEndpoint: OAUTH_PATHS.register,
    resourceMetadata: {
      resource: `${options.origin}${options.mcpPath}`,
      authorization_servers: [options.origin],
    },
  };
  const provider = new OAuthProvider<Env>(providerOptions);
  return { fetch: (request, env, context) => provider.fetch(request, env, context) };
};

const handleSignIn = async (
  request: Request,
  oauth: OAuthHelpers,
  options: { readonly origin: string; readonly kemian: Kemian; readonly signIn: SignInProvider },
): Promise<Response> => {
  try {
    const { pathname } = new URL(request.url);
    if (pathname === OAUTH_PATHS.callback) return await finishSignIn(request, oauth, options);
    if (request.method === 'POST') return await continueToSignIn(request, oauth, options);
    return await showConsent(request, oauth, options.signIn);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo !== undefined) {
      return Response.redirect(error.redirectTo, 302);
    }
    if (error instanceof AuthorizationError) return textResponse(400, error.description);
    if (error instanceof CimdFetchError)
      return textResponse(400, 'This app could not be verified.');
    throw error;
  }
};

const showConsent = async (request: Request, oauth: OAuthHelpers, signIn: SignInProvider) => {
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  consent.headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(renderConsentPage(details, consent.handle, signIn), {
    headers: consent.headers,
  });
};

const continueToSignIn = async (
  request: Request,
  oauth: OAuthHelpers,
  options: { readonly origin: string; readonly signIn: SignInProvider },
) => {
  const form = await request.formData();
  const handleField = form.get('handle');
  const handle = typeof handleField === 'string' ? handleField : '';
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle);
  const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { state, headers } = await oauth.beginUpstream(approved.request, {
    data: { verifier },
    headers: approved.headers,
  });
  headers.set(
    'location',
    options.signIn.authorizeUrl({
      state,
      redirectUri: `${options.origin}${OAUTH_PATHS.callback}`,
      codeChallenge: await s256(verifier),
    }),
  );
  return new Response(null, { status: 302, headers });
};

const finishSignIn = async (
  request: Request,
  oauth: OAuthHelpers,
  options: { readonly origin: string; readonly kemian: Kemian; readonly signIn: SignInProvider },
) => {
  const { request: original, data, headers } = await oauth.finishUpstream(request);
  const code = new URL(request.url).searchParams.get('code');
  const verifier =
    typeof data === 'object' && data !== null ? Reflect.get(data, 'verifier') : undefined;
  if (code === null || typeof verifier !== 'string') {
    headers.set('location', authorizationErrorRedirect(original, 'access_denied'));
    return new Response(null, { status: 302, headers });
  }

  const identity = await options.signIn.completeSignIn({
    code,
    redirectUri: `${options.origin}${OAUTH_PATHS.callback}`,
    codeVerifier: verifier,
  });
  if (options.kemian.resolveLevel(identity) === undefined) {
    const description = `${identity.name ?? identityKeyOf(identity)} has no access to this knowledge base.`;
    headers.set('location', authorizationErrorRedirect(original, 'access_denied', description));
    return new Response(null, { status: 302, headers });
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    // The provider reserves `:` in user IDs, which identity keys use.
    userId: `${identity.provider}.${identity.id}`,
    metadata: { name: identity.name },
    scope: original.scope,
    props: identity,
  });
  headers.set('location', redirectTo);
  return new Response(null, { status: 302, headers });
};

const readIdentity = (props: unknown): Identity | undefined => {
  if (typeof props !== 'object' || props === null) return undefined;
  const provider: unknown = Reflect.get(props, 'provider');
  const id: unknown = Reflect.get(props, 'id');
  const name: unknown = Reflect.get(props, 'name');
  if (typeof provider !== 'string' || typeof id !== 'string') return undefined;
  return typeof name === 'string' ? { provider, id, name } : { provider, id };
};

const s256 = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);

const textResponse = (status: number, message: string): Response =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const renderConsentPage = (
  details: ConsentDescription,
  handle: string,
  signIn: SignInProvider,
): string => {
  const name = escapeHtml(details.clientName);
  const origin =
    details.clientDomain === undefined
      ? 'This app registered itself, so its name is not verified.'
      : `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`;
  const loopbackWarning = details.redirectIsLoopback
    ? '<p><strong>Access will go to an app on your computer.</strong> Continue only if you just started signing in from it.</p>'
    : '';
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Allow ${name}?</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #1f2328; }
  button { font: inherit; padding: 0.5rem 1rem; margin-right: 0.5rem; }
</style>
<h1>Allow ${name} to read this knowledge base?</h1>
<p>${origin} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${loopbackWarning}
<p>You'll sign in with ${escapeHtml(signIn.displayName)}. Only accounts that have been given access can continue.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <button name="decision" value="approve">Continue with ${escapeHtml(signIn.displayName)}</button>
  <button name="decision" value="deny">Cancel</button>
</form>
</html>`;
};
