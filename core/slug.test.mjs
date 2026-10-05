import assert from "node:assert/strict";
import test from "node:test";
import {
  SLUG_PATTERN,
  isSlugWidgetTemplate,
  renderSlugTemplate,
  renderSlugWidgetTemplate,
  sanitizeFilenameStem,
  sanitizeSlug,
  slugWidgetTemplateFieldNames,
  slugTemplateFieldNames,
  recordFileStem,
  recordIdFromFileStem
} from "./slug.js";

test("sanitizes strict URL slugs and renders field-widget templates", () => {
  assert.equal(
    sanitizeSlug(" Crème brûlée / Zürich_2026 "),
    "creme-brulee-zurich-2026"
  );
  assert.equal(
    renderSlugWidgetTemplate("{{title}}-{{edition}}", {
      title: "Zwei Verlage",
      edition: 2026
    }),
    "zwei-verlage-2026"
  );
  assert.equal(
    renderSlugWidgetTemplate("archive-{{fields.title}}", { title: "Zürich" }),
    "archive-zurich"
  );
  assert.deepEqual(
    slugWidgetTemplateFieldNames("{{title}}-{{edition}}-{{title}}"),
    ["title", "edition"]
  );
  assert.equal(isSlugWidgetTemplate("{{title}}-{{edition}}"), true);
  assert.equal(isSlugWidgetTemplate("{{title"), false);
  assert.equal(isSlugWidgetTemplate("fixed-value"), false);
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

test("sanitizes filename stems", () => {
  assert.equal(sanitizeFilenameStem(" Crème brûlée / "), "creme-brulee");
  assert.equal(sanitizeFilenameStem("", ""), "");
});

test("names record files <slug>-<id> or <id> and reads the id back", () => {
  const id = "ynjggj2sfwol415";
  const collection = { slug: "{{title}}-{{year}}-{{month}}" };
  const stem = recordFileStem(id, collection, {
    fields: { title: "Crème brûlée" },
    date: new Date(2026, 8, 1)
  });
  assert.equal(stem, `creme-brulee-2026-09-${id}`);
  assert.equal(recordFileStem(id, {}), id);
  assert.equal(recordFileStem(id, { slug: "{{title}}" }, { fields: {} }), id);
  assert.equal(
    recordFileStem(id, { slug: "{{title}}" }, { fields: { title: "x".repeat(300) } })
      .length,
    120 + 1 + id.length
  );
  assert.equal(recordIdFromFileStem(stem), id);
  assert.equal(recordIdFromFileStem(id), id);
  assert.equal(recordIdFromFileStem("home"), null);
  assert.equal(recordIdFromFileStem(`x${id}`), null);
});
