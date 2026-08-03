import assert from "node:assert/strict";
import test from "node:test";
import {
  INLINE_REFERENCE_PREFIX,
  buildInlineReferenceUrl,
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
