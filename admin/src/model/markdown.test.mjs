import assert from "node:assert/strict";
import test from "node:test";
import { markdownToHTML } from "@blocknote/core";
import { buildInlineLinkUrl } from "../../../core/inline-link.js";
import { buildInlineReferenceUrl } from "../../../core/inline-reference.js";
import {
  configuredInlineLinkCollectionNames,
  configuredInlineLinkCollections,
  createInlineReferenceRecord,
  createOrReuseInlineReference,
  escapeInlineReferenceLabelText,
  filteredInlineLinkOptions,
  inlineReferenceCreationConfig,
  inlineLinkOption,
  inlineLinkOptions,
  inlineReferenceOption,
  inlineReferenceOptions,
  markdownSafeInlineReferences,
  matchingInlineReference
} from "./markdown.js";

const collection = {
  name: "sources",
  extension: "yml",
  views: {
    reference: {
      value: "content_id",
      title: "title"
    }
  }
};

test("builds inline reference choices with a configured preview field", () => {
  const item = {
    id: "source-file",
    title: "Collection title",
    properties: {
      content_id: "abc123def456ghi",
      title: "Research source",
      citation: "Beowolf et al. (2026)",
      structured: { label: "Never stringify this" }
    }
  };

  assert.deepEqual(
    inlineReferenceOption(item, collection, "citation"),
    {
      item,
      label: "Beowolf et al. (2026)",
      recordId: "source-file",
      searchText:
        "beowolf et al. (2026) source-file collection title abc123def456ghi research source beowolf et al. (2026)",
      value: "abc123def456ghi"
    }
  );
});

test("falls back to collection titles and drops unusable identities", () => {
  const valid = {
    id: "source-file",
    title: "Summary title",
    properties: {
      content_id: "abc123def456ghi",
      title: "Research source",
      structured: { label: "Not text" }
    }
  };
  const numericIdentity = {
    id: "numeric-source",
    properties: { content_id: 42, title: "Numeric source" }
  };

  assert.equal(
    inlineReferenceOption(valid, collection, "structured").label,
    "Research source"
  );
  assert.deepEqual(
    inlineReferenceOptions([valid, numericIdentity], collection),
    [inlineReferenceOption(valid, collection)]
  );
});

test("keeps configured internal-link collections in their declared order", () => {
  const pages = { name: "pages", label: "Pages" };
  const articles = { name: "articles", label: "Articles" };
  const collections = [articles, pages, { name: "files", label: "Files" }];

  assert.deepEqual(
    configuredInlineLinkCollections(
      {
        internal_links: {
          collections: ["pages", "missing", "articles", "pages"]
        }
      },
      collections
    ),
    [pages, articles]
  );
  assert.deepEqual(configuredInlineLinkCollections({}, collections), []);
  assert.deepEqual(
    configuredInlineLinkCollectionNames({
      internal_links: {
        collections: ["pages", "pages", "", null, "articles"]
      }
    }),
    ["pages", "articles"]
  );
});

test("builds searchable internal-link options from published identities", () => {
  const pages = {
    name: "pages",
    views: {
      reference: {
        value: "content_id",
        title: "title"
      }
    }
  };
  const home = {
    id: "home",
    type: "page",
    properties: {
      content_id: "page123def456gh",
      title: "Research home",
      slug: "welcome",
      visible: true,
      structured: { hidden: true }
    }
  };
  const invalid = {
    id: "numeric",
    properties: { content_id: 123, title: "Numeric identity" }
  };

  assert.deepEqual(inlineLinkOption(home, pages), {
    item: home,
    label: "Research home",
    recordId: "home",
    searchText:
      "research home home page page123def456gh research home welcome true",
    value: "page123def456gh"
  });
  assert.deepEqual(inlineLinkOptions([home, invalid], pages), [
    inlineLinkOption(home, pages)
  ]);
});

test("searches every internal-link option before bounding rendered results", () => {
  const options = Array.from({ length: 150 }, (_, index) => ({
    label: `Page ${index}`,
    searchText: `page ${index} ${index === 149 ? "deep match" : ""}`
  }));

  const initial = filteredInlineLinkOptions(options, "");
  assert.equal(initial.items.length, 100);
  assert.equal(initial.total, 150);
  assert.equal(initial.limited, true);

  assert.deepEqual(filteredInlineLinkOptions(options, "deep match"), {
    items: [options[149]],
    limited: false,
    total: 1
  });
  assert.equal(filteredInlineLinkOptions(options, "page", 25).items.length, 25);
  assert.equal(filteredInlineLinkOptions(options, "missing").total, 0);
});

test("builds a complete reference record from the configured preview field", () => {
  const sourceCollection = {
    ...collection,
    node_type: "source",
    allowed_types: ["source"],
    slug: "{{title}}-{{year}}-{{month}}"
  };
  const nodeTypes = {
    source: {
      fields: {
        content_id: { widget: "id", readonly: true },
        title: { widget: "string" },
        notes: { widget: "markdown" }
      },
      slots: { attachments: {} }
    }
  };
  const items = [{
    id: "new-source-2026-08",
    order: 3,
    properties: {
      content_id: "abc123def456ghi",
      title: "Existing source"
    }
  }];

  const record = createInlineReferenceRecord({
    label: "  New source  ",
    collection: sourceCollection,
    nodeTypes,
    previewField: "title",
    items,
    date: new Date(2026, 7, 3)
  });

  assert.equal(record.id, "new-source-2026-08-2");
  assert.equal(record.type, "source");
  assert.equal(record.order, 4);
  assert.equal(record.properties.title, "New source");
  assert.match(record.properties.content_id, /^[a-z0-9]{15}$/);
  assert.notEqual(record.properties.content_id, "abc123def456ghi");
  assert.equal(record.properties.notes, "");
  assert.deepEqual(record.slots, { attachments: [] });
  assert.equal(
    inlineReferenceOption(record, sourceCollection, "title").label,
    "New source"
  );
});

