import test from "node:test";
import assert from "node:assert/strict";
import {
  compactReferenceValue,
  createOrReuseReferencedRecord,
  createReferencedRecordDraft,
  createReferencedRecord,
  hasReferenceValue,
  normalizeReferenceValue,
  normalizeReferenceValues,
  referenceCreationConfig,
  referenceImageSource,
  referenceItemLabel,
  referenceItemValue,
  referencePickerOption,
  referenceRecordCreationConfig,
  referenceSelectionDefinitions,
  referenceSelectionOptions,
  referenceValueAfterSelection,
  referenceValuesAfterAdd,
  referenceValuesAfterToggle,
  storeReferencedRecordDraft,
  validateReferencedRecordDraft
} from "./reference.js";

const collection = {
  name: "images",
  folder: "content/images",
  extension: "yml",
  views: {
    reference: {
      selections: {
        crop: {
          label: "Crop region",
          kind: "image_region",
          options: {
            field: "file",
            path: "regions",
            value: "id",
            label: "label"
          }
        },
        focus: {
          label: "Focus point",
          kind: "image_point",
          options: {
            field: "file",
            path: "points",
            value: "id",
            label: "label"
          }
        }
      }
    }
  }
};

const item = {
  id: "example",
  properties: {
    uuid: "image-uuid",
    file: {
      src: "/media/example.jpg",
      regions: [
        { id: "landscape", label: "Landscape", x: 10, y: 20 },
        { id: "landscape", label: "Duplicate", x: 0, y: 0 }
      ],
      points: [
        { id: "face", label: "Face", x: 30, y: 40 }
      ]
    }
  }
};

test("normalizes and compacts scalar and selected reference values", () => {
  assert.deepEqual(normalizeReferenceValue("image-uuid"), {
    ref: "image-uuid",
    selections: {}
  });
  assert.deepEqual(
    compactReferenceValue({
      ref: "image-uuid",
      selections: { crop: "landscape", empty: "", ignored: 4 }
    }),
    {
      ref: "image-uuid",
      selections: { crop: "landscape" }
    }
  );
  assert.equal(
    compactReferenceValue({ ref: "image-uuid", selections: {} }),
    "image-uuid"
  );
  assert.equal(compactReferenceValue({ ref: "", selections: { crop: "x" } }), "");
  assert.deepEqual(normalizeReferenceValue(0), { ref: 0, selections: {} });
  assert.deepEqual(normalizeReferenceValue(false), {
    ref: false,
    selections: {}
  });
  assert.equal(compactReferenceValue({ ref: 0, selections: {} }), 0);
  assert.equal(hasReferenceValue(false), true);
});

test("normalizes, adds, and toggles ordered multiple reference values", () => {
  assert.deepEqual(
    normalizeReferenceValues([
      "first",
      "",
      "first",
      0,
      false,
      "0",
      null,
      { ref: "ignored" }
    ]),
    ["first", 0, false, "0"]
  );
  assert.deepEqual(normalizeReferenceValues("first"), []);
  assert.deepEqual(
    referenceValuesAfterAdd(["first", "first"], "second"),
    ["first", "second"]
  );
  assert.deepEqual(referenceValuesAfterAdd([0], false), [0, false]);
  assert.deepEqual(referenceValuesAfterAdd(["first"], ""), ["first"]);
  assert.deepEqual(
    referenceValuesAfterToggle(["first", "second"], "first"),
    ["second"]
  );
  assert.deepEqual(
    referenceValuesAfterToggle(["first"], "second"),
    ["first", "second"]
  );
});

test("resolves reference presentation and target-published selections", () => {
  assert.equal(referenceItemValue(item, "uuid", collection), "image-uuid");
  assert.equal(
    referenceItemValue(item, "$storage_path", collection),
    "content/images/example.yml"
  );

  const definitions = referenceSelectionDefinitions(
    { selections: ["focus", "crop", "missing"] },
    collection
  );
  // Presentation order belongs to the target collection; the field list is
  // only an opt-in set.
  assert.deepEqual(definitions.map(({ name }) => name), ["crop", "focus"]);
  assert.deepEqual(
    referenceSelectionOptions(item, definitions[0], collection).map(
      ({ value, label }) => ({ value, label })
    ),
    [{ value: "landscape", label: "Landscape" }]
  );
});

