import { describe, expect, it } from '@effect/vitest';

import { splitFrontmatter } from './frontmatter.ts';

describe('splitFrontmatter', () => {
  it('returns an empty frontmatter for a document without one', () => {
    expect(splitFrontmatter('# Title')).toEqual({
      frontmatter: {},
      body: '# Title',
      bodyFirstLine: 1,
      problem: undefined,
    });
  });

  it('parses YAML and numbers the body from the line after it', () => {
    const split = splitFrontmatter('---\nsummary: A file\nupdated: 2026-10-18\n---\n# Title');
    expect(split.frontmatter).toEqual({ summary: 'A file', updated: '2026-10-18' });
    expect(split.body).toBe('# Title');
    expect(split.bodyFirstLine).toBe(5);
    expect(split.problem).toBeUndefined();
  });

  it('accepts an empty frontmatter', () => {
    expect(splitFrontmatter('---\n---\nbody').frontmatter).toEqual({});
  });

  it.each([
    ['never closed', '---\nsummary: x\n# Title', 'frontmatter is never closed'],
    ['invalid YAML', '---\nsummary: [x\n---\n', 'invalid frontmatter'],
    ['a duplicate key', '---\na: 1\na: 2\n---\n', 'invalid frontmatter'],
    ['not a mapping', '---\n- a\n---\n', 'frontmatter must be a mapping'],
  ])('reports frontmatter that is %s', (_, markdown, problem) => {
    expect(splitFrontmatter(markdown).problem).toContain(problem);
  });
});
