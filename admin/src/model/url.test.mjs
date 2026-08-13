import assert from "node:assert/strict";
import test from "node:test";
import { buildInlineLinkUrl } from "../../../core/inline-link.js";
import {
  parsedContentUrl,
  rawUrlValue,
  resolvedUrlLabel
} from "./url.js";

test("normalizes raw and resolved URL-field values", () => {
  const internal = buildInlineLinkUrl("pages", "home");
  assert.equal(rawUrlValue("https://example.com"), "https://example.com");
  assert.equal(rawUrlValue({ url: internal, link: null }), internal);
  assert.equal(rawUrlValue({}), "");
  assert.deepEqual(parsedContentUrl({ url: internal }), {
    collection: "pages",
    ref: "home"
  });
  assert.equal(parsedContentUrl("https://example.com"), null);
});

test("formats internal URL fields without exposing their custom URI", () => {
  const internal = buildInlineLinkUrl("pages", "home");
  assert.equal(resolvedUrlLabel(internal), "Content link: home");
  assert.equal(
    resolvedUrlLabel({
      url: internal,
      link: { record: { properties: { title: "Home" } } }
    }),
    "Home"
  );
  assert.equal(
    resolvedUrlLabel(
      {
        url: internal,
        link: { record: { properties: { name: "Start" } } }
      },
      { views: { reference: { title: "name" } } }
    ),
    "Start"
  );
  assert.equal(resolvedUrlLabel("https://example.com"), "https://example.com");
  assert.equal(
    resolvedUrlLabel("minicms://link/pages/not%ZZcanonical"),
    "Invalid content link"
  );
  assert.equal(resolvedUrlLabel(""), "—");
});