test("uses a reference image only when the target explicitly publishes one", () => {
  assert.equal(referenceImageSource(item, {}, collection), "");
  assert.equal(referenceImageSource(item, { image: "   " }, collection), "");
  assert.equal(
    referenceImageSource(item, { image: "file" }, collection),
    "/media/example.jpg"
  );
  assert.equal(
    referenceImageSource(
      { ...item, properties: { ...item.properties, file: "" } },
      { image: "file" },
      collection
    ),
    ""
  );
});

test("keeps selections for the same target and clears them for a replacement", () => {
  const current = {
    ref: "image-uuid",
    selections: { crop: "landscape", focus: "face" }
  };
  assert.deepEqual(referenceValueAfterSelection(current, "image-uuid"), current);
  assert.equal(referenceValueAfterSelection(current, "other-image"), "other-image");
  assert.equal(referenceValueAfterSelection("image-uuid", "other-image"), "other-image");
});

test("builds and immediately selects a complete referenced record", async () => {
  const targetCollection = {
    name: "images",
    folder: "content/images",
    extension: "yml",
    node_type: "media_image",
    allowed_types: ["media_image"],
    slug: "{{title}}-{{year}}-{{month}}",
    views: {
      reference: { value: "content_id", title: "title" }
    }
  };
  const nodeTypes = {
    media_image: {
      fields: {
        content_id: { widget: "id", readonly: true },
        title: { widget: "string" },
        file: { widget: "image" }
      },
      slots: { metadata: {} }
    }
  };
  const field = { widget: "reference", collection: "images" };
  const existing = {
    id: "new-image-2026-08",
    type: "media_image",
    order: 4,
    properties: {
      content_id: "abc123def456ghi",
      title: "Existing image",
      file: ""
    },
    slots: { metadata: [] }
  };
  const optionForItem = (candidate) =>
    referencePickerOption(candidate, field, targetCollection);
  const record = createReferencedRecord({
    label: " New image ",
    collection: targetCollection,
    nodeTypes,
    labelField: "title",
    items: [existing],
    date: new Date(2026, 7, 3),
    optionForItem
  });

  assert.equal(record.id, "new-image-2026-08-2");
  assert.equal(record.order, 5);
  assert.equal(record.properties.title, "New image");
  assert.match(record.properties.content_id, /^[a-z0-9]{15}$/);
  assert.notEqual(record.properties.content_id, existing.properties.content_id);
  assert.equal(record.properties.file, "");
  assert.deepEqual(record.slots, { metadata: [] });

  const writes = [];
  const created = await createOrReuseReferencedRecord({
    adapter: {
      async create(collectionName, nextRecord) {
        writes.push({ collectionName, nextRecord });
        return { item: nextRecord };
      }
    },
    label: "Second image",
    collection: targetCollection,
    nodeTypes,
    labelField: "title",
    items: [existing],
    optionForItem
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].collectionName, "images");
  assert.equal(created.option.label, "Second image");
  assert.equal(created.option.value, created.item.properties.content_id);
});

test("restricts quick creation to the allowed primary type and usable identity", async () => {
  const targetCollection = {
    name: "authors",
    node_type: "author",
    allowed_types: ["author", "organization"],
    identifier_field: "surname",
    views: { reference: { value: "external_id" } }
  };
  const nodeTypes = {
    author: {
      fields: {
        surname: { widget: "string" },
        external_id: { widget: "string" }
      }
    },
    organization: {
      fields: { title: { widget: "string" } }
    }
  };

  assert.equal(
    referenceCreationConfig(targetCollection, nodeTypes, {
      allowedTypes: ["organization"]
    }),
    null
  );
  assert.equal(
    referenceCreationConfig(targetCollection, nodeTypes, {
      allowedTypes: ["author"]
    }).fieldName,
    "surname"
  );
  assert.equal(
    referenceItemLabel(
      { id: "smith", properties: { surname: "Smith" } },
      {},
      targetCollection
    ),
    "Smith"
  );

  let createCalls = 0;
  await assert.rejects(
    createOrReuseReferencedRecord({
      adapter: {
        async create() {
          createCalls += 1;
        }
      },
      label: "Smith",
      collection: targetCollection,
      nodeTypes,
      allowedTypes: ["author"],
      items: [],
      optionForItem: (candidate) =>
        referencePickerOption(
          candidate,
          { widget: "reference", value_field: "external_id" },
          targetCollection
        )
    }),
    /usable reference value/
  );
  assert.equal(createCalls, 0);
});

