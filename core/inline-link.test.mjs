import assert from "node:assert/strict";
import test from "node:test";
import {
  INLINE_LINK_PREFIX,
  buildInlineLinkUrl,
  inlineLinkOccurrencesInMarkdown,
  isInlineLinkUrl,
  parseInlineLinkUrl
} from "./inline-link.js";
import { isAllowedMarkdownLink } from "./inline-reference.js";

test("round-trips canonical internal content-link URLs", () => {
  const url = buildInlineLinkUrl("pages", "A page / ä");
  assert.equal(url, "minicms://link/pages/A%20page%20%2F%20%C3%A4");
  assert.deepEqual(parseInlineLinkUrl(url), {
    collection: "pages",
    ref: "A page / ä"
  });
  assert.equal(INLINE_LINK_PREFIX, "minicms://link/");
  assert.equal(isInlineLinkUrl(url), true);
  assert.equal(isAllowedMarkdownLink(url), true);
});

test("rejects malformed or noncanonical internal content-link URLs", () => {
  for (const value of [
    "minicms://link/pages",
    "minicms://link/pages/item/extra",
    "minicms://reference/pages/item",
    "minicms://link/pages/item?draft=true",
    "minicms://link/pages/item#fragment",
    "minicms://user@link/pages/item",
    "MINICMS://link/pages/item",
    "minicms://link/page%73/item",
    "minicms://link/pages/line%0Abreak"
  ]) {
    assert.equal(parseInlineLinkUrl(value), null, value);
  }
  assert.throws(
    () => buildInlineLinkUrl("../pages", "item"),
    /collection is invalid/
  );
  assert.throws(() => buildInlineLinkUrl("pages", ""), /value is invalid/);
  assert.equal(isAllowedMarkdownLink("minicms://link/pages/item?bad=1"), false);
});

test("scans only configured content links outside code and images", () => {
  const page = buildInlineLinkUrl("pages", "home");
  const article = buildInlineLinkUrl("articles", "news");
  const markdown = [
    `Read [home](${page} "Home") and [news](<${article}>).`,
    `Read [home again](${page}).`,
    `\`[code](${page})\` and ![image](${page}).`,
    `\`\`\`md\n[fenced](${page})\n\`\`\``,
    `    [four-space code](${page})\n\n\t[tab code](${page})`
  ].join("\n\n");

  assert.deepEqual(
    inlineLinkOccurrencesInMarkdown(markdown, { collections: ["pages"] }),
    [
      {
        href: page,
        collection: "pages",
        ref: "home",
        offset: markdown.indexOf("[home]")
      },
      {
        href: page,
        collection: "pages",
        ref: "home",
        offset: markdown.indexOf("[home again]")
      }
    ]
  );
  assert.deepEqual(inlineLinkOccurrencesInMarkdown(null), []);
});

test("publishes the internal content-link core entry", async () => {
  const entry = await import("@signalwerk/minicms/core/inline-link");
  assert.equal(
    entry.buildInlineLinkUrl("pages", "home"),
    "minicms://link/pages/home"
  );
});
