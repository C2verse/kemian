const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/u;
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/u;
const INLINE_CODE = /(`+)[^`].*?\1/gu;
const INLINE_LINK = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu;
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/u;
const HTML_REFERENCE = /\b(?:href|src)\s*=\s*"([^"]*)"/giu;
const HEADING_1 = /^#\s+(.+?)\s*#*\s*$/u;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

/**
 * Tracker of fenced code blocks while reading Markdown line by line.
 */
export class FenceTracker {
  #fence: string | undefined;

  /**
   * Returns whether the line is part of a fenced code block, including its fence lines.
   */
  isCode(line: string): boolean {
    if (this.#fence !== undefined) {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (
        close !== undefined &&
        close[0] === this.#fence[0] &&
        close.length >= this.#fence.length
      ) {
        this.#fence = undefined;
      }
      return true;
    }
    const open = FENCE_OPEN.exec(line)?.[1];
    if (open === undefined) return false;
    this.#fence = open;
    return true;
  }

  /**
   * Returns whether a fenced code block is still open.
   */
  get isOpen(): boolean {
    return this.#fence !== undefined;
  }
}

/**
 * Blanks out inline code so markup and links inside it are ignored, keeping the line's length.
 */
export const maskInlineCode = (line: string): string =>
  line.replace(INLINE_CODE, (code) => ' '.repeat(code.length));

/**
 * Returns the relative link targets in Markdown, ignoring code, external URLs, and anchors.
 */
export const extractLinkTargets = (markdown: string): string[] => {
  const targets: string[] = [];
  const fences = new FenceTracker();
  for (const line of markdown.split('\n')) {
    if (fences.isCode(line)) continue;
    const masked = maskInlineCode(line);
    const candidates = [
      ...[...masked.matchAll(INLINE_LINK)].map((match) => match[1]),
      REFERENCE_DEFINITION.exec(masked)?.[1],
      ...[...masked.matchAll(HTML_REFERENCE)].map((match) => match[1]),
    ];
    for (const candidate of candidates) {
      const target = normalizeLinkTarget(candidate);
      if (target !== undefined) targets.push(target);
    }
  }
  return targets;
};

/**
 * Returns the text of the first level-1 heading outside code, if any.
 */
export const extractHeading1 = (markdown: string): string | undefined => {
  const fences = new FenceTracker();
  for (const line of markdown.split('\n')) {
    if (fences.isCode(line)) continue;
    const heading = HEADING_1.exec(line)?.[1];
    if (heading !== undefined) return heading;
  }
  return undefined;
};

const normalizeLinkTarget = (candidate: string | undefined): string | undefined => {
  if (candidate === undefined) return undefined;
  const unwrapped = candidate.startsWith('<') ? candidate.slice(1, -1) : candidate;
  const withoutFragment = unwrapped.split('#')[0]?.split('?')[0] ?? '';
  if (withoutFragment === '' || URL_SCHEME.test(withoutFragment)) return undefined;
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
};
