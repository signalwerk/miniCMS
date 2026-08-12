import assert from "node:assert/strict";
import test from "node:test";
import { ID_PATTERN } from "../../../core/id.js";
import {
  firstSeededDescendant,
  instantiateNode,
  populateInitialSlugFields,
  updateCreationProperties
} from "./nodeFactory.js";

const nodeTypes = {
  page: {
    fields: {
      content_id: { widget: "id" },
      title: { widget: "string", required: true }
    },
    slots: {
      content: {
        allowed_types: ["section"],
        default: [
          { type: "section", properties: { enabled: true } },
          { type: "section", properties: { enabled: false } }
        ]
      }
    }
  },
  section: {
    fields: {
      content_id: { widget: "id" },
      enabled: { widget: "boolean" }
    },
    slots: {
      heading: {
        allowed_types: ["title"],
        default: [{
          type: "title",
          properties: { title: "", element: "none" }
        }]
      }
    }
  },
  title: {
    fields: {
      title: { widget: "text", required: true },
      element: {
        widget: "select",
        required: true,
        default: "h2",
        options: ["none", "h2"]
      }
    }
  }
};

test("instantiates ordered recursive slot defaults with unique generated IDs", () => {
  const templates = structuredClone(nodeTypes.page.slots.content.default);
  const record = instantiateNode("page", nodeTypes, {
    id: "aaaaaaaaaaaaaaa",
    order: 4,
    properties: {
      content_id: "aaaaaaaaaaaaaaa",
      title: "Home"
    }
  });
  const ids = [
    record.properties.content_id,
    ...record.slots.content.flatMap((section) => [
      section.id,
      section.properties.content_id,
      section.slots.heading[0].id
    ])
  ];

  assert.equal(record.id, "aaaaaaaaaaaaaaa");
  assert.equal(record.order, 4);
  assert.equal(record.properties.title, "Home");
  assert.deepEqual(
    record.slots.content.map((section) => section.properties.enabled),
    [true, false]
  );
  assert.deepEqual(
    record.slots.content.map((section) => section.slots.heading[0].properties),
    [
      { title: "", element: "none" },
      { title: "", element: "none" }
    ]
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => id === record.id).length, 1);
  ids.forEach((id) => assert.match(id, ID_PATTERN));
  assert.deepEqual(nodeTypes.page.slots.content.default, templates);
  assert.equal(firstSeededDescendant(record), record.slots.content[0]);
});

test("always emits complete slots and rejects explicit ID collisions", () => {
  const leaf = instantiateNode("title", nodeTypes);
  assert.deepEqual(leaf.slots, {});
  assert.throws(
    () => instantiateNode("title", nodeTypes, {
      id: "aaaaaaaaaaaaaaa",
      usedIds: new Set(["aaaaaaaaaaaaaaa"])
    }),
    /already in use/
  );
});

test("derives empty slug widgets from their configured templates", () => {
  const type = {
    fields: {
      title: { widget: "string" },
      edition: { widget: "number" },
      slug: { widget: "slug", template: "{{title}}-{{edition}}" }
    }
  };
  assert.deepEqual(
    populateInitialSlugFields(type, {
      title: "Crème brûlée",
      edition: 2026,
      slug: ""
    }),
    {
      title: "Crème brûlée",
      edition: 2026,
      slug: "creme-brulee-2026"
    }
  );
  assert.equal(
    populateInitialSlugFields(type, {
      title: "Changed",
      edition: 2026,
      slug: "kept-manually"
    }).slug,
    "kept-manually"
  );
  assert.equal(
    updateCreationProperties(type, {
      title: "Old title",
      edition: 2026,
      slug: "old-title-2026"
    }, "title", "New title").slug,
    "new-title-2026"
  );
  assert.equal(
    updateCreationProperties(type, {
      title: "Old title",
      edition: 2026,
      slug: "custom-slug"
    }, "title", "New title").slug,
    "custom-slug"
  );
});
