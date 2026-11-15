import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { resolveConfig } from './config.ts';
import { formatReview, isReviewPassing, reviewChanges } from './proposal-review.ts';
import { makeSourceTree } from './source-tree.ts';

const config = Effect.runSync(resolveConfig({ levels: ['public', 'team', 'private'] }));
const tree = makeSourceTree({
  'README.md': '---\nvisibility: public\n---\n# Robin',
  'lantern.md':
    '# Lantern\n\nSupports YAML. <team>Ships in May.</team> <private>Revenue: 95,000.</private>\n',
  'notes.md': '---\nvisibility: private\n---\n# Notes\n',
});

const review = (path: string, text: string | null) =>
  reviewChanges({ tree, config, changes: [{ path, text }] });

describe('reviewChanges', () => {
  it('passes a plain edit and shows what each lower level gains and loses', () => {
    const result = review(
      'lantern.md',
      '# Lantern\n\nSupports YAML and TOML. <team>Ships in May.</team> <private>Revenue: 95,000.</private>\n',
    );
    expect(isReviewPassing(result)).toBe(true);
    expect(result.levels).toEqual([
      {
        level: 'public',
        files: [
          {
            path: 'lantern.md',
            status: 'changed',
            linesGained: ['Supports YAML and TOML.'],
            linesLost: ['Supports YAML.'],
          },
        ],
      },
      {
        level: 'team',
        files: [
          {
            path: 'lantern.md',
            status: 'changed',
            linesGained: ['Supports YAML and TOML. <team>Ships in May.</team>'],
            linesLost: ['Supports YAML. <team>Ships in May.</team>'],
          },
        ],
      },
    ]);
  });

  it('reports no change for edits only the highest level sees', () => {
    const result = review(
      'lantern.md',
      '# Lantern\n\nSupports YAML. <team>Ships in May.</team> <private>Revenue: 120,000.</private>\n',
    );
    expect(isReviewPassing(result)).toBe(true);
    expect(result.levels.every((level) => level.files.length === 0)).toBe(true);
  });

  it.each([
    [
      'removes a tag',
      '# Lantern\n\nSupports YAML. Ships in May. <private>Revenue: 95,000.</private>\n',
    ],
    [
      'changes a tag to a lower level',
      '# Lantern\n\nSupports YAML. <team>Ships in May.</team> <team>Revenue: 95,000.</team>\n',
    ],
    [
      'removes an HTML comment marker',
      '# Lantern\n\nSupports YAML. <team>Ships in May.</team> <private>Revenue: 95,000.</private>\n<!-- a\n',
    ],
  ])('fails an edit that %s', (_, text) => {
    const result = review('lantern.md', text);
    expect(isReviewPassing(result)).toBe(false);
    expect(result.markupChanges).toEqual([
      'lantern.md adds, removes, or changes a level tag or HTML comment',
    ]);
  });

  it('fails an edit that moves content across a tag, though the tags stay the same', () => {
    const edit = { old: '<private>Revenue: ', new: 'Revenue: <private>' };
    const result = reviewChanges({
      tree,
      config,
      changes: [
        {
          path: 'lantern.md',
          text: '# Lantern\n\nSupports YAML. <team>Ships in May.</team> Revenue: <private>95,000.</private>\n',
        },
      ],
      edits: { path: 'lantern.md', edits: [{ old: 'YAML', new: 'TOML' }, edit] },
    });
    expect(result.markupChanges).toEqual([
      'edit 2 to lantern.md touches a level tag or HTML comment',
    ]);
    expect(result.levels[0]?.files[0]?.linesGained).toEqual(['Supports YAML.  Revenue:']);
  });

  it('fails edits that turn restricted content into code, though no tag changes', () => {
    const result = reviewChanges({
      tree,
      config,
      changes: [
        {
          path: 'lantern.md',
          text: '# Lantern\n\nSupports YAML. `<team>Ships in May.</team>` <private>Revenue: 95,000.</private>\n',
        },
      ],
      edits: { path: 'lantern.md', edits: [{ old: ' <team>', new: ' `<team>' }] },
    });
    expect(result.markupChanges).toContain(
      'lantern.md adds, removes, or changes a level tag or HTML comment',
    );
  });

  it('fails a code fence opened and closed around a block by separate edits', () => {
    const fenced = makeSourceTree({
      'a.md':
        '---\nvisibility: public\n---\nIntro.\n\n<private>\n\nSecret plan.\n\n</private>\n\nOutro.\n',
    });
    const result = reviewChanges({
      tree: fenced,
      config,
      changes: [
        {
          path: 'a.md',
          text: '---\nvisibility: public\n---\nIntro.\n```\n\n<private>\n\nSecret plan.\n\n</private>\n\n```\nOutro.\n',
        },
      ],
      edits: {
        path: 'a.md',
        edits: [
          { old: 'Intro.', new: 'Intro.\n```' },
          { old: 'Outro.', new: '```\nOutro.' },
        ],
      },
    });
    expect(isReviewPassing(result)).toBe(false);
    expect(result.markupChanges).toEqual([
      'a.md adds, removes, or changes a level tag or HTML comment',
    ]);
    expect(result.levels[0]?.files[0]?.linesGained).toContain('Secret plan.');
  });

  it('fails a change that makes a lower level see an existing file', () => {
    const filtered = Effect.runSync(
      resolveConfig({
        levels: ['public', 'private'],
        filter: ({ level, frontmatter }: { level: string; frontmatter: Record<string, unknown> }) =>
          level !== 'public' || frontmatter['status'] !== 'draft',
      }),
    );
    const draftTree = makeSourceTree({
      'idea.md': '---\nvisibility: public\nstatus: draft\n---\nIdea.',
    });
    const result = reviewChanges({
      tree: draftTree,
      config: filtered,
      changes: [{ path: 'idea.md', text: '---\nvisibility: public\nstatus: archived\n---\nIdea.' }],
    });
    expect(result.markupChanges).toEqual(["public gains idea.md, which it didn't see before"]);
  });

  it('fails a change of visibility', () => {
    const result = review('notes.md', '---\nvisibility: team\n---\n# Notes\n');
    expect(result.markupChanges).toEqual([
      'notes.md changes its visibility',
      "team gains notes.md, which it didn't see before",
    ]);
    expect(result.levels[1]?.files).toEqual([
      expect.objectContaining({ path: 'notes.md', status: 'added' }),
    ]);
  });

  it('fails a new file that a lower level can see', () => {
    const result = review('new.md', '---\nvisibility: public\n---\nNew.');
    expect(result.markupChanges).toEqual([
      "public gains new.md, which it didn't see before",
      "team gains new.md, which it didn't see before",
    ]);
  });

  it('passes a new file at the highest level', () => {
    const result = review('new.md', '---\nvisibility: private\n---\nNew.');
    expect(isReviewPassing(result)).toBe(true);
    expect(result.levels.every((level) => level.files.length === 0)).toBe(true);
  });

  it('fails changes that add errors, and lists only the new problems', () => {
    const result = review(
      'notes.md',
      '---\nvisibility: private\n---\n# Notes\n\n<team>never closed\n',
    );
    expect(isReviewPassing(result)).toBe(false);
    expect(result.problemsNew).toEqual([
      expect.objectContaining({ path: 'notes.md', severity: 'error' }),
    ]);
  });

  it('shows a deleted file as removed from the levels that saw it', () => {
    const result = review('lantern.md', null);
    expect(result.levels[0]?.files).toEqual([
      expect.objectContaining({ path: 'lantern.md', status: 'removed' }),
    ]);
    expect(result.markupChanges).toEqual([]);
  });
});

describe('formatReview', () => {
  it('formats a passing review with its diff', () => {
    const text = formatReview(
      review(
        'lantern.md',
        '# Lantern\n\nSupports TOML. <team>Ships in May.</team> <private>Revenue: 95,000.</private>\n',
      ),
    );
    expect(text).toContain('**Check passed:**');
    expect(text).toContain('### What Each Level Gains or Loses');
    expect(text).toContain(
      '**public:**\n\n- `lantern.md` changed\n\n```diff\n- Supports YAML.\n+ Supports TOML.\n```',
    );
  });

  it('formats a failing review with its reasons', () => {
    const text = formatReview(review('notes.md', '---\nvisibility: public\n---\n# Notes\n'));
    expect(text).toContain('**Check failed.**');
    expect(text).toContain('- ⚠️ notes.md changes its visibility');
  });

  it('fences diffs so content with backticks stays inside', () => {
    const text = formatReview(review('lantern.md', '# Lantern\n\n```js\ncode\n```\n'));
    expect(text).toContain('````diff');
  });
});
