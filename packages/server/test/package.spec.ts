import { execFile } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('../../../fixtures/knowledge-base/', import.meta.url));
const bin = (name: string) => join(packageRoot, '..', '..', 'node_modules', '.bin', name);

let packed: string;
let manifest: { readonly bin: Record<string, string>; readonly exports: Record<string, unknown> };

const targetsOf = (entry: unknown): string[] =>
  typeof entry === 'string'
    ? [entry]
    : Object.values(typeof entry === 'object' && entry !== null ? entry : {}).flatMap(targetsOf);

beforeAll(async () => {
  await run(bin('tsdown'), [], { cwd: packageRoot });
  await run(bin('tsc'), ['-p', 'tsconfig.build.json'], { cwd: packageRoot });
  const destination = await mkdtemp(join(tmpdir(), 'kemian-pack-'));
  await run('pnpm', ['pack', '--pack-destination', destination], { cwd: packageRoot });
  const [tarball] = (await readdir(destination)).filter((name) => name.endsWith('.tgz'));
  await run('tar', ['xzf', join(destination, tarball ?? ''), '-C', destination]);
  packed = join(destination, 'package');
  await symlink(join(packageRoot, 'node_modules'), join(packed, 'node_modules'));
  manifest = JSON.parse(await readFile(join(packed, 'package.json'), 'utf8'));
}, 120_000);

describe('packed @kemian/server', () => {
  it('points every export and the binary at built files', async () => {
    const targets = [
      ...Object.values(manifest.bin),
      ...Object.entries(manifest.exports)
        .filter(([key]) => !key.includes('*'))
        .flatMap(([, entry]) => targetsOf(entry)),
    ];
    expect(targets.every((target) => target.startsWith('./dist/'))).toBe(true);
    await expect(
      Promise.all(targets.map((target) => access(join(packed, target)))),
    ).resolves.toBeDefined();
  });

  it('ships the JSON Schemas', async () => {
    await expect(access(join(packed, 'schema/bundle-set.v1.schema.json'))).resolves.toBeUndefined();
  });

  it.each(['protocol', 'search', 'bundler', 'core', 'github'])(
    'imports the %s entry',
    async (name) => {
      const module: unknown = await import(
        pathToFileURL(join(packed, `dist/${name}/index.js`)).href
      );
      expect(
        typeof module === 'object' && module !== null ? Object.keys(module).length : 0,
      ).toBeGreaterThan(0);
    },
  );

  it('runs the kemian binary', async () => {
    const { stderr } = await run('node', [join(packed, manifest.bin['kemian'] ?? ''), 'check'], {
      cwd: fixture,
    });
    expect(stderr).toContain('0 error(s), 0 warning(s)');
  });

  it('runs the proposals subcommand of the kemian binary', async () => {
    const { stdout } = await run(
      'node',
      [join(packed, manifest.bin['kemian'] ?? ''), 'proposals', 'pull', '--help'],
      { cwd: fixture },
    );
    expect(stdout).toContain('kemian proposals pull [flags]');
  });
});