test("creates or reuses a matching inline reference through the adapter", async () => {
  const sourceCollection = {
    ...collection,
    node_type: "source",
    slug: "{{title}}"
  };
  const nodeTypes = {
    source: {
      fields: {
        content_id: { widget: "id", readonly: true },
        title: { widget: "string" }
      }
    }
  };
  const createdRecords = [];
  const adapter = {
    async create(collectionName, record) {
      assert.equal(collectionName, "sources");
      createdRecords.push(record);
      return { item: record };
    }
  };

  const created = await createOrReuseInlineReference({
    adapter,
    label: "Research Source",
    collection: sourceCollection,
    nodeTypes,
    previewField: "title"
  });
  assert.equal(created.created, true);
  assert.equal(createdRecords.length, 1);
  assert.equal(created.option.label, "Research Source");
  assert.equal(created.items.length, 1);

  const reused = await createOrReuseInlineReference({
    adapter,
    label: " research source ",
    collection: sourceCollection,
    nodeTypes,
    previewField: "title",
    items: created.items
  });
  assert.equal(reused.created, false);
  assert.equal(reused.item.id, created.item.id);
  assert.equal(createdRecords.length, 1);
  assert.equal(
    matchingInlineReference(
      created.items,
      sourceCollection,
      "title",
      "RESEARCH SOURCE"
    ).value,
    created.option.value
  );
});

test("refreshes once after a concurrent reference filename conflict", async () => {
  const sourceCollection = {
    ...collection,
    node_type: "source",
    slug: "{{title}}"
  };
  const nodeTypes = {
    source: {
      fields: {
        content_id: { widget: "id", readonly: true },
        title: { widget: "string" }
      }
    }
  };
  const concurrent = {
    id: "new-source",
    type: "source",
    order: 0,
    properties: {
      content_id: "concurrent12345",
      title: "New source"
    },
    slots: {}
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

  const result = await createOrReuseInlineReference({
    adapter,
    label: "new source",
    collection: sourceCollection,
    nodeTypes,
    previewField: "title"
  });

  assert.equal(result.created, false);
  assert.equal(result.item, concurrent);
  assert.equal(createCalls, 1);
});

test("offers quick creation only for an allowed default type with a text field", () => {
  const sourceCollection = {
    ...collection,
    node_type: "source",
    allowed_types: ["source"]
  };
  assert.equal(
    inlineReferenceCreationConfig(
      sourceCollection,
      { source: { fields: { title: { widget: "string" } } } },
      "title"
    ).fieldName,
    "title"
  );
  assert.equal(
    inlineReferenceCreationConfig(
      { ...sourceCollection, allowed_types: ["other"] },
      { source: { fields: { title: { widget: "string" } } } },
      "title"
    ),
    null
  );
  assert.equal(
    inlineReferenceCreationConfig(
      sourceCollection,
      { source: { fields: { title: { widget: "number" } } } },
      "title"
    ),
    null
  );
});

test("escapes reference labels without changing their imported visual text", async () => {
  const href = buildInlineReferenceUrl("sources", "abc123def456ghi");
  const label = String.raw`Research [draft] \ appendix ]`;
  const escaped = escapeInlineReferenceLabelText(label);
  assert.equal(
    escaped,
    String.raw`Research \[draft\] \\ appendix \]`
  );
  assert.equal(
    await markdownToHTML(`[${escaped}](${href})`),
    `<p><a href="${href}">${label}</a></p>`
  );

  const blocks = [{
    type: "paragraph",
    content: [{
      type: "link",
      href,
      content: [
        { type: "text", text: label, styles: {} },
        { type: "text", text: "[code]", styles: { code: true } }
      ]
    }],
    children: []
  }];
  const safeBlocks = markdownSafeInlineReferences(blocks);
  assert.equal(safeBlocks[0].content[0].content[0].text, escaped);
  assert.equal(safeBlocks[0].content[0].content[1].text, "[code]");
  assert.equal(blocks[0].content[0].content[0].text, label);
});

test("escapes content-link labels without changing their imported visual text", async () => {
  const href = buildInlineLinkUrl("pages", "page123def456gh");
  const label = String.raw`Read [the page] \ now`;
  const escaped = escapeInlineReferenceLabelText(label);
  assert.equal(
    await markdownToHTML(`[${escaped}](${href})`),
    `<p><a href="${href}">${label}</a></p>`
  );

  const blocks = [{
    type: "paragraph",
    content: [{
      type: "link",
      href,
      content: [{ type: "text", text: label, styles: {} }]
    }],
    children: []
  }];
  const safeBlocks = markdownSafeInlineReferences(blocks);
  assert.equal(safeBlocks[0].content[0].content[0].text, escaped);
  assert.equal(blocks[0].content[0].content[0].text, label);
});
