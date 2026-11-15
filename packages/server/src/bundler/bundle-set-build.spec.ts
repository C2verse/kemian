import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { type Bundle, decodeBundleSet } from '../protocol/index.ts';
import { buildBundleSetFromTree } from './bundle-set-build.ts';
import { type KemianConfig, resolveConfig } from './config.ts';
import { makeSourceTree } from './source-tree.ts';

const build = { id: 'build-1', createdAt: '2026-10-25T12:00:00Z' };

const buildFrom = (files: Readonly<Record<string, string>>, config: Partial<KemianConfig> = {}) => {
  const resolved = Effect.runSync(resolveConfig({ levels: ['public', 'private'], ...config }));
  return buildBundleSetFromTree({ tree: makeSourceTree(files), config: resolved, build });
};

const bundleOf = (result: ReturnType<typeof buildFrom>, level: string): Bundle => {
  const bundle = result.bundleSet.bundles.find((candidate) => candidate.level === level);
  if (bundle === undefined) throw new Error(`no ${level} bundle`);
  return bundle;
};

const pathsIn = (result: ReturnType<typeof buildFrom>, level: string) =>
  bundleOf(result, level).files.map((file) => file.path);

const fileIn = (result: ReturnType<typeof buildFrom>, level: string, path: string) =>
  bundleOf(result, level).files.find((file) => file.path === path);

const errorsOf = (result: ReturnType<typeof buildFrom>) =>
  result.problems.filter((problem) => problem.severity === 'error');

const publicReadme = '---\nvisibility: public\n---\n';

describe('visibility', () => {
  it('defaults to the highest level', () => {
    const result = buildFrom({ 'a.md': 'a' });
    expect(pathsIn(result, 'public')).toEqual([]);
    expect(pathsIn(result, 'private')).toEqual(['a.md']);
  });

  it('honors a configured default', () => {
    const result = buildFrom({ 'a.md': 'a' }, { defaultVisibility: 'public' });
    expect(pathsIn(result, 'public')).toEqual(['a.md']);
  });

  it("inherits the nearest folder README's declaration", () => {
    const result = buildFrom({
      'docs/README.md': publicReadme,
      'docs/guides/a.md': 'a',
      'notes/b.md': 'b',
    });
    expect(pathsIn(result, 'public')).toEqual(['docs/README.md', 'docs/guides/a.md']);
  });

  it("lets a file override its folder's level in either direction", () => {
    const result = buildFrom({
      'docs/README.md': publicReadme,
      'docs/secret.md': '---\nvisibility: private\n---\nsecret',
      'notes/shared.md': '---\nvisibility: public\n---\nshared',
    });
    expect(pathsIn(result, 'public')).toEqual(['docs/README.md', 'notes/shared.md']);
  });

  it('treats an invalid declaration as the highest level and reports it', () => {
    const result = buildFrom({ 'a.md': '---\nvisibility: everyone\n---\na' });
    expect(pathsIn(result, 'public')).toEqual([]);
    expect(errorsOf(result).map((problem) => problem.message)).toEqual([
      'invalid visibility "everyone" (use public, private)',
    ]);
  });

  it('treats a folder with invalid README frontmatter as the highest level', () => {
    const result = buildFrom(
      { 'docs/README.md': '---\nvisibility: [public\n---\n', 'docs/a.md': 'a' },
      { defaultVisibility: 'public' },
    );
    expect(pathsIn(result, 'public')).toEqual([]);
  });

  it('marks files above the lowest level', () => {
    const result = buildFrom({ 'a.md': 'a', 'b.md': '---\nvisibility: public\n---\nb' });
    expect(fileIn(result, 'private', 'a.md')?.visibility).toBe('private');
    expect(fileIn(result, 'private', 'b.md')).not.toHaveProperty('visibility');
  });
});

