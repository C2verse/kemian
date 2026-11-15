import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { contentHashOf, type Proposal } from '../protocol/index.ts';
import { buildBundleSetFromTree } from './bundle-set-build.ts';
import { type KemianConfig, resolveConfig } from './config.ts';
import {
  applyProposal,
  conflictNoteOf,
  describeProposal,
  type ProposalApplication,
} from './proposal-apply.ts';
import { makeSourceTree } from './source-tree.ts';

const files = {
  'README.md': '---\nvisibility: public\n---\n# Robin',
  'projects/lantern.md':
    '---\nsummary: Lantern # a language server\nstatus: stable\nverified: 2026-10-01\n---\n# Lantern\n\nLantern supports YAML. <private>Revenue is 95,000.</private>\n',
  'inbox/2026-11-01-idea.md': '---\nstatus: evolving\n---\n# Idea\n\nA cache.\n',
  'broken.md': '---\nstatus: [stable\n---\nbody',
  'excluded/raw.md': 'raw',
};

const sourceOf = (config: Partial<KemianConfig> = {}, pathsTaken: readonly string[] = []) => {
  const resolved = Effect.runSync(
    resolveConfig({ levels: ['public', 'private'], exclude: ['excluded/**'], ...config }),
  );
  const tree = makeSourceTree(files);
  const { bundleSet } = buildBundleSetFromTree({
    tree,
    config: resolved,
    build: { id: 'pull', createdAt: '2026-11-14T00:00:00Z' },
  });
  const highest = bundleSet.bundles.at(-1);
  return {
    config: resolved,
    texts: tree.markdown,
    highestContents: new Map((highest?.files ?? []).map((file) => [file.path, file.content])),
    pathsTaken: new Set(pathsTaken),
  };
};

const base = {
  protocol: 1,
  id: 'p1',
  createdAt: '2026-11-14T09:30:00.000Z',
  author: { identity: 'github:12345', name: 'robin' },
} as const;

const fileBase = { ...base, path: 'projects/lantern.md', build: 'build-1' } as const;

const changedText = (application: ProposalApplication, path: string): string | null | undefined => {
  if (application._tag !== 'Changed')
    throw new Error(`not changed: ${JSON.stringify(application)}`);
  return application.changes.find((change) => change.path === path)?.text;
};

const applyObsolete = async (path: string, config: Partial<KemianConfig> = {}) => {
  const source = sourceOf(config);
  const contentHash = await contentHashOf(source.highestContents.get(path) ?? '');
  return applyProposal(
    { ...fileBase, path, kind: 'stale', verdict: 'obsolete', contentHash },
    source,
  );
};

