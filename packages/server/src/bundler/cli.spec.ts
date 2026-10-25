import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@effect/vitest';

const cli = fileURLToPath(new URL('cli.ts', import.meta.url));
const fixture = fileURLToPath(new URL('../../../../fixtures/knowledge-base/', import.meta.url));

const runCli = (args: readonly string[], cwd: string) =>
  new Promise<{ readonly code: number; readonly output: string }>((resolve) => {
    execFile('node', [cli, ...args], { cwd }, (error, stdout, stderr) => {
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
