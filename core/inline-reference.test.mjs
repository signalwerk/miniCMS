import assert from "node:assert/strict";
import test from "node:test";
import {
  INLINE_REFERENCE_PREFIX,
  buildInlineReferenceUrl,
  inlineReferenceOccurrencesInMarkdown,
  isAllowedMarkdownLink,
  isInlineReferenceUrl,
  parseInlineReferenceUrl
} from "./inline-reference.js";

test("round-trips canonical inline reference URLs", () => {
  const url = buildInlineReferenceUrl("sources", "A source / ä");
  assert.equal(
    url,
    "minicms://reference/sources/A%20source%20%2F%20%C3%A4"
  );
  assert.deepEqual(parseInlineReferenceUrl(url), {
    collection: "sources",
    ref: "A source / ä"
  });
  assert.equal(INLINE_REFERENCE_PREFIX, "minicms://reference/");
  assert.equal(isInlineReferenceUrl(url), true);
});

test("rejects malformed or noncanonical inline reference URLs", () => {
  for (const value of [
    "minicms://reference/sources",
    "minicms://reference/sources/item/extra",
    "minicms://other/sources/item",
    "minicms://reference/sources/item?draft=true",
    "minicms://reference/sources/item#fragment",
    "minicms://user@reference/sources/item",
    "MINICMS://reference/sources/item",
    "minicms://reference/source%73/item",
    "minicms://reference/sources/line%0Abreak"
  ]) {
    assert.equal(parseInlineReferenceUrl(value), null, value);
  }
  assert.throws(
    () => buildInlineReferenceUrl("../sources", "item"),
    /collection is invalid/
  );
  assert.throws(
    () => buildInlineReferenceUrl("sources", ""),
    /value is invalid/
  );
  assert.throws(
    () => buildInlineReferenceUrl("sources", "line\nbreak"),
    /value is invalid/
  );
  for (const ref of [".", ".."]) {
    assert.throws(
      () => buildInlineReferenceUrl("sources", ref),
      /value is invalid/
    );
  }
  assert.equal(isInlineReferenceUrl("https://example.com"), false);
});

test("allows ordinary safe links and strict inline references", () => {
  for (const value of [
    "https://example.com",
    "mailto:editor@example.com",
    "/relative/path",
    "#section",
    buildInlineReferenceUrl("sources", "source-id")
  ]) {
    assert.equal(isAllowedMarkdownLink(value), true, value);
  }
  for (const value of [
    "javascript:alert(1)",
    "java\u200bscript:alert(1)",
    "data:text/html,unsafe",
    "minicms://reference/sources/item?unexpected=true"
  ]) {
    assert.equal(isAllowedMarkdownLink(value), false, value);
  }
});

test("scans duplicate inline-reference occurrences in Markdown source order", () => {
  const first = buildInlineReferenceUrl("sources", "First source / ä");
  const second = buildInlineReferenceUrl("notes", "second");
  const markdown = [
    `Read [one](${first} "Source title")`,
    `then [another](<${second}>),`,
    `then [one again](${first}).`
  ].join(" ");

  assert.deepEqual(inlineReferenceOccurrencesInMarkdown(markdown), [
    {
      href: first,
      collection: "sources",
      ref: "First source / ä",
      offset: markdown.indexOf("[one]")
    },
    {
      href: second,
      collection: "notes",
      ref: "second",
      offset: markdown.indexOf("[another]")
    },
    {
      href: first,
      collection: "sources",
      ref: "First source / ä",
      offset: markdown.indexOf("[one again]")
    }
  ]);
  assert.deepEqual(
    inlineReferenceOccurrencesInMarkdown(markdown, {
      collection: "sources"
    }).map(({ href, offset }) => ({ href, offset })),
    [
      { href: first, offset: markdown.indexOf("[one]") },
      { href: first, offset: markdown.indexOf("[one again]") }
    ]
  );
  assert.deepEqual(inlineReferenceOccurrencesInMarkdown(null), []);
});

test("scans only actual Markdown links outside code and images", () => {
  const href = buildInlineReferenceUrl("sources", "source-id");
  const escapedLink = `\\[escaped](${href})`;
  const inlineCode = `\`[inline code](${href})\``;
  const image = `![image](${href})`;
  const nestedInExternalLink = `[[nested](${href})](https://example.com)`;
  const backtickFence = [
    "````md",
    `[backtick fence](${href})`,
    "```",
    "````"
  ].join("\n");
  const tildeFence = [
    "~~~md",
    `[tilde fence](${href})`,
    "~~~"
  ].join("\n");
  const escapedImageMarker = `\\![link after escaped bang](${href})`;
  const actual = `[actual](${href})`;
  const plain = href;
  const markdown = [
    escapedLink,
    inlineCode,
    image,
    nestedInExternalLink,
    backtickFence,
    tildeFence,
    escapedImageMarker,
    actual,
    plain
  ].join("\n\n");

  assert.deepEqual(inlineReferenceOccurrencesInMarkdown(markdown), [
    {
      href,
      collection: "sources",
      ref: "source-id",
      offset: markdown.indexOf("[link after escaped bang]")
    },
    {
      href,
      collection: "sources",
      ref: "source-id",
      offset: markdown.indexOf("[actual]")
    }
  ]);
});