describe('applyProposal', () => {
  describe('note', () => {
    const note: Proposal = {
      ...base,
      kind: 'note',
      title: 'Lantern supports TOML: "yes" #1',
      body: 'Robin said TOML shipped.\n',
      about: ['projects/lantern.md', 'projects/a b.md'],
      sources: ['conversation\non 2026-11-14'],
    };

    it('adds a note at the highest level in the notes folder', async () => {
      const application = await applyProposal(note, sourceOf());
      expect(application).toEqual({
        _tag: 'Changed',
        changes: [
          {
            path: 'inbox/2026-11-14-lantern-supports-toml-yes-1.md',
            text: [
              '---',
              'visibility: private',
              `summary: 'Lantern supports TOML: "yes" #1'`,
              'updated: 2026-11-14',
              '---',
              '',
              '# Lantern supports TOML: "yes" #1',
              '',
              'Robin said TOML shipped.',
              '',
              '## About',
              '',
              '- [projects/lantern.md](<../projects/lantern.md>)',
              '- [projects/a b.md](<../projects/a b.md>)',
              '',
              '## Sources',
              '',
              '- conversation on 2026-11-14',
              '',
              '_Proposed by robin (github:12345) on 2026-11-14._',
              '',
            ].join('\n'),
          },
        ],
      });
    });

    it('uses the configured notes folder and frontmatter keys', async () => {
      const application = await applyProposal(
        { ...base, kind: 'note', title: '!!!', body: 'b' },
        sourceOf({
          proposals: { notes: 'notes/agents' },
          frontmatter: { visibility: 'access', summary: 'description', updated: 'date' },
        }),
      );
      expect(changedText(application, 'notes/agents/2026-11-14-note.md')).toContain(
        'access: private\ndescription: "!!!"\ndate: 2026-11-14\n',
      );
    });

    it('picks a free path', async () => {
      const application = await applyProposal(
        { ...base, kind: 'note', title: 'Idea', body: 'b', createdAt: '2026-11-01T00:00:00Z' },
        sourceOf({}, ['inbox/2026-11-01-idea-2.md']),
      );
      expect(application._tag === 'Changed' ? application.changes[0]?.path : '').toBe(
        'inbox/2026-11-01-idea-3.md',
      );
    });
  });

  describe('edit', () => {
    it('replaces snippets in the body and keeps the frontmatter as written', async () => {
      const application = await applyProposal(
        {
          ...fileBase,
          kind: 'edit',
          edits: [{ old: 'supports YAML.', new: 'supports YAML and TOML.' }],
          reason: 'r',
        },
        sourceOf(),
      );
      expect(changedText(application, 'projects/lantern.md')).toBe(
        '---\nsummary: Lantern # a language server\nstatus: stable\nverified: 2026-10-01\n---\n# Lantern\n\nLantern supports YAML and TOML. <private>Revenue is 95,000.</private>\n',
      );
    });

    it('edits files without frontmatter', async () => {
      const application = await applyProposal(
        {
          ...fileBase,
          path: 'README.md',
          kind: 'edit',
          edits: [{ old: '# Robin', new: '# Robin Example' }],
          reason: 'r',
        },
        sourceOf(),
      );
      expect(changedText(application, 'README.md')).toBe(
        '---\nvisibility: public\n---\n# Robin Example',
      );
    });

    it.each([
      [
        'a snippet that only occurs in the frontmatter',
        'projects/lantern.md',
        'status: stable',
        '`old` occurs 0 times',
      ],
      ['a snippet that occurs twice', 'projects/lantern.md', 'Lantern', '`old` occurs 2 times'],
      [
        'a file that is gone',
        'projects/gone.md',
        'x',
        'projects/gone.md is no longer in the knowledge base',
      ],
      [
        'an excluded file',
        'excluded/raw.md',
        'raw',
        'excluded/raw.md is no longer in the knowledge base',
      ],
      [
        'a file with malformed frontmatter',
        'broken.md',
        'body',
        'broken.md has malformed frontmatter',
      ],
    ])('conflicts on %s', async (_, path, old, reason) => {
      const application = await applyProposal(
        { ...fileBase, path, kind: 'edit', edits: [{ old, new: 'y' }], reason: 'r' },
        sourceOf(),
      );
      expect(application._tag).toBe('Conflicted');
      expect(application._tag === 'Conflicted' ? application.reason : '').toContain(reason);
    });
  });

  it('conflicts on an edit that would add frontmatter to a file without it', async () => {
    const source = sourceOf();
    const texts = new Map([...source.texts, ['plain.md', 'Plain text.']]);
    const highestContents = new Map([...source.highestContents, ['plain.md', 'Plain text.']]);
    const application = await applyProposal(
      {
        ...fileBase,
        path: 'plain.md',
        kind: 'edit',
        edits: [{ old: 'Plain', new: '---\nvisibility: public\n---\nPlain' }],
        reason: 'r',
      },
      { ...source, texts, highestContents },
    );
    expect(application).toEqual({
      _tag: 'Conflicted',
      reason: 'the edits would change the frontmatter of plain.md',
    });
  });

  describe('stale', () => {
    it('sets the verified date of a current file', async () => {
      const application = await applyProposal(
        { ...fileBase, kind: 'stale', verdict: 'current', verified: '2026-11-14' },
        sourceOf(),
      );
      expect(changedText(application, 'projects/lantern.md')).toContain(
        '---\nsummary: Lantern # a language server\nstatus: stable\nverified: 2026-11-14\n---\n# Lantern',
      );
    });

    it('adds frontmatter to set the verified date when there is none', async () => {
      const application = await applyProposal(
        {
          ...fileBase,
          path: 'inbox/2026-11-01-idea.md',
          kind: 'stale',
          verdict: 'current',
          verified: '2026-11-14',
        },
        sourceOf({ frontmatter: { verified: 'checked' } }),
      );
      expect(changedText(application, 'inbox/2026-11-01-idea.md')).toBe(
        '---\nstatus: evolving\nchecked: 2026-11-14\n---\n# Idea\n\nA cache.\n',
      );
    });

    it('keeps a later verified date', async () => {
      const application = await applyProposal(
        { ...fileBase, kind: 'stale', verdict: 'current', verified: '2026-09-01' },
        sourceOf(),
      );
      expect(application).toEqual({
        _tag: 'Unchanged',
        reason: 'projects/lantern.md was already verified on 2026-10-01',
      });
    });

    it('applies the edits of an outdated file', async () => {
      const application = await applyProposal(
        {
          ...fileBase,
          kind: 'stale',
          verdict: 'outdated',
          edits: [{ old: 'Revenue is 95,000.', new: 'Revenue is 120,000.' }],
        },
        sourceOf(),
      );
      expect(changedText(application, 'projects/lantern.md')).toContain(
        '<private>Revenue is 120,000.</private>',
      );
    });

    it('archives an obsolete file', async () => {
      expect(
        changedText(await applyObsolete('projects/lantern.md'), 'projects/lantern.md'),
      ).toContain('status: archived\n');
    });

    it('deletes an obsolete note', async () => {
      expect(
        changedText(await applyObsolete('inbox/2026-11-01-idea.md'), 'inbox/2026-11-01-idea.md'),
      ).toBeNull();
    });

    it('archives an obsolete note when configured to', async () => {
      const application = await applyObsolete('inbox/2026-11-01-idea.md', {
        proposals: { obsoleteNotes: 'archive', archivedStatus: 'retired' },
      });
      expect(changedText(application, 'inbox/2026-11-01-idea.md')).toContain('status: retired\n');
    });

    it('conflicts when an obsolete file changed after it was read', async () => {
      const application = await applyProposal(
        { ...fileBase, kind: 'stale', verdict: 'obsolete', contentHash: 'a'.repeat(64) },
        sourceOf(),
      );
      expect(application).toEqual({
        _tag: 'Conflicted',
        reason: 'projects/lantern.md changed after build build-1, where it was judged obsolete',
      });
    });
  });
});