test("persists every edited reference field and exposes the saved item for immediate selection", async () => {
  const targetCollection = {
    name: "sources",
    folder: "content/sources",
    extension: "yml",
    node_type: "source",
    allowed_types: ["source"],
    slug: "{{title}}-{{year}}-{{month}}",
    views: {
      reference: { value: "content_id", title: "title" }
    }
  };
  const nodeTypes = {
    source: {
      fields: {
        content_id: { widget: "id", readonly: true, required: true },
        title: { widget: "string", required: true },
        slug: { widget: "string" },
        summary: { widget: "text" },
        body: { widget: "markdown" },
        archive: { widget: "url" },
        status: {
          widget: "select",
          default: "draft",
          options: ["draft", "published"]
        },
        featured: { widget: "boolean", default: true },
        tags: { widget: "tags", collection: "tags" },
        cover: { widget: "image" }
      },
      slots: { notes: {} }
    }
  };
  const existing = {
    id: "complete-source-2026-08",
    type: "source",
    order: 3,
    properties: {
      content_id: "abc123def456ghi",
      title: "Existing source"
    },
    slots: { notes: [] }
  };
  const field = { widget: "reference", collection: "sources" };
  const optionForItem = (candidate) =>
    referencePickerOption(candidate, field, targetCollection);
  const draft = createReferencedRecordDraft({
    collection: targetCollection,
    nodeTypes,
    items: [existing]
  });
  const edited = {
    ...draft,
    properties: {
      ...draft.properties,
      content_id: "invalid",
      title: "Complete source",
      summary: "Full inspector value",
      body: "A **rich** description.",
      archive: "https://example.com/source",
      status: "published",
      featured: false,
      tags: ["tag123def456ghi"],
      cover: "/media/sources/cover.jpg"
    }
  };
  const writes = [];
  const result = await storeReferencedRecordDraft({
    adapter: {
      async create(collectionName, record) {
        writes.push({ collectionName, record });
        return {
          item: {
            ...record,
            title: record.properties.title,
            updated_at: "2026-08-03T12:00:00.000Z"
          }
        };
      }
    },
    draft: edited,
    collection: targetCollection,
    nodeTypes,
    fields: Object.entries(nodeTypes.source.fields).map(([name, definition]) => ({
      ...definition,
      name
    })),
    items: [existing],
    date: new Date(2026, 7, 3),
    optionForItem
  });

  const finalized = result.record;
  assert.equal(finalized.id, "complete-source-2026-08-2");
  assert.equal(finalized.order, 4);
  assert.match(finalized.properties.content_id, /^[a-z0-9]{15}$/);
  assert.notEqual(
    finalized.properties.content_id,
    existing.properties.content_id
  );
  assert.deepEqual(finalized.properties, {
    content_id: finalized.properties.content_id,
    title: "Complete source",
    slug: "complete-source-2026-08-2",
    summary: "Full inspector value",
    body: "A **rich** description.",
    archive: "https://example.com/source",
    status: "published",
    featured: false,
    tags: ["tag123def456ghi"],
    cover: "/media/sources/cover.jpg"
  });
  assert.deepEqual(finalized.slots, { notes: [] });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].collectionName, "sources");
  assert.deepEqual(writes[0].record.properties, finalized.properties);
  assert.equal(result.option.item.updated_at, "2026-08-03T12:00:00.000Z");
  assert.equal(result.option.value, finalized.properties.content_id);
  assert.equal(
    referenceValueAfterSelection(
      { ref: "old-source", selections: { crop: "old-crop" } },
      result.option.value
    ),
    finalized.properties.content_id
  );
});

