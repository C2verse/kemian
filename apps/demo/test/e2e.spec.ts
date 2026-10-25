import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';

const demo = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('../../../fixtures/knowledge-base/', import.meta.url));
const cli = fileURLToPath(new URL('../../../packages/server/src/bundler/cli.ts', import.meta.url));
const token = 'e2e-publish-token';

const harness = createTestHarness({
  root: demo,
  workers: [{ configPath: 'wrangler.jsonc', secrets: { KEMIAN_PUBLISH_TOKEN: token } }],
});
let baseUrl: URL;

const publishFixture = (options: { readonly token: string }) =>
  new Promise<{ readonly code: number; readonly output: string }>((resolve) => {
    execFile(
      'node',
      [cli, 'publish', '--url', baseUrl.href, '--source', 'e2e'],
      { cwd: fixture, env: { ...process.env, KEMIAN_PUBLISH_TOKEN: options.token } },
      (error, stdout, stderr) => {
        const code = typeof error?.code === 'number' ? error.code : error === null ? 0 : -1;
        resolve({ code, output: stdout + stderr });
      },
    );
  });

const connect = async () => {
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('mcp', baseUrl)));
  return client;
};

const callTool = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  return result.content
    .map((part) => (typeof part === 'object' && part !== null ? Reflect.get(part, 'text') : ''))
    .join('');
};

beforeAll(async () => {
  ({ url: baseUrl } = await harness.listen());
});

afterAll(async () => {
  await harness.close();
});

describe('demo Worker', () => {
  it('serves the fallback outside MCP and publishing', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Connect an MCP client to /mcp.');
  });

  it('rejects publishing with a wrong token', async () => {
    const { code, output } = await publishFixture({ token: 'wrong' });
    expect(output).toContain('answered 401: Invalid publish token.');
    expect(code).toBe(1);
  });

  it('publishes the fixture knowledge base with the CLI', async () => {
    const { code, output } = await publishFixture({ token });
    expect(output).toContain('public: 5 file(s)');
    expect(output).toContain('private: 14 file(s)');
    expect(code).toBe(0);
  });

  it('serves the public level to anonymous MCP clients', async () => {
    const client = await connect();
    expect(client.getInstructions()).toContain('"public" access level');
    expect(client.getInstructions()).toContain("public part of Robin Example's knowledge base");

    const root = await callTool(client, 'list', {});
    expect(root).toContain('- about/: Who Robin is and how to reach them.');
    expect(root).not.toContain('journal/README.md');

    const profile = await callTool(client, 'read', {
      paths: ['about/profile.md', 'about/contact.md'],
    });
    expect(profile).toContain('a mid-sized developer tools company');
    expect(profile).not.toContain('Quillwork');
    expect(profile).not.toContain('95,000');
    expect(profile).toContain('# about/contact.md\n\nNot found.');

    expect(await callTool(client, 'search', { query: 'language server' })).toContain(
      'projects/lantern.md',
    );
    expect(await callTool(client, 'search', { query: 'Atlas' })).toBe('No matches for "Atlas".');
    await client.close();
  });

  it('serves 2025-era clients over plain HTTP', async () => {
    const response = await fetch(new URL('mcp', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'legacy', version: '1' },
        },
      }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"protocolVersion":"2025-06-18"');
    expect(text).toContain('serverInfo');
  });

  it('serves a republished build', async () => {
    expect((await publishFixture({ token })).code).toBe(0);
    const client = await connect();
    expect(await callTool(client, 'read', { paths: ['projects/lantern.md'] })).toContain(
      '# Lantern',
    );
    await client.close();
  });

  it('answers CORS preflight requests for browser clients', async () => {
    const response = await fetch(new URL('mcp', baseUrl), { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
