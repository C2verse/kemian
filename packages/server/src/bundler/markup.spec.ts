import { describe, expect, it } from '@effect/vitest';

import { type MarkupDocument, parseMarkup, renderMarkup } from './markup.ts';

const levels = ['public', 'private'];
const threeLevels = ['public', 'team', 'private'];

const render = (
  markdown: string,
  level: string,
  options: { readonly levels?: readonly string[]; readonly markers?: 'keep' | 'strip' } = {},
) => {
  const document = parseMarkup(markdown, { levels: options.levels ?? levels });
  expect(errorsOf(document)).toEqual([]);
  return renderMarkup(document, {
    level,
    levels: options.levels ?? levels,
    markers: options.markers ?? 'keep',
  });
};

const errorsOf = (document: MarkupDocument) =>
  document.problems
    .filter((problem) => problem.severity === 'error')
    .map((problem) => problem.message);

const errorsIn = (markdown: string, options: { readonly levels?: readonly string[] } = {}) =>
  errorsOf(parseMarkup(markdown, { levels: options.levels ?? levels }));

describe('inline spans', () => {
  const markdown = 'Paid <private alt="a fee">128 USDT</private> yearly.';

  it('replace content with alt below their level', () => {
    expect(render(markdown, 'public')).toBe('Paid a fee yearly.');
  });

  it('drop content without alt below their level', () => {
    expect(render('Paid <private>128 USDT</private> yearly.', 'public')).toBe('Paid  yearly.');
  });

  it('keep content and tags at their level', () => {
    expect(render(markdown, 'private')).toBe(markdown);
  });

  it('keep content without tags when markers are stripped', () => {
    expect(render(markdown, 'private', { markers: 'strip' })).toBe('Paid 128 USDT yearly.');
  });

  it('match tags in any case', () => {
    expect(render('A <Private>secret</PRIVATE> b', 'public')).toBe('A  b');
  });

  it('drop a line that only held removed content', () => {
    expect(render('a\n<private>secret</private>\nb', 'public')).toBe('a\nb');
  });

  it('allow several spans on a line', () => {
    expect(render('<private alt="x">1</private> and <private alt="y">2</private>', 'public')).toBe(
      'x and y',
    );
  });
});

describe('blocks', () => {
  const markdown = 'Intro\n\n<private reason="r">\n\n## Secret\n\nText\n\n</private>\n\nOutro';

  it('are removed below their level', () => {
    expect(render(markdown, 'public')).toBe('Intro\n\n\nOutro');
  });

  it('are replaced by alt as a paragraph', () => {
    const withAlt = 'Intro\n\n<private alt="Redacted.">\n\nSecret\n\n</private>\n\nOutro';
    expect(render(withAlt, 'public')).toBe('Intro\n\nRedacted.\n\nOutro');
  });

  it('keep their tags at their level', () => {
    expect(render(markdown, 'private')).toBe(markdown);
  });

  it('match tags in any case', () => {
    expect(render('<PRIVATE>\n\nsecret\n\n</Private>', 'public')).toBe('');
  });
});

describe('levels', () => {
  const markdown = 'a <team>t</team> <private>p</private> <public>x</public>';

  it('show each level what the levels below it see', () => {
    expect(render(markdown, 'public', { levels: threeLevels })).toBe('a   x');
    expect(render(markdown, 'team', { levels: threeLevels })).toBe('a <team>t</team>  x');
    expect(render(markdown, 'private', { levels: threeLevels })).toBe(
      'a <team>t</team> <private>p</private> x',
    );
  });

  it('ignore tags that are not level names', () => {
    expect(render('<details>open</details> <privateer>x</privateer>', 'public')).toBe(
      '<details>open</details> <privateer>x</privateer>',
    );
  });
});

describe('code', () => {
  it('treats tags in fenced code as text', () => {
    const markdown = '```html\n<private>\nkept\n</private>\n```';
    expect(render(markdown, 'public')).toBe(markdown);
  });

  it('treats tags in inline code as text', () => {
    expect(render('Use `<private>x</private>` to mark text.', 'public')).toBe(
      'Use `<private>x</private>` to mark text.',
    );
  });

  it('reports a fence that never closes', () => {
    expect(errorsIn('```\n<private>\nsecret\n</private>')).toEqual([
      'code fence is never closed, so markup after it would be ignored',
    ]);
  });
});

describe('HTML comments', () => {
  it('are removed below the highest level', () => {
    expect(render('a <!-- note --> b', 'public')).toBe('a  b');
  });

  it('are kept at the highest level', () => {
    expect(render('a <!-- note --> b', 'private')).toBe('a <!-- note --> b');
  });

  it('can span lines', () => {
    expect(render('a\n<!-- one\ntwo -->\nb', 'public')).toBe('a\nb');
    expect(render('a <!-- one\ntwo --> b', 'public')).toBe('a \n b');
  });

  it('hide tags inside them', () => {
    expect(render('a <!-- <private> --> b', 'public')).toBe('a  b');
  });

  it('are reported when they never close', () => {
    expect(errorsIn('a <!-- never')).toEqual(['HTML comment is never closed']);
  });
});

describe('malformed markup', () => {
  it.each([
    ['an unclosed block', '<private>\n\nsecret', '<private> block is never closed'],
    ['a stray closing tag', 'text\n\n</private>', '</private> without an opening tag'],
    [
      'a span across lines',
      'a <private>one\ntwo</private> b',
      '<private> span must close on the same line, without nesting',
    ],
    [
      'a nested span',
      '<private>\n\na <private>b</private>\n\n</private>',
      'nested <private> inside the block opened on line 1',
    ],
    [
      'a nested block',
      '<private>\n\n<private>\n\n</private>',
      'nested <private> inside the block opened on line 1',
    ],
    ['an unknown attribute', 'a <private class="x">b</private>', 'unknown attribute "class"'],
    ['a malformed attribute', "a <private alt='x'>b</private>", "malformed attributes: alt='x'"],
    [
      'a mismatched closing tag',
      '<team>\n\nx\n\n</private>',
      '</private> closes the <team> block opened on line 1',
    ],
  ])('reports %s', (_, markdown, message) => {
    expect(errorsIn(markdown, { levels: threeLevels })).toContain(message);
  });

  it('numbers lines from the given first line', () => {
    const document = parseMarkup('x\n</private>', { levels, firstLine: 5 });
    expect(document.problems[0]?.line).toBe(6);
  });

  it('warns about missing blank lines around block tags', () => {
    const document = parseMarkup('a\n<private>\nb\n</private>\nc', { levels });
    expect(document.problems.map((problem) => problem.severity)).toEqual([
      'warning',
      'warning',
      'warning',
      'warning',
    ]);
  });
});