test("re-finalizes a full reference draft after a concurrent filename conflict", async () => {
  const targetCollection = {
    name: "sources",
    folder: "content/sources",
    extension: "yml",
    node_type: "source",
    allowed_types: ["source"],
    slug: "{{title}}-{{year}}-{{month}}",
    views: { reference: { value: "content_id", title: "title" } }
  };
  const nodeTypes = {
    source: {
      fields: {
        content_id: { widget: "id", readonly: true },
        title: { widget: "string" },
        summary: { widget: "text" }
      }
    }
  };
  const field = { widget: "reference", collection: "sources" };
  const optionForItem = (candidate) =>
    referencePickerOption(candidate, field, targetCollection);
  const draft = createReferencedRecordDraft({
    collection: targetCollection,
    nodeTypes,
    items: []
  });
  const edited = {
    ...draft,
    properties: {
      ...draft.properties,
      title: "Concurrent source",
      summary: "Keep this complete form value"
    }
  };
  const writes = [];
  const concurrent = {
    ...edited,
    id: "concurrent-source-2026-08",
    properties: {
      ...edited.properties,
      content_id: edited.properties.content_id,
      title: "Concurrent source",
      summary: "Someone else's record"
    }
  };
  const adapter = {
    async create(_collectionName, record) {
      writes.push(record);
      if (writes.length === 1) {
        throw Object.assign(new Error("Conflict"), { status: 409 });
      }
      return { item: record };
    },
    async list() {
      return { items: [concurrent] };
    }
  };

  const result = await storeReferencedRecordDraft({
    adapter,
    draft: edited,
    collection: targetCollection,
    nodeTypes,
    fields: Object.entries(nodeTypes.source.fields).map(([name, definition]) => ({
      ...definition,
      name
    })),
    items: [],
    date: new Date(2026, 7, 3),
    optionForItem
  });

  assert.equal(writes.length, 2);
  assert.equal(writes[0].id, "concurrent-source-2026-08");
  assert.equal(writes[1].id, "concurrent-source-2026-08-2");
  assert.equal(
    writes[1].properties.summary,
    "Keep this complete form value"
  );
  assert.notEqual(
    writes[1].properties.content_id,
    writes[0].properties.content_id
  );
  assert.match(writes[1].properties.content_id, /^[a-z0-9]{15}$/);
  assert.equal(result.created, true);
  assert.equal(result.item.id, "concurrent-source-2026-08-2");
  assert.equal(result.option.value, writes[1].properties.content_id);
});

test("rejects a reference draft with no usable stored value before writing", async () => {
  const targetCollection = {
    name: "authors",
    folder: "content/authors",
    extension: "yml",
    node_type: "author",
    allowed_types: ["author"],
    slug: "{{name}}",
    identifier_field: "name",
    views: { reference: { value: "external_id", title: "name" } }
  };
  const nodeTypes = {
    author: {
      fields: {
        name: { widget: "string" },
        external_id: { widget: "string" }
      }
    }
  };
  const draft = createReferencedRecordDraft({
    collection: targetCollection,
    nodeTypes,
    items: []
  });
  const record = {
    ...draft,
    properties: { ...draft.properties, name: "Ada", external_id: "" }
  };
  let writes = 0;

  await assert.rejects(
    storeReferencedRecordDraft({
      adapter: {
        async create() {
          writes += 1;
        }
      },
      draft: record,
      collection: targetCollection,
      nodeTypes,
      fields: Object.entries(nodeTypes.author.fields).map(([name, definition]) => ({
        ...definition,
        name
      })),
      items: [],
      optionForItem: (candidate) =>
        referencePickerOption(
          candidate,
          {
            widget: "reference",
            collection: "authors",
            value_field: "external_id"
          },
          targetCollection
        )
    }),
    /usable reference value/
  );
  assert.equal(writes, 0);
});