describe('conflictNoteOf', () => {
  it('keeps the edits of a conflicted proposal for the author', () => {
    const note = conflictNoteOf(
      {
        ...fileBase,
        kind: 'edit',
        edits: [{ old: 'a ```b```', new: 'c' }],
        reason: 'Robin said so.',
      },
      'the edits no longer apply',
    );
    expect(note).toMatchObject({
      kind: 'note',
      id: 'p1',
      title: 'Conflicted proposal for projects/lantern.md',
      about: ['projects/lantern.md'],
    });
    expect(note.body).toContain("Kemian couldn't apply this proposal: the edits no longer apply.");
    expect(note.body).toContain('Reason: Robin said so.');
    expect(note.body).toContain('````\na ```b```\n````');
  });
});

describe('describeProposal', () => {
  it.each([
    [{ ...base, kind: 'note', title: 'T', body: 'b' }, 'Note: T'],
    [
      { ...fileBase, kind: 'edit', edits: [{ old: 'a', new: 'b' }], reason: 'r' },
      'Edit projects/lantern.md',
    ],
    [
      { ...fileBase, kind: 'stale', verdict: 'current', verified: '2026-11-14' },
      'Mark projects/lantern.md verified',
    ],
  ] as const)('describes %j', (proposal, description) => {
    expect(describeProposal(proposal)).toBe(description);
  });
});