describe('redaction', () => {
  it('renders each bundle for its level', () => {
    const result = buildFrom({
      'a.md': `${publicReadme}Paid <private alt="a fee">128 USDT</private>.`,
    });
    expect(fileIn(result, 'public', 'a.md')?.content).toBe('Paid a fee.');
    expect(fileIn(result, 'private', 'a.md')?.content).toBe(
      'Paid <private alt="a fee">128 USDT</private>.',
    );
  });

  it('leaves files with errors out of every bundle but the highest', () => {
    const malformed = `${publicReadme}a <private>secret\n</private>`;
    const result = buildFrom({ 'a.md': malformed });
    expect(pathsIn(result, 'public')).toEqual([]);
    expect(fileIn(result, 'private', 'a.md')?.content).toBe('a <private>secret\n</private>');
    expect(errorsOf(result).map((problem) => problem.message)).toEqual([
      '<private> span must close on the same line, without nesting',
      '</private> without an opening tag',
    ]);
  });

  it('leaves files with malformed frontmatter out below the highest level', () => {
    const result = buildFrom({ 'a.md': '---\nvisibility: public\nsummary: [x\n---\nbody' });
    expect(pathsIn(result, 'public')).toEqual([]);
  });

  it('redacts summaries and titles', () => {
    const result = buildFrom({
      'a.md': `---\nvisibility: public\nsummary: Works at <private alt="a company">Quillwork</private>.\ntitle: Profile <private>(draft)</private>\n---\nbody`,
    });
    expect(fileIn(result, 'public', 'a.md')).toMatchObject({
      title: 'Profile',
      summary: 'Works at a company.',
    });
  });

  it('takes the title from the first heading the level can see', () => {
    const result = buildFrom({
      'a.md': `${publicReadme}<private>\n\n# Secret title\n\n</private>\n\n# Public title`,
    });
    expect(fileIn(result, 'public', 'a.md')?.title).toBe('Public title');
    expect(fileIn(result, 'private', 'a.md')?.title).toBe('Secret title');
  });
});

describe('links', () => {
  const files = {
    'README.md': publicReadme,
    'secret.md': '---\nvisibility: private\n---\nsecret',
  };

  it('reports public content linking to private files', () => {
    const result = buildFrom({ ...files, 'a.md': 'See [secret](secret.md).' });
    expect(errorsOf(result).map((problem) => problem.message)).toEqual([
      'public content links to secret.md, which only private can see; wrap the link in <private>',
    ]);
    expect(pathsIn(result, 'public')).toEqual(['README.md']);
  });

  it('accepts links inside markup for the target level', () => {
    const result = buildFrom({ ...files, 'a.md': 'See <private>[secret](secret.md)</private>.' });
    expect(errorsOf(result)).toEqual([]);
  });

  it('checks reference-style links and HTML links', () => {
    const result = buildFrom({
      ...files,
      'a.md': '[s]: secret.md',
      'b.md': '<a href="./secret.md#top">s</a>',
    });
    expect(errorsOf(result).map((problem) => problem.path)).toEqual(['a.md', 'b.md']);
  });

  it('reports private folders as link targets', () => {
    const result = buildFrom({
      ...files,
      'notes/README.md': '---\nvisibility: private\n---\n',
      'a.md': '[n](notes/)',
    });
    expect(errorsOf(result)).toHaveLength(1);
  });

  it('warns about broken links and ignores external ones', () => {
    const result = buildFrom({
      ...files,
      'a.md': '[x](missing.md) [y](https://example.com) [z](#top)',
    });
    expect(result.problems.map((problem) => problem.message)).toEqual(['broken link: missing.md']);
  });

  it('reports links to files the filter leaves out of the linking level', () => {
    const result = buildFrom(
      {
        ...files,
        'draft.md': '---\nvisibility: public\nstatus: draft\n---\nd',
        'a.md': 'See [draft](draft.md).',
      },
      {
        filter: ({ level, frontmatter }) => level !== 'public' || frontmatter['status'] !== 'draft',
      },
    );
    expect(errorsOf(result).map((problem) => problem.message)).toEqual([
      'public content links to draft.md, which the filter leaves out of public',
    ]);
    expect(pathsIn(result, 'public')).toEqual(['README.md']);
    expect(pathsIn(result, 'private')).toEqual(['README.md', 'a.md', 'draft.md', 'secret.md']);
  });

  it('warns about links to excluded files', () => {
    const result = buildFrom(
      { ...files, 'raw/dump.md': `${publicReadme}dump`, 'a.md': '[d](raw/dump.md)' },
      { exclude: ['raw/**'] },
    );
    expect(result.problems.map((problem) => problem.message)).toEqual([
      'link points to raw/dump.md, which the config excludes',
    ]);
  });

  it("blames a linked file's own errors rather than its level", () => {
    const result = buildFrom({
      ...files,
      'broken-frontmatter.md': '---\nvisibility: [public\n---\nb',
      'broken-markup.md': `${publicReadme}<private>unclosed`,
      'a.md': '[f](broken-frontmatter.md) [m](broken-markup.md)',
    });
    const linkErrors = errorsOf(result).filter((problem) => problem.path === 'a.md');
    expect(linkErrors.map((problem) => problem.message)).toEqual([
      'public content links to broken-frontmatter.md, which is left out below private for its own errors; fix them first',
      'public content links to broken-markup.md, which is left out below private for its own errors; fix them first',
    ]);
  });

  it('warns about broken links in files only the highest level sees', () => {
    const result = buildFrom({ ...files, 'secret.md': '---\nvisibility: private\n---\n[x](x.md)' });
    expect(result.problems.map((problem) => problem.message)).toEqual(['broken link: x.md']);
  });

  it('ignores links in code', () => {
    const result = buildFrom({ ...files, 'a.md': '`[s](secret.md)`\n\n```\n[s](secret.md)\n```' });
    expect(errorsOf(result)).toEqual([]);
  });
});

