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
  if (parseInlineReferenceUrl(value)) return true;
  if (typeof value !== "string") return false;
  return SAFE_LINK_PATTERN.test(value.replace(UNICODE_WHITESPACE, ""));
}

function markerRunLength(markdown, start, marker) {
  let size = 0;
  while (markdown[start + size] === marker) size += 1;
  return size;
}

function closingCodeSpan(markdown, start) {
  const size = markerRunLength(markdown, start, "`");
  let cursor = start + size;
  while (cursor < markdown.length) {
    const next = markdown.indexOf("`", cursor);
    if (next === -1) return -1;
    const candidateSize = markerRunLength(markdown, next, "`");
    if (candidateSize === size) return next + size;
    cursor = next + candidateSize;
  }
  return -1;
}

function lineEnd(markdown, start) {
  const end = markdown.indexOf("\n", start);
  return end === -1 ? markdown.length : end;
}

function nextLineStart(markdown, start) {
  const end = markdown.indexOf("\n", start);
  return end === -1 ? markdown.length : end + 1;
}

function fenceMarkerAt(markdown, lineStart) {
  let markerStart = lineStart;
  while (markerStart < lineStart + 3 && markdown[markerStart] === " ") {
    markerStart += 1;
  }
  const marker = markdown[markerStart];
  if (marker !== "`" && marker !== "~") return null;
  const size = markerRunLength(markdown, markerStart, marker);
  if (size < 3) return null;
  return { marker, markerStart, size };
}

function fencedCodeBlockEnd(markdown, lineStart) {
  const opening = fenceMarkerAt(markdown, lineStart);
  if (!opening) return -1;
  const openingLineEnd = lineEnd(markdown, opening.markerStart + opening.size);
  if (
    opening.marker === "`" &&
    markdown
      .slice(opening.markerStart + opening.size, openingLineEnd)
      .includes("`")
  ) {
    return -1;
  }

  let cursor = nextLineStart(markdown, openingLineEnd);
  while (cursor < markdown.length) {
    const closing = fenceMarkerAt(markdown, cursor);
    if (closing?.marker === opening.marker && closing.size >= opening.size) {
      const closingLineEnd = lineEnd(
        markdown,
        closing.markerStart + closing.size
      );
      if (
        /^[ \t\r]*$/.test(
          markdown.slice(closing.markerStart + closing.size, closingLineEnd)
        )
      ) {
        return nextLineStart(markdown, closingLineEnd);
      }
    }
    cursor = nextLineStart(markdown, cursor);
  }
  return markdown.length;
}

function closingLabelBracket(markdown, start) {
  let depth = 1;
  for (let cursor = start; cursor < markdown.length; cursor += 1) {
    if (markdown[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (markdown[cursor] === "`") {
      const end = closingCodeSpan(markdown, cursor);
      if (end !== -1) {
        cursor = end - 1;
      } else {
        cursor += markerRunLength(markdown, cursor, "`") - 1;
      }
      continue;
    }
    if (markdown[cursor] === "[") depth += 1;
    if (markdown[cursor] !== "]") continue;
    depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
}

function isEscaped(markdown, index) {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && markdown[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function closingLinkParenthesis(markdown, start) {
  let cursor = start;
  while (/[ \t\n\r]/.test(markdown[cursor] ?? "")) cursor += 1;

  let destinationStart = cursor;
  let destinationEnd;
  if (markdown[cursor] === "<") {
    destinationStart = cursor + 1;
    cursor += 1;
    while (
      cursor < markdown.length &&
      markdown[cursor] !== ">" &&
      markdown[cursor] !== "\n" &&
      markdown[cursor] !== "\r" &&
      markdown[cursor] !== "<"
    ) {
      if (markdown[cursor] === "\\" && cursor + 1 < markdown.length) {
        cursor += 2;
      } else {
        cursor += 1;
      }
    }
    if (markdown[cursor] !== ">") return null;
    destinationEnd = cursor;
    cursor += 1;
  } else {
    let depth = 0;
    while (cursor < markdown.length) {
      const character = markdown[cursor];
      if (character === "\\" && cursor + 1 < markdown.length) {
        cursor += 2;
        continue;
      }
      if (/\s/.test(character)) break;
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      cursor += 1;
    }
    if (depth !== 0) return null;
    destinationEnd = cursor;
  }
  if (destinationEnd === destinationStart) return null;

  const whitespaceStart = cursor;
  while (/[ \t\n\r]/.test(markdown[cursor] ?? "")) cursor += 1;
  if (markdown[cursor] === ")") {
    return { destinationStart, destinationEnd, end: cursor + 1 };
  }
  if (cursor === whitespaceStart) return null;

  const titleOpening = markdown[cursor];
  const titleClosing = titleOpening === "(" ? ")" : titleOpening;
  if (titleOpening !== '"' && titleOpening !== "'" && titleOpening !== "(") {
    return null;
  }
  cursor += 1;
  while (
    cursor < markdown.length &&
    markdown[cursor] !== titleClosing &&
    markdown[cursor] !== "\n" &&
    markdown[cursor] !== "\r"
  ) {
    if (markdown[cursor] === "\\" && cursor + 1 < markdown.length) {
      cursor += 2;
    } else {
      cursor += 1;
    }
  }
  if (markdown[cursor] !== titleClosing) return null;
  cursor += 1;
  while (/[ \t\n\r]/.test(markdown[cursor] ?? "")) cursor += 1;
  if (markdown[cursor] !== ")") return null;
  return { destinationStart, destinationEnd, end: cursor + 1 };
}

function inlineLinkAt(markdown, start) {
  const labelEnd = closingLabelBracket(markdown, start + 1);
  if (labelEnd === -1 || markdown[labelEnd + 1] !== "(") return null;
  return closingLinkParenthesis(markdown, labelEnd + 2);
}

function inlineReferenceOccurrencesInMarkdown(markdown, options = {}) {
  if (typeof markdown !== "string" || !markdown) return [];
  const collection =
    options && typeof options.collection === "string"
      ? options.collection
      : null;
  const occurrences = [];
  let cursor = 0;

  while (cursor < markdown.length) {
    if (cursor === 0 || markdown[cursor - 1] === "\n") {
      const fenceEnd = fencedCodeBlockEnd(markdown, cursor);
      if (fenceEnd !== -1) {
        cursor = fenceEnd;
        continue;
      }
    }
    if (markdown[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (markdown[cursor] === "`") {
      const end = closingCodeSpan(markdown, cursor);
      cursor =
        end === -1
          ? cursor + markerRunLength(markdown, cursor, "`")
          : end;
      continue;
    }
    if (markdown[cursor] !== "[") {
      cursor += 1;
      continue;
    }

    const link = inlineLinkAt(markdown, cursor);
    if (!link) {
      cursor += 1;
      continue;
    }
    const isImage =
      markdown[cursor - 1] === "!" && !isEscaped(markdown, cursor - 1);
    if (!isImage) {
      const href = markdown.slice(link.destinationStart, link.destinationEnd);
      const reference = parseInlineReferenceUrl(href);
      if (
        reference &&
        (collection === null || reference.collection === collection)
      ) {
        occurrences.push({
          href: buildInlineReferenceUrl(reference.collection, reference.ref),
          collection: reference.collection,
          ref: reference.ref,
          offset: cursor
        });
      }
    }
    cursor = link.end;
  }

  return occurrences;
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
