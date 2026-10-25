import { describe, expect, it } from '@effect/vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Schema } from 'effect';

import { bundleSetOf } from '../../test/bundles.ts';
import type { Identity } from './access.ts';
import { memoryBundleStore } from './bundle-store.memory.ts';
import { createKemian, type Kemian, type KemianOptions } from './kemian.ts';

const robin: Identity = { provider: 'github', id: '12345', name: 'robin' };
const token = 'publish-token';

const makeKemian = async (options: Partial<KemianOptions> = {}) => {
  const store = memoryBundleStore();
  await store.replace(bundleSetOf());
  return createKemian({
    store,
    levels: { private: ['github:12345'] },
    publishToken: token,
    ...options,
  });
};

const connect = async (kemian: Kemian, identity?: Identity) => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('https://kemian.test/mcp'), {
    fetch: (input, init) => kemian.handleMcp(new Request(input, init), { identity }),
  });
  await client.connect(transport);
  return client;
};

const textOf = (result: { readonly content: readonly unknown[] }): string =>
  result.content
    .map((part) => (typeof part === 'object' && part !== null ? Reflect.get(part, 'text') : ''))
    .join('');

const callTool = async (client: Client, name: string, args: Record<string, unknown>) =>
  textOf(await client.callTool({ name, arguments: args }));

const messageOf = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data === undefined ? text : data.slice('data: '.length));
};

const publish = (kemian: Kemian, body: unknown, options: { readonly token?: string } = {}) =>
  kemian.handlePublish(
    new Request('https://kemian.test/publish', {
      method: 'PUT',
      headers: {
        'authorization': `Bearer ${options.token ?? token}`,
        'content-type': 'application/json',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('MCP', () => {
  it('serves the anonymous level the public bundle', async () => {
    const client = await connect(await makeKemian());
    expect(client.getInstructions()).toContain('"public" access level');
    expect(client.getInstructions()).toContain('Answer only from these files.');
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).toSorted()).toEqual(['list', 'read', 'search']);

    const root = await callTool(client, 'list', {});
    expect(root).toContain('- projects/: Things Robin has built.');
    expect(root).toContain('Answer only from these files.');
    expect(await callTool(client, 'list', { path: 'projects' })).not.toContain('atlas');
    expect(await callTool(client, 'read', { paths: ['projects/atlas.md'] })).toContain(
      'Not found.',
    );
    expect(await callTool(client, 'search', { query: 'unannounced' })).toBe(
      'No matches for "unannounced".',
    );
  });

  it('serves a listed identity its level', async () => {
    const client = await connect(await makeKemian(), robin);
    expect(client.getInstructions()).toContain('"private" access level');
    const atlas = await callTool(client, 'read', { paths: ['projects/atlas.md', 'README.md'] });
    expect(atlas).toContain('Visibility: private');
    expect(atlas).toContain('A map of internal services.');
    expect(atlas).toContain('# README.md');
    expect(await callTool(client, 'search', { query: 'unannounced' })).toContain(
      'projects/atlas.md',
    );
  });

  it('includes metadata when reading', async () => {
    const client = await connect(await makeKemian());
    const lantern = await callTool(client, 'read', { paths: ['projects/lantern.md'] });
    expect(lantern).toContain('Updated: 2026-10-12');
    expect(lantern).toContain('URL: https://example.com/projects/lantern.md');
    expect(lantern).toContain('status: "stable"');
  });

  it('rejects invalid tool arguments', async () => {
    const client = await connect(await makeKemian());
    const result = await client.callTool({ name: 'read', arguments: { paths: [] } });
    expect(result.isError).toBe(true);
  });

  it('refuses an identity without a level', async () => {
    const kemian = await makeKemian();
    const response = await kemian.handleMcp(
      new Request('https://kemian.test/mcp', { method: 'POST' }),
      {
        identity: { provider: 'github', id: '999' },
      },
    );
    expect(response.status).toBe(403);
  });

  it('refuses anonymous callers when login is required', async () => {
    const kemian = await makeKemian({ anonymous: false });
    const response = await kemian.handleMcp(
      new Request('https://kemian.test/mcp', { method: 'POST' }),
      {
        identity: undefined,
      },
    );
    expect(response.status).toBe(403);
  });

  it('reports when nothing is published', async () => {
    const kemian = createKemian({ store: memoryBundleStore() });
    const response = await kemian.handleMcp(
      new Request('https://kemian.test/mcp', { method: 'POST' }),
      {
        identity: undefined,
      },
    );
    expect(response.status).toBe(503);
  });

  it('serves 2025-era clients statelessly', async () => {
    const kemian = await makeKemian();
    const post = (body: unknown) =>
      kemian.handleMcp(
        new Request('https://kemian.test/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-06-18',
          },
          body: JSON.stringify(body),
        }),
        { identity: undefined },
      );
    const initialize = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'legacy', version: '1' },
      },
    });
    expect(initialize.status).toBe(200);
    expect(await messageOf(initialize)).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        instructions: expect.stringContaining('"public" access level'),
      },
    });

    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(list.status).toBe(200);
    expect(await messageOf(list)).toMatchObject({
      id: 2,
      result: { tools: expect.arrayContaining([expect.objectContaining({ name: 'search' })]) },
    });
  });

  it('adds tools from the extend hook for the caller', async () => {
    const kemian = await makeKemian({
      extend: ({ registerTool }, caller) => {
        registerTool({
          name: 'whoami',
          description: 'Returns the caller level.',
          input: Schema.toStandardJSONSchemaV1(
            Schema.toStandardSchemaV1(Schema.Struct({ greeting: Schema.String })),
          ),
          handler: async ({ greeting }) => `${greeting}, ${caller.level} caller`,
        });
      },
    });
    const client = await connect(kemian, robin);
    expect(await callTool(client, 'whoami', { greeting: 'Hello' })).toBe('Hello, private caller');
  });
});

