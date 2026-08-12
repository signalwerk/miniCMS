export interface InlineLink {
  readonly collection: string;
  readonly ref: string;
}

export interface InlineLinkOccurrence extends InlineLink {
  readonly href: string;
  /** Zero-based Markdown source offset of the link's opening `[`. */
  readonly offset: number;
}

export interface InlineLinkOccurrenceOptions {
  readonly collections?: readonly string[];
}

export interface MarkdownLinkOccurrence {
  readonly href: string;
  readonly offset: number;
  readonly destinationStart: number;
  readonly destinationEnd: number;
}

export const INLINE_LINK_PREFIX: "minicms://link/";
export const INLINE_LINK_PROTOCOL: "minicms:";

export function buildInlineLinkUrl(collection: string, ref: string): string;
export function parseInlineLinkUrl(value: unknown): InlineLink | null;
export function inlineLinkOccurrencesInMarkdown(
  markdown: unknown,
  options?: InlineLinkOccurrenceOptions
): InlineLinkOccurrence[];
export function markdownLinkOccurrencesInMarkdown(
  markdown: unknown
): MarkdownLinkOccurrence[];
export function isInlineLinkUrl(value: unknown): value is string;
