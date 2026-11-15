import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

const demo = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('../../../fixtures/knowledge-base/', import.meta.url));
const cli = fileURLToPath(new URL('../../../packages/server/src/bundler/cli.ts', import.meta.url));
const publishToken = 'sign-in-publish-token';
const clientRedirect = 'http://127.0.0.1:9/callback';

const base64Url = (bytes: Buffer): string => bytes.toString('base64url');
const readString = (value: unknown, key: string): string | undefined => {
  const field: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
  return typeof field === 'string' ? field : undefined;
};
const s256 = (verifier: string): string =>
  base64Url(createHash('sha256').update(verifier).digest());

const githubUsers: Readonly<Record<string, { readonly id: number; readonly login: string }>> = {
  'robin-code': { id: 12345, login: 'robin' },
  'stranger-code': { id: 999, login: 'stranger' },
};

const startFakeGitHub = () => {
  const challenges = new Set<string>();
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/login/oauth/access_token') {
        const payload: unknown = JSON.parse(body);
        const code = readString(payload, 'code');
        const verifier = readString(payload, 'code_verifier');
        const isVerified = verifier !== undefined && challenges.has(s256(verifier));
        const user = code === undefined ? undefined : githubUsers[code];
        response.end(
          JSON.stringify(
            isVerified && user !== undefined
              ? { access_token: `token-for-${user.id}` }
              : { error: 'bad_verification_code' },
          ),
        );
        return;
      }
      if (request.url === '/user') {
        const id = Number(request.headers.authorization?.replace('Bearer token-for-', ''));
        const user = Object.values(githubUsers).find((candidate) => candidate.id === id);
        response.statusCode = user === undefined ? 401 : 200;
        response.end(JSON.stringify(user ?? { message: 'Bad credentials' }));
        return;
      }
      response.statusCode = 404;
      response.end('{}');
    });
  });
  return { server, challenges };
};

const github = startFakeGitHub();
let githubUrl: string;
let baseUrl: URL;
let harness: ReturnType<typeof createTestHarness>;

const cookieHeaderOf = (responses: readonly Response[]): string =>
  responses
    .flatMap((response) => response.headers.getSetCookie())
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

const register = async (options: { readonly clientName?: string } = {}): Promise<string> => {
  const response = await fetch(new URL('register', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: options.clientName ?? 'E2E client',
      redirect_uris: [clientRedirect],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  expect(response.status).toBe(201);
  return readString(await response.json(), 'client_id') ?? '';
};

const authorizeUrlOf = (options: { readonly clientId: string; readonly verifier: string }) => {
  const authorizeUrl = new URL('authorize', baseUrl);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: clientRedirect,
    code_challenge: s256(options.verifier),
    code_challenge_method: 'S256',
    state: 'client-state',
    resource: new URL('mcp', baseUrl).href,
  }).toString();
  return authorizeUrl;
};

/** Runs the browser part of the OAuth flow and returns where the Worker finally redirects the client. */
const authorize = async (options: {
  readonly github: { readonly code: string } | { readonly error: string };
  readonly decision?: string;
}) => {
  const clientId = await register();
  const verifier = base64Url(randomBytes(32));
  const authorizeUrl = authorizeUrlOf({ clientId, verifier });

  const consent = await fetch(authorizeUrl, { redirect: 'manual' });
  expect(consent.status).toBe(200);
  const page = await consent.text();
  expect(page).toContain('Allow E2E client to read this knowledge base?');
  const handle = /name="handle" value="([^"]+)"/u.exec(page)?.[1] ?? '';

  const approval = await fetch(authorizeUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: cookieHeaderOf([consent]) },
    body: new URLSearchParams({ handle, decision: options.decision ?? 'approve' }),
  });
  expect(approval.status).toBe(302);
  const githubAuthorize = new URL(approval.headers.get('location') ?? '');
  if (githubAuthorize.origin !== new URL(githubUrl).origin)
    return { location: githubAuthorize, clientId, verifier };
  github.challenges.add(githubAuthorize.searchParams.get('code_challenge') ?? '');

  const callbackUrl = new URL('callback', baseUrl);
  callbackUrl.search = new URLSearchParams({
    ...options.github,
    state: githubAuthorize.searchParams.get('state') ?? '',
  }).toString();
  const callback = await fetch(callbackUrl, {
    redirect: 'manual',
    headers: { cookie: cookieHeaderOf([consent, approval]) },
  });
  expect(callback.status).toBe(302);
  return { location: new URL(callback.headers.get('location') ?? ''), clientId, verifier };
};

