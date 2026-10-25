import { parseDocument } from 'yaml';

/**
 * Markdown document split into its YAML frontmatter and body.
 */
export interface FrontmatterSplit {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
  /** 1-based line number of the body's first line in the original document. */
  readonly bodyFirstLine: number;
  readonly problem: string | undefined;
}

const DELIMITER = '---';

/**
 * Splits a Markdown document into its YAML frontmatter and body.
 *
 * A document without frontmatter has an empty one. Malformed frontmatter is reported as a problem.
 */
export const splitFrontmatter = (markdown: string): FrontmatterSplit => {
  const lines = markdown.split('\n');
  if (lines[0]?.trimEnd() !== DELIMITER) {
    return { frontmatter: {}, body: markdown, bodyFirstLine: 1, problem: undefined };
  }

  const end = lines.findIndex(
    (line, index) => index > 0 && (line.trimEnd() === DELIMITER || line.trimEnd() === '...'),
  );
  if (end === -1) {
    return {
      frontmatter: {},
      body: markdown,
      bodyFirstLine: 1,
      problem: 'frontmatter is never closed',
    };
  }

  const body = lines.slice(end + 1).join('\n');
  const bodyFirstLine = end + 2;
  const document = parseDocument(lines.slice(1, end).join('\n'));
  const [error] = document.errors;
  if (error !== undefined) {
    return {
      frontmatter: {},
      body,
      bodyFirstLine,
      problem: `invalid frontmatter: ${error.message}`,
    };
  }

  const value: unknown = document.toJS();
  if (value === null || value === undefined) {
    return { frontmatter: {}, body, bodyFirstLine, problem: undefined };
  }
  if (!isRecord(value)) {
    return { frontmatter: {}, body, bodyFirstLine, problem: 'frontmatter must be a mapping' };
  }
  return { frontmatter: value, body, bodyFirstLine, problem: undefined };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
