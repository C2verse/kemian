import type { Level } from '../protocol/index.ts';
import { FenceTracker, maskInlineCode } from './markdown.ts';

/**
 * Part of a Markdown line, as the privacy markup sees it.
 */
export type MarkupPart =
  | { readonly _tag: 'Text'; readonly text: string }
  | { readonly _tag: 'Comment'; readonly text: string }
  | {
      readonly _tag: 'Span';
      readonly level: Level;
      readonly alt: string | undefined;
      readonly open: string;
      readonly text: string;
      readonly close: string;
    };

/**
 * Line of a Markdown document, split into markup parts.
 */
export interface MarkupLine {
  readonly source: string;
  readonly parts: readonly MarkupPart[];
}

/**
 * Top-level node of a Markdown document: a line, or a block restricted to a level.
 */
export type MarkupNode =
  | { readonly _tag: 'Line'; readonly line: MarkupLine }
  | {
      readonly _tag: 'Block';
      readonly level: Level;
      readonly alt: string | undefined;
      readonly open: string;
      readonly close: string;
      readonly lines: readonly MarkupLine[];
    };

/**
 * Problem found while parsing markup, at a 1-based line number.
 */
export interface MarkupProblem {
  readonly line: number;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/**
 * Markdown document parsed for privacy markup.
 */
export interface MarkupDocument {
  readonly nodes: readonly MarkupNode[];
  readonly problems: readonly MarkupProblem[];
}

const ALLOWED_ATTRIBUTES = new Set(['alt', 'reason']);
const ATTRIBUTE = /([\w-]+)="([^"]*)"/gu;

/**
 * Parses the privacy markup of a Markdown document whose tags are named after the given levels.
 */
export const parseMarkup = (
  markdown: string,
  options: { readonly levels: readonly Level[]; readonly firstLine?: number },
): MarkupDocument => new MarkupParser(options.levels, options.firstLine ?? 1).parse(markdown);

/**
 * Renders a parsed document for one level.
 *
 * Content above the level is removed or replaced by its `alt`. HTML comments survive only at the highest level.
 * With `markers: 'keep'`, tags around visible content stay, except tags of the lowest level.
 */
export const renderMarkup = (
  document: MarkupDocument,
  options: {
    readonly level: Level;
    readonly levels: readonly Level[];
    readonly markers: 'keep' | 'strip';
  },
): string => {
  const rank = (level: Level) => options.levels.indexOf(level);
  const isVisible = (level: Level) => rank(level) <= rank(options.level);
  const isHighest = rank(options.level) === options.levels.length - 1;
  const isMarkerKept = (level: Level) => options.markers === 'keep' && rank(level) > 0;

  const renderPart = (part: MarkupPart): string => {
    switch (part._tag) {
      case 'Text':
        return part.text;
      case 'Comment':
        return isHighest ? part.text : '';
      case 'Span':
        if (!isVisible(part.level)) return part.alt ?? '';
        return isMarkerKept(part.level) ? part.open + part.text + part.close : part.text;
      default:
        return absurd(part);
    }
  };
  const renderLine = (line: MarkupLine): string[] => {
    const rendered = line.parts.map(renderPart).join('');
    const isEmptied = line.source.trim() !== '' && rendered.trim() === '';
    return isEmptied ? [] : [rendered];
  };
  const renderNode = (node: MarkupNode): string[] => {
    switch (node._tag) {
      case 'Line':
        return renderLine(node.line);
      case 'Block': {
        if (!isVisible(node.level)) return node.alt === undefined ? [] : [node.alt];
        const lines = node.lines.flatMap(renderLine);
        return isMarkerKept(node.level) ? [node.open, ...lines, node.close] : lines;
      }
      default:
        return absurd(node);
    }
  };

  return document.nodes.flatMap(renderNode).join('\n');
};

interface OpenBlock {
  readonly level: Level;
  readonly alt: string | undefined;
  readonly open: string;
  readonly line: number;
  readonly lines: MarkupLine[];
}

