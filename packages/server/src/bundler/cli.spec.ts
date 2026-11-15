import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@effect/vitest';

const cli = fileURLToPath(new URL('cli.ts', import.meta.url));
const fixture = fileURLToPath(new URL('../../../../fixtures/knowledge-base/', import.meta.url));

const runCli = (
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
) =>
  new Promise<{ readonly code: number; readonly output: string }>((resolve) => {
    execFile('node', [cli, ...args], { cwd, env }, (error, stdout, stderr) => {
      const code = typeof error?.code === 'number' ? error.code : error === null ? 0 : -1;
      resolve({ code, output: stdout + stderr });
    });
  });

const makeKnowledgeBase = async (files: Readonly<Record<string, string>>) => {
  const root = await mkdtemp(join(tmpdir(), 'kemian-'));
  await writeFile(
    join(root, 'kemian.config.ts'),
    "export default { levels: ['public', 'private'] };\n",
  );
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  return root;
};

describe('kemian check', () => {
  it('passes on the fixture knowledge base', async () => {
    const { code, output } = await runCli(['check'], fixture);
    expect(output).toContain('0 error(s), 0 warning(s)');
    expect(code).toBe(0);
  });

  it('fails and reports malformed markup', async () => {
    const root = await makeKnowledgeBase({ 'a.md': 'a <private>never closed' });
    const { code, output } = await runCli(['check'], root);
    expect(output).toContain('a.md');
    expect(output).toContain('line 1: <private> span must close on the same line');
    expect(code).toBe(1);
  });

  it('fails when the config is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kemian-'));
    const { code, output } = await runCli(['check'], root);
    expect(output).toContain('file not found');
    expect(code).toBe(1);
  });
});

describe('kemian build', () => {
  it('writes the bundle set', async () => {
    const root = await makeKnowledgeBase({
      'a.md': '---\nvisibility: public\n---\nHello <private>secret</private>',
    });
    const { code } = await runCli(['build', '--source', 'abc123'], root);
    expect(code).toBe(0);
    const bundleSet = JSON.parse(await readFile(join(root, 'dist/kemian/bundle-set.json'), 'utf8'));
    expect(bundleSet.build.source).toBe('abc123');
    expect(bundleSet.bundles[0].files[0].content).toBe('Hello');
  });
});

describe('kemian proposals pull', () => {
  const {
    GITHUB_TOKEN: _token,
    GITHUB_REPOSITORY: _repository,
    GITHUB_SHA: _sha,
    ...cleanEnv
  } = process.env;
  const env = {
    ...cleanEnv,
    KEMIAN_URL: 'http://127.0.0.1:9',
    KEMIAN_PROPOSALS_TOKEN: 'token',
  };

  it.each([
    ['no server URL', { KEMIAN_URL: undefined }, [], 'pass --url or set KEMIAN_URL'],
    ['no proposals token', { KEMIAN_PROPOSALS_TOKEN: '' }, [], 'set KEMIAN_PROPOSALS_TOKEN'],
    ['no repository', {}, [], 'pass --repo owner/name or set GITHUB_REPOSITORY'],
    ['no base commit', {}, ['--repo', 'robin/kb'], 'pass --base <commit> or set GITHUB_SHA'],
    [
      'no GitHub token',
      {},
      ['--repo', 'robin/kb', '--base', 'abc'],
      "can't open pull requests: set GITHUB_TOKEN",
    ],
  ])('fails with %s', async (_, overrides, args, message) => {
    const { code, output } = await runCli(['proposals', 'pull', ...args], fixture, {
      ...env,
      ...overrides,
    });
    expect(output).toContain(message);
    expect(code).toBe(1);
  });

  it('fails when the server is unreachable, even in a dry run', async () => {
    const { code, output } = await runCli(['proposals', 'pull', '--dry-run'], fixture, env);
    expect(output).toContain("reading proposals failed: can't reach http://127.0.0.1:9/proposals");
    expect(code).toBe(1);
  });
});
