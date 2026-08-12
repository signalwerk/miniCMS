import assert from "node:assert/strict";
import test from "node:test";
import { ID_PATTERN } from "../../../core/id.js";
import {
  createOrReuseTag,
  createTagRecord,
  normalizeTagIds,
  tagOptions
} from "./tags.js";

const collection = {
  name: "tags",
  node_type: "tag",
  identifier_field: "name",
  slug: "{{name}}-{{year}}-{{month}}",
  views: {
    reference: {
      value: "content_id",
      title: "name"
    }
  }
};

const nodeTypes = {
  tag: {
    fields: {
      content_id: { widget: "id" },
      name: { widget: "string" },
      featured: { widget: "boolean" }
    },
    slots: {
      details: {
        allowed_types: ["tag_note"],
        default: [{ type: "tag_note", properties: { text: "Seed" } }]
      }
    }
  },
  tag_note: {
    fields: { text: { widget: "text" } }
  }
};

test("normalizes stored tag IDs without losing order", () => {
  assert.deepEqual(
    normalizeTagIds([
      "aaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbb",
      "aaaaaaaaaaaaaaa",
      "short",
      "",
      null
    ]),
    ["aaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbb"]
  );
  assert.deepEqual(normalizeTagIds("aaaaaaaaaaaaaaa"), []);
});

test("maps collection-published tag values and labels to select options", () => {
  const items = [
    {
      id: "research-2026-08",
      properties: { content_id: "aaaaaaaaaaaaaaa", name: "Research" }
    },
    {
      id: "duplicate",
      properties: { content_id: "aaaaaaaaaaaaaaa", name: "Duplicate" }
    },
    {
      id: "typography-2026-08",
      properties: { content_id: "bbbbbbbbbbbbbbb", name: "Typography" }
    },
    {
      id: "invalid",
      properties: { content_id: "not-a-generated-id", name: "Invalid" }
    }
  ];

  assert.deepEqual(
    tagOptions(items, collection).map(({ value, label }) => ({ value, label })),
    [
      { value: "aaaaaaaaaaaaaaa", label: "Research" },
      { value: "bbbbbbbbbbbbbbb", label: "Typography" }
    ]
  );
});

test("builds a complete collision-safe tag record", () => {
  const record = createTagRecord({
    label: "  Research  ",
    collection,
    nodeTypes,
    items: [
      { id: "research-2026-08", order: 2 },
      { id: "another", order: 7 }
    ],
    date: new Date(2026, 7, 3)
  });

  assert.equal(record.id, "research-2026-08-2");
  assert.equal(record.type, "tag");
  assert.equal(record.order, 8);
  assert.match(record.properties.content_id, ID_PATTERN);
  assert.notEqual(record.properties.content_id, record.id);
  assert.equal(record.properties.name, "Research");
  assert.equal(record.properties.featured, false);
  assert.equal(record.slots.details.length, 1);
  assert.equal(record.slots.details[0].properties.text, "Seed");
  assert.match(record.slots.details[0].id, ID_PATTERN);
});

test("requires a generated relation ID and a string label field", () => {
  const invalidCollection = structuredClone(collection);
  invalidCollection.views.reference.value = "name";

  assert.throws(
    () =>
      createTagRecord({
        label: "Research",
        collection: invalidCollection,
        nodeTypes,
        items: []
      }),
    /not configured for creation/
  );
});

test("reuses a concurrently created tag after a conflict", async () => {
  const concurrent = {
    id: "research-2026-08",
    properties: { content_id: "aaaaaaaaaaaaaaa", name: "Research" }
  };
  let createCalls = 0;
  const adapter = {
    async create() {
      createCalls += 1;
      throw Object.assign(new Error("conflict"), { status: 409 });
    },
    async list() {
      return { items: [concurrent] };
    }
  };

  const result = await createOrReuseTag({
    adapter,
    label: "research",
    collection,
    nodeTypes,
    date: new Date(2026, 7, 3)
  });

  assert.equal(result.item, concurrent);
  assert.equal(result.created, false);
  assert.equal(createCalls, 1);
});

test("retries an unrelated concurrent filename collision once", async () => {
  const collision = {
    id: "research-2026-08",
    order: 0,
    properties: { content_id: "aaaaaaaaaaaaaaa", name: "Elsewhere" }
  };
  const attemptedIds = [];
  const adapter = {
    async create(_collectionName, record) {
      attemptedIds.push(record.id);
      if (attemptedIds.length === 1) {
        throw Object.assign(new Error("conflict"), { status: 409 });
      }
      return { item: record };
    },
    async list() {
      return { items: [collision] };
    }
  };

  const result = await createOrReuseTag({
    adapter,
    label: "Research",
    collection,
    nodeTypes,
    date: new Date(2026, 7, 3)
  });

  assert.deepEqual(attemptedIds, [
    "research-2026-08",
    "research-2026-08-2"
  ]);
  assert.equal(result.item.id, "research-2026-08-2");
  assert.equal(result.created, true);
});