const exchangeCode = async (options: {
  readonly code: string;
  readonly clientId: string;
  readonly verifier: string;
}) => {
  const response = await fetch(new URL('token', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: clientRedirect,
      client_id: options.clientId,
      code_verifier: options.verifier,
      resource: new URL('mcp', baseUrl).href,
    }),
  });
  expect(response.status).toBe(200);
  return readString(await response.json(), 'access_token') ?? '';
};

const connect = async (accessToken?: string) => {
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  const headers: Record<string, string> =
    accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` };
  await client.connect(
    new StreamableHTTPClientTransport(new URL('mcp', baseUrl), { requestInit: { headers } }),
  );
  return client;
};

const readText = async (client: Client, path: string) => {
  const result = await client.callTool({ name: 'read', arguments: { paths: [path] } });
  return result.content
    .map((part) => (typeof part === 'object' && part !== null ? Reflect.get(part, 'text') : ''))
    .join('');
};

beforeAll(async () => {
  await new Promise<void>((resolve) => github.server.listen(0, '127.0.0.1', resolve));
  const address = github.server.address();
  if (address === null || typeof address === 'string') throw new Error('fake GitHub has no port');
  githubUrl = `http://127.0.0.1:${address.port}`;
  harness = createTestHarness({
    root: demo,
    workers: [
      {
        configPath: 'wrangler.jsonc',
        vars: {
          GITHUB_CLIENT_ID: 'client-id',
          GITHUB_BASE_URL: githubUrl,
          GITHUB_API_BASE_URL: githubUrl,
          PRIVATE_IDENTITIES: 'github:12345',
        },
        secrets: { KEMIAN_PUBLISH_TOKEN: publishToken, GITHUB_CLIENT_SECRET: 'client-secret' },
      },
    ],
  });
  ({ url: baseUrl } = await harness.listen());
  await new Promise<void>((resolve, reject) => {
    execFile(
      'node',
      [cli, 'publish', '--url', baseUrl.href],
      { cwd: fixture, env: { ...process.env, KEMIAN_PUBLISH_TOKEN: publishToken } },
      (error) => (error === null ? resolve() : reject(error)),
    );
  });
});

afterAll(async () => {
  await harness.close();
  await new Promise<void>((resolve) => github.server.close(() => resolve()));
});

describe('sign-in', () => {
  it('asks for a login when a level is requested', async () => {
    const response = await fetch(new URL('mcp?access=private', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('keeps serving anonymous callers the public level', async () => {
    const client = await connect();
    expect(client.getInstructions()).toContain('"public" access level');
    expect(await readText(client, 'projects/atlas.md')).toContain('Not found.');
    await client.close();
  });

  it('signs in a listed GitHub user and serves the private level', async () => {
    const { location, clientId, verifier } = await authorize({ github: { code: 'robin-code' } });
    expect(location.origin + location.pathname).toBe(clientRedirect);
    expect(location.searchParams.get('state')).toBe('client-state');
    const accessToken = await exchangeCode({
      code: location.searchParams.get('code') ?? '',
      clientId,
      verifier,
    });

    const client = await connect(accessToken);
    expect(client.getInstructions()).toContain('"private" access level');
    const atlas = await readText(client, 'projects/atlas.md');
    expect(atlas).toContain('Two friends are testing it');
    expect(atlas).toContain('Visibility: private');
    await client.close();
  });

  it('refuses a GitHub user without a level', async () => {
    const { location } = await authorize({ github: { code: 'stranger-code' } });
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('error_description')).toContain('stranger has no access');
  });

  it('returns access_denied when the user cancels on the consent page', async () => {
    const { location } = await authorize({ github: { code: 'robin-code' }, decision: 'deny' });
    expect(location.origin + location.pathname).toBe(clientRedirect);
    expect(location.searchParams.get('error')).toBe('access_denied');
  });

  it('returns access_denied when the user cancels on GitHub', async () => {
    const { location } = await authorize({ github: { error: 'access_denied' } });
    expect(location.origin + location.pathname).toBe(clientRedirect);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('client-state');
  });

  it('escapes the name a client registered for itself on the consent page', async () => {
    const clientId = await register({ clientName: '<img src=x onerror=alert(1)>' });
    const verifier = base64Url(randomBytes(32));
    const consent = await fetch(authorizeUrlOf({ clientId, verifier }), { redirect: 'manual' });
    const page = await consent.text();
    expect(page).not.toContain('<img');
    expect(page).toContain('Allow &#60;img src=x onerror=alert(1)&#62; to read');
  });

  it('rejects an invalid token', async () => {
    const response = await fetch(new URL('mcp', baseUrl), {
      method: 'POST',
      headers: {
        'authorization': 'Bearer invalid',
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
  });
});