class MarkupParser {
  readonly #levelsByName: ReadonlyMap<string, Level>;
  readonly #blockOpen: RegExp;
  readonly #blockClose: RegExp;
  readonly #token: RegExp;
  readonly #tag: RegExp;
  readonly #firstLine: number;
  readonly #nodes: MarkupNode[] = [];
  readonly #problems: MarkupProblem[] = [];
  #block: OpenBlock | undefined;
  #isInComment = false;

  constructor(levels: readonly Level[], firstLine: number) {
    const names = levels.map(escapeRegExp).join('|');
    this.#levelsByName = new Map(levels.map((level) => [level.toLowerCase(), level]));
    this.#blockOpen = new RegExp(`^<(${names})(\\s[^>]*)?>$`, 'iu');
    this.#blockClose = new RegExp(`^</(${names})\\s*>$`, 'iu');
    this.#token = new RegExp(`<!--|<(/?)(${names})(?=[\\s/>])([^>]*)>`, 'giu');
    this.#tag = new RegExp(`<(/?)(${names})(?=[\\s/>])([^>]*)>`, 'giu');
    this.#firstLine = firstLine;
  }

  parse(markdown: string): MarkupDocument {
    const lines = markdown.split('\n');
    const fences = new FenceTracker();
    lines.forEach((source, index) => {
      const lineNumber = this.#firstLine + index;
      if (!this.#isInComment && fences.isCode(source)) {
        this.#pushLine({ source, parts: [{ _tag: 'Text', text: source }] });
        return;
      }
      if (!this.#isInComment && this.#parseBlockTag(lines, index, lineNumber)) return;
      this.#pushLine(this.#parseLine(source, lineNumber));
    });

    const lastLine = this.#firstLine + lines.length - 1;
    if (this.#block !== undefined) {
      this.#error(this.#block.line, `<${this.#block.level}> block is never closed`);
    }
    if (this.#isInComment) this.#error(lastLine, 'HTML comment is never closed');
    if (fences.isOpen) {
      this.#error(lastLine, 'code fence is never closed, so markup after it would be ignored');
    }
    return { nodes: this.#nodes, problems: this.#problems };
  }

  #parseBlockTag(lines: readonly string[], index: number, lineNumber: number): boolean {
    const source = lines[index] ?? '';
    const trimmed = source.trim();
    const open = this.#blockOpen.exec(trimmed);
    if (open !== null) {
      const level = this.#levelOf(open[1]);
      if (this.#block !== undefined) {
        this.#error(
          lineNumber,
          `nested <${level}> inside the block opened on line ${this.#block.line}`,
        );
        return true;
      }
      const attributes = this.#parseAttributes(open[2], lineNumber);
      this.#block = {
        level,
        alt: attributes.get('alt'),
        open: source,
        line: lineNumber,
        lines: [],
      };
      this.#warnUnlessBlank(lines[index - 1], lineNumber, `add a blank line before <${level}>`);
      this.#warnUnlessBlank(lines[index + 1], lineNumber, `add a blank line after <${level}>`);
      return true;
    }

    const close = this.#blockClose.exec(trimmed);
    if (close === null) return false;
    const level = this.#levelOf(close[1]);
    const block = this.#block;
    if (block === undefined) {
      this.#error(lineNumber, `</${level}> without an opening tag`);
      return true;
    }
    if (block.level !== level) {
      this.#error(
        lineNumber,
        `</${level}> closes the <${block.level}> block opened on line ${block.line}`,
      );
      return true;
    }
    this.#nodes.push({
      _tag: 'Block',
      level,
      alt: block.alt,
      open: block.open,
      close: source,
      lines: block.lines,
    });
    this.#block = undefined;
    this.#warnUnlessBlank(lines[index - 1], lineNumber, `add a blank line before </${level}>`);
    this.#warnUnlessBlank(lines[index + 1], lineNumber, `add a blank line after </${level}>`);
    return true;
  }

  #parseLine(source: string, lineNumber: number): MarkupLine {
    const masked = maskInlineCode(source);
    const parts: MarkupPart[] = [];
    let cursor = 0;

    if (this.#isInComment) {
      const end = masked.indexOf('-->');
      if (end === -1) return { source, parts: [{ _tag: 'Comment', text: source }] };
      parts.push({ _tag: 'Comment', text: source.slice(0, end + 3) });
      cursor = end + 3;
      this.#isInComment = false;
    }

    this.#token.lastIndex = cursor;
    for (let match = this.#token.exec(masked); match !== null; match = this.#token.exec(masked)) {
      parts.push({ _tag: 'Text', text: source.slice(cursor, match.index) });
      if (match[0] === '<!--') {
        const end = masked.indexOf('-->', match.index + 4);
        if (end === -1) {
          parts.push({ _tag: 'Comment', text: source.slice(match.index) });
          this.#isInComment = true;
          return { source, parts };
        }
        parts.push({ _tag: 'Comment', text: source.slice(match.index, end + 3) });
        cursor = end + 3;
        this.#token.lastIndex = cursor;
        continue;
      }

      const span = this.#parseSpan(source, masked, match, lineNumber);
      if (span === undefined) return { source, parts: [{ _tag: 'Text', text: source }] };
      parts.push(span.part);
      cursor = span.end;
      this.#token.lastIndex = cursor;
    }
    parts.push({ _tag: 'Text', text: source.slice(cursor) });
    return { source, parts: parts.filter((part) => part._tag !== 'Text' || part.text !== '') };
  }

  #parseSpan(
    source: string,
    masked: string,
    open: RegExpExecArray,
    lineNumber: number,
  ): { readonly part: MarkupPart; readonly end: number } | undefined {
    const [openTag, slash, name, attributeSource] = open;
    const level = this.#levelOf(name);
    if (this.#block !== undefined) {
      this.#error(
        lineNumber,
        `nested <${level}> inside the block opened on line ${this.#block.line}`,
      );
      return undefined;
    }
    if (slash === '/') {
      this.#error(lineNumber, `</${level}> without an opening tag`);
      return undefined;
    }

    const openEnd = open.index + openTag.length;
    this.#tag.lastIndex = openEnd;
    const close = this.#tag.exec(masked);
    if (close === null || close[1] !== '/' || this.#levelOf(close[2]) !== level) {
      this.#error(lineNumber, `<${level}> span must close on the same line, without nesting`);
      return undefined;
    }

    const attributes = this.#parseAttributes(attributeSource, lineNumber);
    const closeEnd = close.index + close[0].length;
    return {
      part: {
        _tag: 'Span',
        level,
        alt: attributes.get('alt'),
        open: source.slice(open.index, openEnd),
        text: source.slice(openEnd, close.index),
        close: source.slice(close.index, closeEnd),
      },
      end: closeEnd,
    };
  }

  #parseAttributes(source: string | undefined, lineNumber: number): ReadonlyMap<string, string> {
    const attributes = new Map<string, string>();
    const rest = (source ?? '')
      .replace(ATTRIBUTE, (_, key: string, value: string) => {
        if (!ALLOWED_ATTRIBUTES.has(key)) this.#error(lineNumber, `unknown attribute "${key}"`);
        attributes.set(key, value);
        return '';
      })
      .trim();
    if (rest !== '') this.#error(lineNumber, `malformed attributes: ${rest}`);
    return attributes;
  }

  #levelOf(name: string | undefined): Level {
    const level = this.#levelsByName.get((name ?? '').toLowerCase());
    if (level === undefined) throw new Error(`unexpected tag name ${name}`);
    return level;
  }

  #pushLine(line: MarkupLine): void {
    if (this.#block !== undefined) this.#block.lines.push(line);
    else this.#nodes.push({ _tag: 'Line', line });
  }

  #warnUnlessBlank(neighbor: string | undefined, lineNumber: number, message: string): void {
    if (neighbor !== undefined && neighbor.trim() !== '') {
      this.#problems.push({ line: lineNumber, severity: 'warning', message });
    }
  }

  #error(lineNumber: number, message: string): void {
    this.#problems.push({ line: lineNumber, severity: 'error', message });
  }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const absurd = (value: never): never => {
  throw new Error(`unexpected value ${JSON.stringify(value)}`);
};