test("allows a full-record draft when quick creation has no writable title field", () => {
  const targetCollection = {
    name: "codes",
    node_type: "code",
    allowed_types: ["code", "other"],
    hierarchy: { parent_field: "parent_id" },
    views: { reference: { value: "content_id" } }
  };
  const nodeTypes = {
    code: {
      fields: {
        content_id: { widget: "id", readonly: true },
        parent_id: { widget: "string", default: "old-parent" },
        enabled: { widget: "boolean", default: false },
        count: { widget: "number", default: 0 },
        tags: { widget: "tags", collection: "tags" }
      },
      slots: { children: {}, notes: {} }
    },
    other: { fields: { title: { widget: "string" } } }
  };
  const existing = {
    id: "existing-code",
    type: "code",
    order: 7,
    properties: { content_id: "abc123def456ghi" },
    slots: { children: [], notes: [] }
  };

  assert.equal(
    referenceCreationConfig(targetCollection, nodeTypes),
    null
  );
  assert.equal(
    referenceRecordCreationConfig(targetCollection, nodeTypes).typeName,
    "code"
  );
  assert.equal(
    referenceRecordCreationConfig(targetCollection, nodeTypes, {
      allowedTypes: ["other"]
    }),
    null
  );

  const draft = createReferencedRecordDraft({
    collection: targetCollection,
    nodeTypes,
    items: [existing]
  });
  assert.equal(draft.id, "");
  assert.equal(draft.type, "code");
  assert.equal(draft.order, 8);
  assert.equal(draft.properties.parent_id, null);
  assert.equal(draft.properties.enabled, false);
  assert.equal(draft.properties.count, 0);
  assert.deepEqual(draft.properties.tags, []);
  assert.match(draft.properties.content_id, /^[a-z0-9]{15}$/);
  assert.notEqual(draft.properties.content_id, "abc123def456ghi");
  assert.deepEqual(draft.slots, { children: [], notes: [] });
});

test("validates only supplied visible required fields with widget-aware emptiness", () => {
  const fields = [
    { name: "enabled", label: "Enabled", widget: "boolean", required: true },
    { name: "count", label: "Count", widget: "number", required: true },
    { name: "tags", label: "Tags", widget: "tags", required: true },
    {
      name: "related",
      label: "Related item",
      widget: "reference",
      required: true
    },
    {
      name: "contributors",
      label: "Contributors",
      widget: "reference",
      multiple: true,
      required: true
    },
    { name: "image", label: "Image", widget: "image", required: true },
    { name: "file", label: "File", widget: "file", required: true }
  ];
  const draft = {
    properties: {
      enabled: false,
      count: 0,
      tags: [],
      related: { ref: "", selections: { crop: "ignored" } },
      contributors: [],
      image: { src: "", regions: [{ id: "abcdefghijklmno" }] },
      file: "",
      hidden_required: ""
    }
  };

  assert.deepEqual(validateReferencedRecordDraft({ draft, fields }), {
    valid: false,
    errors: {
      tags: "Tags is required.",
      related: "Related item is required.",
      contributors: "Contributors is required.",
      image: "Image is required.",
      file: "File is required."
    }
  });

  const completeDraft = {
    ...draft,
    properties: {
      ...draft.properties,
      tags: ["abc123def456ghi"],
      related: false,
      contributors: [false],
      image: { src: "/media/image.jpg" },
      file: { path: "/media/document.pdf" }
    }
  };
  assert.deepEqual(
    validateReferencedRecordDraft({ draft: completeDraft, fields }),
    { valid: true, errors: {} }
  );
});

test("synthesizes an undeclared title only for a title-based slug", async () => {
  const targetCollection = {
    name: "authors",
    node_type: "author",
    allowed_types: ["author"],
    identifier_field: "surname",
    slug: "{{title}}-{{year}}-{{month}}",
    views: { reference: { title: "surname" } }
  };
  const nodeTypes = {
    author: {
      fields: {
        surname: { widget: "string", required: true },
        name: { widget: "string" }
      }
    }
  };
  const draft = createReferencedRecordDraft({
    collection: targetCollection,
    nodeTypes
  });
  draft.properties.surname = "Lovelace";
  draft.properties.name = "Ada";
  const writes = [];
  const result = await storeReferencedRecordDraft({
    adapter: {
      async create(_collectionName, record) {
        writes.push(record);
        return { item: record };
      }
    },
    draft,
    collection: targetCollection,
    nodeTypes,
    fields: [
      { name: "surname", widget: "string", required: true },
      { name: "name", widget: "string" }
    ],
    items: [{ id: "lovelace-2026-08", order: 2 }],
    date: new Date(2026, 7, 3),
    optionForItem: (candidate) =>
      referencePickerOption(
        candidate,
        { widget: "reference", collection: "authors" },
        targetCollection
      )
  });

  assert.equal(writes[0].id, "lovelace-2026-08-2");
  assert.equal(writes[0].properties.title, "Lovelace");
  assert.equal(writes[0].properties.surname, "Lovelace");
  assert.equal(writes[0].properties.name, "Ada");
  assert.equal(result.option.value, "lovelace-2026-08-2");
  assert.equal(result.items.length, 2);
});