describe('publishing', () => {
  it('replaces the bundles every level sees', async () => {
    const kemian = await makeKemian();
    const set = bundleSetOf('build-2');
    const lantern = set.bundles[0].files[1];
    if (lantern === undefined) throw new Error('missing fixture file');
    const updated = {
      ...set,
      bundles: [
        { ...set.bundles[0], files: [{ ...lantern, content: 'Lantern 2.0 is out.' }] },
        ...set.bundles.slice(1),
      ],
    };
    const response = await publish(kemian, updated);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      build: { id: 'build-2', createdAt: '2026-10-25T12:00:00Z' },
      bundles: [
        { level: 'public', files: 1 },
        { level: 'private', files: 3 },
      ],
    });
    const client = await connect(kemian);
    expect(await callTool(client, 'read', { paths: ['projects/lantern.md'] })).toContain(
      'Lantern 2.0 is out.',
    );
  });

  it.each([
    ['a wrong token', { token: 'wrong' }, bundleSetOf(), 401],
    ['a body that is not JSON', {}, 'not json', 400],
    ['an invalid bundle set', {}, { protocol: 1 }, 400],
    ['an unsupported protocol', {}, { ...bundleSetOf(), protocol: 2 }, 400],
  ] as const)('rejects %s and keeps the current build', async (_, options, body, status) => {
    const kemian = await makeKemian();
    const response = await publish(kemian, body, options);
    expect(response.status).toBe(status);
    const client = await connect(kemian);
    expect(await callTool(client, 'read', { paths: ['projects/lantern.md'] })).toContain(
      'completion',
    );
  });

  it('is disabled without a publish token', async () => {
    const kemian = await makeKemian({ publishToken: '' });
    expect((await publish(kemian, bundleSetOf())).status).toBe(403);
  });

  it('accepts only PUT and POST', async () => {
    const kemian = await makeKemian();
    const response = await kemian.handlePublish(new Request('https://kemian.test/publish'));
    expect(response.status).toBe(405);
  });
});
