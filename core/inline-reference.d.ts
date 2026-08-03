export interface InlineReference {
  readonly collection: string;
  readonly ref: string;
}

export const INLINE_REFERENCE_PREFIX: "minicms://reference/";
export const INLINE_REFERENCE_PROTOCOL: "minicms:";

export function buildInlineReferenceUrl(
  collection: string,
  ref: string
): string;
export function parseInlineReferenceUrl(
  value: unknown
): InlineReference | null;
export function isInlineReferenceUrl(value: unknown): value is string;
export function isAllowedMarkdownLink(value: unknown): value is string;
