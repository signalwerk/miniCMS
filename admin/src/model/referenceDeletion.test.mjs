import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectDeletionUsage,
  planReferenceRepairs,
  repairDeletionUsage,
  replacementChoices,
} from "./referenceDeletion.js";
import { rewriteMarkdownLinks } from "../../../core/inline-link.js";
const oldId = "aaaaaaaaaaaaaaa",
  newId = "bbbbbbbbbbbbbbb",
  imageId = "ccccccccccccccc",
  pageId = "ddddddddddddddd",
  childId = "eeeeeeeeeeeeeee";
function fixture() {
  const config = {
    node_types: {
      author: { fields: { name: { widget: "string" } } },
      image: {
        fields: {
          authors: {
            widget: "reference",
            collection: "authors",
            multiple: true,
          },
          other: { widget: "text" },
        },
      },
      page: {
        fields: {
          url: { widget: "url", internal_links: { collections: ["authors"] } },
          body: {
            widget: "markdown",
            blocknote: {
              inline_reference: { collection: "authors" },
              internal_links: { collections: ["authors"] },
            },
          },
        },
      },
      block: {
        fields: { credit: { widget: "reference", collection: "authors" } },
      },
    },
    collections: {
      authors: { node_type: "author", views: { reference: { title: "name" } } },
      images: { node_type: "image" },
      pages: { node_type: "page" },
    },
  };
  config.node_types.page.slots = { content: { allowed_types: ["block"] } };
  const author = (id) => ({
    id,
    type: "author",
    properties: { name: id },
    slots: {},
  });
  const store = {
    authors: [author(oldId), author(newId)],
    images: [
      {
        id: imageId,
        type: "image",
        properties: { authors: [oldId, newId], other: oldId },
        slots: {},
      },
    ],
    pages: [
      {
        id: pageId,
        type: "page",
        properties: {
          url: `minicms://link/authors/${oldId}`,
          body: `[Credit](minicms://reference/authors/${oldId}) and [Author](minicms://link/authors/${oldId} "Title"). \`[Code](minicms://reference/authors/${oldId})\` ![Image](minicms://link/authors/${oldId})`,
        },
        slots: {
          content: [
            {
              id: childId,
              type: "block",
              properties: {
                credit: { ref: oldId, selections: { crop: "crop1" } },
              },
              slots: {},
            },
          ],
        },
      },
    ],
  };
  const writes = [],
    reads = [];
  const api = {
    async list(name) {
      return {
        items: store[name].map((r) => ({
          id: r.id,
          type: r.type,
          properties: structuredClone(r.properties),
        })),
      };
    },
    async record(name, id) {
      reads.push([name, id]);
      const r = store[name].find((r) => r.id === id);
      if (!r) throw Error("Not found");
      return structuredClone(r);
    },
    async save(name, r) {
      writes.push([name, r.id]);
      store[name][store[name].findIndex((x) => x.id === r.id)] =
        structuredClone(r);
    },
  };
  return { config, store, api, writes, reads };
}
test("loads complete records, finds nested/multiple/Markdown/URL links, ignores literal text and code/images", async () => {
  const { config, api } = fixture();
  const p = await inspectDeletionUsage(
    api,
    config,
    "authors",
    new Set([oldId]),
  );
  assert.equal(p.records.length, 2);
  assert.equal(
    p.records.find((r) => r.collection === "pages").usages.length,
    3,
  );
  assert.equal(p.candidates.length, 1);
});
test("replacement deduplicates ordered arrays, resets target selections, preserves other content", async () => {
  const { config, api, store } = fixture();
  const p = await inspectDeletionUsage(
    api,
    config,
    "authors",
    new Set([oldId]),
  );
  const before = structuredClone(store);
  const repairs = planReferenceRepairs(
    p,
    config,
    { [oldId]: newId },
    { [oldId]: store.authors[1] },
  );
  assert.deepEqual(store, before);
  const img = repairs.find((r) => r.collection === "images").after;
  assert.deepEqual(img.properties.authors, [newId]);
  assert.equal(img.properties.other, oldId);
  const page = repairs.find((r) => r.collection === "pages").after;
  assert.equal(page.slots.content[0].properties.credit, newId);
  assert.equal(page.properties.url, `minicms://link/authors/${newId}`);
  assert(
    page.properties.body.includes(
      `[Author](minicms://link/authors/${newId} "Title")`,
    ),
  );
  assert(
    page.properties.body.includes(
      `\`[Code](minicms://reference/authors/${oldId})\``,
    ),
  );
});
test("unlink removes only selected array entries and actual link markup, retaining Markdown labels", async () => {
  const { config, api } = fixture();
  const p = await inspectDeletionUsage(
    api,
    config,
    "authors",
    new Set([oldId]),
  );
  const r = planReferenceRepairs(p, config, { [oldId]: "remove" }, {});
  assert.deepEqual(r[0].after.properties.authors, [newId]);
  assert.equal(r[1].after.properties.url, "");
  assert(r[1].after.properties.body.startsWith("Credit and Author."));
  assert.equal(r[1].after.slots.content[0].properties.credit, "");
});
test("required fields reject unlink before writes", async () => {
  const { config, api, writes } = fixture();
  config.node_types.block.fields.credit.required = true;
  const p = await inspectDeletionUsage(
    api,
    config,
    "authors",
    new Set([oldId]),
  );
  await assert.rejects(
    repairDeletionUsage(api, config, p, { [oldId]: "remove" }),
    /required/,
  );
  assert.equal(writes.length, 0);
});
test("repairs are saved and verified, retry after partial save is safe", async () => {
  const { config, api, store, writes } = fixture();
  const p = await inspectDeletionUsage(
    api,
    config,
    "authors",
    new Set([oldId]),
  );
  const save = api.save;
  api.save = async (name, r) => {
    if (name === "pages") throw Error("failed");
    return save(name, r);
  };
  await assert.rejects(
    repairDeletionUsage(api, config, p, { [oldId]: newId }),
    /failed/,
  );
  assert.deepEqual(store.images[0].properties.authors, [newId]);
  assert.equal(store.authors.length, 2);
  api.save = save;
  await repairDeletionUsage(api, config, p, { [oldId]: newId });
  assert.deepEqual(writes, [
    ["images", imageId],
    ["pages", pageId],
  ]);
  assert.equal(
    (await inspectDeletionUsage(api, config, "authors", new Set([oldId])))
      .records.length,
    0,
  );
});
test("new incoming links abort before changing any records", async () => {
  const { config, api, store, writes } = fixture();
  const p = await inspectDeletionUsage(
    api,
    config,
    "authors",
    new Set([oldId]),
  );
  store.images.push({
    ...structuredClone(store.images[0]),
    id: "fffffffffffffff",
  });
  await assert.rejects(
    repairDeletionUsage(api, config, p, { [oldId]: "remove" }),
    /New links/,
  );
  assert.equal(writes.length, 0);
});
test("missing or incompatible replacements abort, and targets in deletion set are excluded", async () => {
  const { config, api, store } = fixture();
  config.node_types.block.fields.credit.allowed_types = ["different"];
  const p = await inspectDeletionUsage(
    api,
    config,
    "authors",
    new Set([oldId]),
  );
  assert.deepEqual(replacementChoices(p, config, oldId), []);
  assert.throws(
    () =>
      planReferenceRepairs(
        p,
        config,
        { [oldId]: newId },
        { [oldId]: store.authors[1] },
      ),
    /valid replacement/,
  );
  const all = await inspectDeletionUsage(
    api,
    config,
    "authors",
    new Set([oldId, newId]),
  );
  assert.deepEqual(all.candidates, []);
});
test("scan failure is never interpreted as unused", async () => {
  const { config, api } = fixture();
  api.list = async () => {
    throw Error("Sign in");
  };
  await assert.rejects(
    inspectDeletionUsage(api, config, "authors", new Set([oldId])),
    /Sign in/,
  );
});
test("published non-ID values and field-specific value overrides are respected", async () => {
  const { config, api, store } = fixture();
  config.collections.authors.views.reference.value = "name";
  store.authors[0].properties.name = "Old";
  store.authors[1].properties.name = "New";
  store.images[0].properties.authors = ["Old", "New"];
  config.node_types.block.fields.credit.value_field = "id";
  const p = await inspectDeletionUsage(
    api,
    config,
    "authors",
    new Set([oldId]),
  );
  const r = planReferenceRepairs(
    p,
    config,
    { [oldId]: newId },
    { [oldId]: store.authors[1] },
  );
  assert.deepEqual(r[0].after.properties.authors, ["New"]);
  assert.equal(r[1].after.slots.content[0].properties.credit, newId);
});
test("Markdown unlink preserves nested/escaped label formatting and excludes code", () => {
  const text =
    '[A **bold** [label]](<minicms://link/authors/x> "title") + `[code](minicms://link/authors/x)`';
  assert.equal(
    rewriteMarkdownLinks(text, () => null),
    "A **bold** [label] + `[code](minicms://link/authors/x)`",
  );
});