describe('configuration', () => {
  it('excludes files, with negated patterns bringing files back', () => {
    const result = buildFrom(
      { 'raw/README.md': 'index', 'raw/dump.md': 'dump', 'a.md': 'a' },
      { exclude: ['raw/**', '!raw/README.md'] },
    );
    expect(pathsIn(result, 'private')).toEqual(['a.md', 'raw/README.md']);
  });

  it('bundles only included files', () => {
    const result = buildFrom({ 'a.md': 'a', 'b/c.md': 'c' }, { include: ['b/**'] });
    expect(pathsIn(result, 'private')).toEqual(['b/c.md']);
  });

  it('lets the filter leave files out of a level', () => {
    const result = buildFrom(
      { 'draft.md': '---\nvisibility: public\nstatus: draft\n---\nd', 'a.md': `${publicReadme}a` },
      {
        filter: ({ level, frontmatter }) => level !== 'public' || frontmatter['status'] !== 'draft',
      },
    );
    expect(pathsIn(result, 'public')).toEqual(['a.md']);
    expect(pathsIn(result, 'private')).toEqual(['a.md', 'draft.md']);
  });

  it('leaves a file out when the filter throws', () => {
    const result = buildFrom(
      { 'a.md': `${publicReadme}a` },
      {
        filter: () => {
          throw new Error('boom');
        },
      },
    );
    expect(pathsIn(result, 'public')).toEqual([]);
    expect(errorsOf(result)).toHaveLength(1);
  });

  it('leaves a file out when the filter returns anything but true', () => {
    const untypedConfig = { levels: ['public', 'private'], filter: () => 'yes' };
    const result = buildBundleSetFromTree({
      tree: makeSourceTree({ 'a.md': `${publicReadme}a` }),
      config: Effect.runSync(resolveConfig(untypedConfig)),
      build,
    });
    expect(pathsIn(result, 'public')).toEqual([]);
  });

  it('copies kept frontmatter into meta and dates into updated', () => {
    const result = buildFrom(
      { 'a.md': '---\nstatus: stable\ntags: [a, b]\nupdated: 2026-10-18\nsecret: x\n---\na' },
      { frontmatter: { keep: ['status', 'tags'] } },
    );
    expect(fileIn(result, 'private', 'a.md')).toMatchObject({
      meta: { status: 'stable', tags: ['a', 'b'] },
      updated: '2026-10-18',
    });
    expect(fileIn(result, 'private', 'a.md')?.meta).not.toHaveProperty('secret');
  });

  it('copies the verified date into every level', () => {
    const result = buildFrom({
      'README.md': publicReadme,
      'a.md': '---\nverified: 2026-11-01\n---\na',
      'b.md': '---\nverified: soon\n---\nb',
    });
    expect(fileIn(result, 'public', 'a.md')?.verified).toBe('2026-11-01');
    expect(fileIn(result, 'private', 'a.md')?.verified).toBe('2026-11-01');
    expect(fileIn(result, 'private', 'b.md')).not.toHaveProperty('verified');
    expect(result.problems).toContainEqual(
      expect.objectContaining({ path: 'b.md', message: 'verified must be a YYYY-MM-DD date' }),
    );
  });

  it('dates reviews from the verified date, else the updated date, only in the highest bundle', () => {
    const result = buildFrom(
      {
        'README.md': publicReadme,
        'verified.md': '---\nstatus: evolving\nupdated: 2026-01-01\nverified: 2026-10-20\n---\na',
        'updated.md': '---\nstatus: stable\nupdated: 2026-10-18\n---\na',
        'undated.md': '---\nstatus: evolving\n---\na',
        'draft.md': '---\nstatus: draft\nupdated: 2026-10-18\n---\na',
        'plain.md': 'a',
      },
      { review: { intervals: { evolving: 30, stable: 180 } } },
    );
    expect(fileIn(result, 'private', 'verified.md')?.reviewDue).toBe('2026-11-19');
    expect(fileIn(result, 'private', 'updated.md')?.reviewDue).toBe('2027-04-16');
    expect(fileIn(result, 'private', 'undated.md')?.reviewDue).toBe('2026-10-25');
    expect(fileIn(result, 'private', 'draft.md')).not.toHaveProperty('reviewDue');
    expect(fileIn(result, 'private', 'plain.md')).not.toHaveProperty('reviewDue');
    expect(bundleOf(result, 'public').files.some((file) => 'reviewDue' in file)).toBe(false);
  });

  it('reads custom verified and status keys', () => {
    const result = buildFrom(
      { 'a.md': '---\nstate: open\nchecked: 2026-10-01\n---\na' },
      {
        frontmatter: { verified: 'checked', status: 'state' },
        review: { intervals: { open: 1 } },
      },
    );
    expect(fileIn(result, 'private', 'a.md')).toMatchObject({
      verified: '2026-10-01',
      reviewDue: '2026-10-02',
    });
  });

  it('reads custom frontmatter keys', () => {
    const result = buildFrom(
      { 'a.md': '---\naccess: public\ndescription: A file\n---\na' },
      { frontmatter: { visibility: 'access', summary: 'description' } },
    );
    expect(fileIn(result, 'public', 'a.md')?.summary).toBe('A file');
  });

  it('adds URLs from the url hook, ignoring relative ones', () => {
    const result = buildFrom(
      { 'a.md': 'a', 'b.md': 'b' },
      { url: ({ path }) => (path === 'a.md' ? `https://example.com/${path}` : path) },
    );
    expect(fileIn(result, 'private', 'a.md')?.url).toBe('https://example.com/a.md');
    expect(fileIn(result, 'private', 'b.md')).not.toHaveProperty('url');
  });

  it('leaves out the search index when asked to', () => {
    const result = buildFrom({ 'a.md': 'a' }, { searchIndex: false });
    expect(bundleOf(result, 'private')).not.toHaveProperty('search');
  });

  it('strips tags in visible content when markers are stripped', () => {
    const result = buildFrom({ 'a.md': 'a <private>b</private>' }, { markers: 'strip' });
    expect(fileIn(result, 'private', 'a.md')?.content).toBe('a b');
  });

  it("renders each level's instructions for that level", () => {
    const result = buildFrom(
      {
        'agents.md':
          '---\ntitle: x\n---\nAnswer briefly.<private> Mention the phone number.</private>',
      },
      { instructions: { public: 'agents.md', private: 'agents.md' } },
    );
    expect(bundleOf(result, 'public').instructions).toBe('Answer briefly.');
    expect(bundleOf(result, 'private').instructions).toBe(
      'Answer briefly.<private> Mention the phone number.</private>',
    );
  });

  it('reports a missing instructions file', () => {
    const result = buildFrom({}, { instructions: { public: 'missing.md' } });
    expect(errorsOf(result).map((problem) => problem.message)).toEqual([
      'instructions for public not found',
    ]);
  });
});

