import assert from "node:assert/strict";
import test from "node:test";
import {
  SLUG_PATTERN,
  renderSlugTemplate,
  sanitizeFilenameStem,
  sanitizeSlug,
  slugFromSources,
  slugTemplateFieldNames,
  uniqueFilenameStem
} from "./slug.js";

test("sanitizes strict URL slugs and derives them from ordered fields", () => {
  assert.equal(
    sanitizeSlug(" Crème brûlée / Zürich_2026 "),
    "creme-brulee-zurich-2026"
  );
  assert.equal(
    slugFromSources(["title", "edition"], {
      title: "Zwei Verlage",
      edition: 2026
    }),
    "zwei-verlage-2026"
  );
  assert.equal(slugFromSources(["missing"], {}), "");
  assert.equal(SLUG_PATTERN.test("zwei-verlage-2026"), true);
  assert.equal(SLUG_PATTERN.test("Zwei_Verlage"), false);
});

test("renders field and zero-padded creation-date placeholders", () => {
  assert.equal(
    renderSlugTemplate(
      "{{year}}-{{month}}-{{day}}_{{title}}_{{status}}",
      {
        fields: { title: "Hello World", status: "Draft" },
        date: new Date(2026, 6, 9, 4, 5, 6)
      }
    ),
    "2026-07-09_hello-world_draft"
  );
});

test("distinguishes the slug token from a field named slug", () => {
  assert.equal(
    renderSlugTemplate("{{slug}}_{{fields.slug}}_{{author.name}}", {
      fields: {
        title: "Main Title",
        slug: "Editorial URL",
        author: { name: "Ada Lovelace" }
      }
    }),
    "main-title_editorial-url_ada-lovelace"
  );
  assert.deepEqual(
    slugTemplateFieldNames(
      "{{year}}-{{slug}}-{{fields.slug}}-{{author.name}}",
      "title"
    ),
    ["title", "slug", "author.name"]
  );
});

test("sanitizes filenames and assigns case-insensitive collision suffixes", () => {
  const usedIds = new Set(["CREME-BRULEE", "creme-brulee-2"]);
  assert.equal(sanitizeFilenameStem(" Crème brûlée / "), "creme-brulee");
  assert.equal(uniqueFilenameStem("Crème brûlée", usedIds), "creme-brulee-3");
});
