import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { buildBundleSet } from '../src/bundler/index.ts';
import {
  createKemian,
  type Identity,
  type Kemian,
  memoryBundleStore,
  memoryProposalStore,
} from '../src/core/index.ts';
import { FakeGitHub } from './github-fake.ts';
import { type HttpServing, serveOverHttp } from './http-serving.ts';

const cli = fileURLToPath(new URL('../src/bundler/cli.ts', import.meta.url));
const robin: Identity = { provider: 'github', id: '12345', name: 'robin' };
const proposalsToken = 'proposals-token';
const githubToken = 'github-token';

const files: Readonly<Record<string, string>> = {
  'kemian.config.ts':
    "export default { levels: ['public', 'private'], frontmatter: { keep: ['status'] }, review: { intervals: { evolving: 30 } } };\n",
  'README.md': '---\nvisibility: public\n---\n# Robin Example\n',
  'projects/lantern.md':
    '---\nvisibility: public\nstatus: stable\n---\n# Lantern\n\nLantern gives YAML files completion. <private>It earns 95,000 a year.</private>\n',
  'journal/move.md':
    '---\nstatus: evolving\nverified: 2020-01-01\n---\n# Move\n\nRobin lives in Lisbon.\n',
  'journal/old.md': '---\nstatus: evolving\nupdated: 2019-06-01\n---\n# Old\n\nAn old plan.\n',
};

let root: string;
let kemian: Kemian;
let proposals: ReturnType<typeof memoryProposalStore>;
let server: HttpServing;
let github: FakeGitHub;
let githubServing: HttpServing;

const connect = async () => {
  const client = new Client({ name: 'editing', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('https://kemian.test/mcp'), {
      fetch: (input, init) => kemian.handleMcp(new Request(input, init), { identity: robin }),
    }),
  );
  return client;
};

const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content
    .map((part) => (typeof part === 'object' && part !== null ? Reflect.get(part, 'text') : ''))
    .join('');
  if (result.isError === true) throw new Error(`${name} failed: ${text}`);
  return text;
};

const pullWithCli = (summaryPath: string) =>
  new Promise<{ readonly code: number; readonly output: string }>((resolve) => {
    execFile(
      'node',
      [cli, 'proposals', 'pull'],
      {
        cwd: root,
        env: {
          ...process.env,
          KEMIAN_URL: server.url,
          KEMIAN_PROPOSALS_TOKEN: proposalsToken,
          GITHUB_REPOSITORY: 'robin/kb',
          GITHUB_SHA: 'base',
          GITHUB_TOKEN: githubToken,
          GITHUB_API_URL: githubServing.url,
          GITHUB_STEP_SUMMARY: summaryPath,
        },
      },
      (error, stdout, stderr) => {
        const code = typeof error?.code === 'number' ? error.code : error === null ? 0 : -1;
        resolve({ code, output: stdout + stderr });
      },
    );
  });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kemian-editing-'));
  await mkdir(join(root, '.git'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const { bundleSet, problems } = await buildBundleSet({
    configPath: join(root, 'kemian.config.ts'),
    build: { id: 'build-1' },
  });
  if (problems.length > 0) throw new Error(`fixture has problems: ${JSON.stringify(problems)}`);
  const store = memoryBundleStore();
  await store.replace(bundleSet);
  proposals = memoryProposalStore();
  kemian = createKemian({
    store,
    levels: { private: ['github:12345'] },
    editing: { proposals, editors: ['github:12345'], proposalsToken },
  });
  server = await serveOverHttp((request) => kemian.handleProposals(request));
  github = new FakeGitHub({ repo: 'robin/kb', token: githubToken, files });
  githubServing = await github.listen();
});

afterAll(async () => {
  await server.close();
  await githubServing.close();
});

describe('editing, from an agent to pull requests', () => {
  it('queues what an editor proposes through the MCP tools', async () => {
    const client = await connect();
    const lantern = await call(client, 'read', { paths: ['projects/lantern.md'] });
    expect(lantern).toContain('Build: build-1');
    await call(client, 'propose_edit', {
      path: 'projects/lantern.md',
      build: 'build-1',
      edits: [{ old: 'YAML files completion.', new: 'YAML and TOML files completion.' }],
      reason: 'Robin said TOML shipped.',
    });
    await call(client, 'note', {
      title: 'Robin is speaking at a meetup',
      body: 'Robin speaks about language servers in December.',
      about: ['projects/lantern.md'],
    });

    const stale = await call(client, 'list_stale', {});
    expect(stale.indexOf('journal/old.md')).toBeLessThan(stale.indexOf('journal/move.md'));
    await call(client, 'resolve_stale', {
      path: 'journal/move.md',
      build: 'build-1',
      verdict: 'current',
    });
    await call(client, 'resolve_stale', {
      path: 'journal/old.md',
      build: 'build-1',
      verdict: 'obsolete',
    });
    expect(await proposals.list()).toHaveLength(4);
  });

  it('turns them into reviewed pull requests and a direct commit with kemian proposals pull', async () => {
    const summaryPath = join(root, '..', `${root.split('/').at(-1) ?? ''}-summary.md`);
    const { code, output } = await pullWithCli(summaryPath);
    expect(output).toContain('4 proposal(s):');
    expect(code).toBe(0);

    expect(github.pulls.map((pull) => pull.title)).toEqual([
      'Edit projects/lantern.md',
      'Note: Robin is speaking at a meetup',
      'Retire obsolete journal/old.md',
    ]);
    expect(github.statuses.every((status) => status.state === 'success')).toBe(true);
    const editBranch = github.pulls[0]?.head ?? '';
    expect(github.filesOf(editBranch).get('projects/lantern.md')).toContain(
      'YAML and TOML files completion. <private>It earns 95,000 a year.</private>',
    );
    expect(github.pulls[0]?.body).toContain('+ Lantern gives YAML and TOML files completion.');
    expect(github.pulls[0]?.body).not.toContain('95,000');
    expect(github.filesOf(github.pulls[2]?.head ?? '').get('journal/old.md')).toContain(
      'status: archived',
    );
    expect(github.filesOf('main').get('journal/move.md')).toContain(
      `verified: ${new Date().toISOString().slice(0, 10)}`,
    );
    expect(await proposals.list()).toEqual([]);
    expect(await readFile(summaryPath, 'utf8')).toContain('## Kemian Proposals');
  });

  it('finds nothing left on the next run', async () => {
    const { code, output } = await pullWithCli(join(root, '..', 'unused-summary.md'));
    expect(output).toContain('No pending proposals.');
    expect(code).toBe(0);
  });
});
