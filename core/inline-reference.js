import {
  markdownLinkOccurrencesInMarkdown,
  parseInlineLinkUrl
} from "./inline-link.js";

const INLINE_REFERENCE_PREFIX = "minicms://reference/";
const INLINE_REFERENCE_PROTOCOL = "minicms:";
const INLINE_REFERENCE_HOST = "reference";
const COLLECTION_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const SAFE_LINK_PATTERN =
  /^(?:(?:http|https|ftp|ftps|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z0-9+.\-]+(?:[^a-z+.\-:]|$))/i;
const UNICODE_WHITESPACE =
  /[\u0000-\u0020\u00a0\u1680\u180e\u2000-\u2029\u205f\u3000]/g;

function buildInlineReferenceUrl(collection, ref) {
  if (typeof collection !== "string" || !COLLECTION_PATTERN.test(collection)) {
    throw new TypeError("Inline reference collection is invalid.");
  }
  if (
    typeof ref !== "string" ||
    !ref ||
    ref === "." ||
    ref === ".." ||
    CONTROL_CHARACTER_PATTERN.test(ref)
  ) {
    throw new TypeError("Inline reference value is invalid.");
  }
  return `${INLINE_REFERENCE_PREFIX}${encodeSegment(collection)}/${encodeSegment(ref)}`;
}

function encodeSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function parseInlineReferenceUrl(value) {
  if (typeof value !== "string" || !value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== INLINE_REFERENCE_PROTOCOL ||
    url.hostname !== INLINE_REFERENCE_HOST ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  const segments = url.pathname.slice(1).split("/");
  if (segments.length !== 2 || segments.some((segment) => !segment)) {
    return null;
  }
  let collection;
  let ref;
  try {
    collection = decodeURIComponent(segments[0]);
    ref = decodeURIComponent(segments[1]);
  } catch {
    return null;
  }
  if (
    !COLLECTION_PATTERN.test(collection) ||
    !ref ||
    ref === "." ||
    ref === ".." ||
    CONTROL_CHARACTER_PATTERN.test(ref)
  ) {
    return null;
  }
  if (buildInlineReferenceUrl(collection, ref) !== value) return null;
  return { collection, ref };
}

function isInlineReferenceUrl(value) {
  return parseInlineReferenceUrl(value) !== null;
}

function isAllowedMarkdownLink(value) {
  if (parseInlineReferenceUrl(value) || parseInlineLinkUrl(value)) return true;
  if (typeof value !== "string") return false;
  return SAFE_LINK_PATTERN.test(value.replace(UNICODE_WHITESPACE, ""));
}

function inlineReferenceOccurrencesInMarkdown(markdown, options = {}) {
  const collection =
    options && typeof options.collection === "string"
      ? options.collection
      : null;
  return markdownLinkOccurrencesInMarkdown(markdown).flatMap((occurrence) => {
    const reference = parseInlineReferenceUrl(occurrence.href);
    if (
      !reference ||
      (collection !== null && reference.collection !== collection)
    ) {
      return [];
    }
    return [
      {
        href: buildInlineReferenceUrl(reference.collection, reference.ref),
        collection: reference.collection,
        ref: reference.ref,
        offset: occurrence.offset
      }
    ];
  });
}

export {
  INLINE_REFERENCE_PREFIX,
  INLINE_REFERENCE_PROTOCOL,
  buildInlineReferenceUrl,
  inlineReferenceOccurrencesInMarkdown,
  isAllowedMarkdownLink,
  isInlineReferenceUrl,
  parseInlineReferenceUrl
};
