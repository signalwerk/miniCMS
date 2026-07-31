import assert from "node:assert/strict";
import test from "node:test";
import {
  renderSlugTemplate,
  sanitizeFilenameStem,
  slugTemplateFieldNames,
  uniqueFilenameStem
} from "./slug.js";

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