describe('folders', () => {
  it("lists the folders of a level's files with their README summaries", () => {
    const result = buildFrom({
      'README.md': '---\nsummary: Root\n---\n',
      'docs/README.md': '---\nvisibility: public\nsummary: Docs\n---\n',
      'docs/guides/a.md': 'a',
      'notes/b.md': 'b',
    });
    expect(bundleOf(result, 'public').folders).toEqual([
      { path: '' },
      { path: 'docs', summary: 'Docs' },
      { path: 'docs/guides' },
    ]);
    expect(bundleOf(result, 'private').folders).toEqual([
      { path: '', summary: 'Root' },
      { path: 'docs', summary: 'Docs' },
      { path: 'docs/guides' },
      { path: 'notes' },
    ]);
  });
});

describe('output', () => {
  it.effect('is a valid bundle set', () =>
    Effect.gen(function* () {
      const result = buildFrom({
        'README.md': publicReadme,
        'a.md': '---\nsummary: A\nupdated: 2026-10-18\n---\n# A\n\ntext',
      });
      const decoded = yield* decodeBundleSet(JSON.parse(JSON.stringify(result.bundleSet)));
      expect(decoded.bundles.map((bundle) => bundle.level)).toEqual(['public', 'private']);
    }),
  );

  it('marks only the highest bundle as highest', () => {
    const result = buildFrom({ 'a.md': 'a' });
    expect(bundleOf(result, 'private').highest).toBe(true);
    expect(bundleOf(result, 'public')).not.toHaveProperty('highest');
  });
});
