import assert from "node:assert/strict";
import test from "node:test";
import { ID_PATTERN, createId } from "../../../core/id.js";
import {
  ICON_NAMES,
  cloneContentNode,
  collectNodeIds,
  defaultFieldValue,
  isInspectorFocusShortcut,
  isSaveShortcut,
  newNode,
  referenceItemsForField,
  refreshGeneratedIdFields,
  selectionIdForRecord,
  selectionRouteFromHash,
  selectionRouteForState,
  selectionRouteHash
} from "./editor.js";

test("generates collision-resistant 15-character lowercase alphanumeric IDs", () => {
  const ids = new Set();
  for (let index = 0; index < 1_000; index += 1) {
    const id = createId(ids);
    assert.match(id, ID_PATTERN);
  }
  assert.equal(ids.size, 1_000);
});

test("uses the generated ID contract for fields, inserted nodes, and copies", () => {
  assert.match(defaultFieldValue({ widget: "id" }, true), ID_PATTERN);
  assert.match(defaultFieldValue({ widget: "uuid" }, true), ID_PATTERN);

  const usedIds = new Set(["existing"]);
  const inserted = newNode("text", { fields: {} }, usedIds);
  assert.match(inserted.id, ID_PATTERN);
  assert.equal(usedIds.has(inserted.id), true);

  const source = {
    id: "source",
    type: "grid",
    slots: {
      content: [{ id: "child", type: "text", slots: {} }]
    }
  };
  const sourceIds = collectNodeIds(source);
  const copied = cloneContentNode(source, sourceIds);
  assert.match(copied.id, ID_PATTERN);
  assert.match(copied.slots.content[0].id, ID_PATTERN);
  assert.notEqual(copied.id, copied.slots.content[0].id);
  assert.notEqual(copied.id, source.id);
  assert.notEqual(copied.slots.content[0].id, source.slots.content[0].id);
});

test("regenerates field and annotation IDs across a copied subtree", () => {
  const node = {
    id: "storage-key",
    type: "media_image",
    properties: {
      content_id: "cff576784113260",
      file: {
        src: "/media/example.jpg",
        regions: [{ id: "3887a356428e7f4" }],
        points: [{ id: "adbd1e73b1c54cc" }]
      }
    },
    slots: {}
  };
  refreshGeneratedIdFields(node, {
    media_image: {
      fields: {
        content_id: { widget: "id" },
        file: { widget: "image" }
      }
    }
  });

  assert.match(node.properties.content_id, ID_PATTERN);
  assert.match(node.properties.file.regions[0].id, ID_PATTERN);
  assert.match(node.properties.file.points[0].id, ID_PATTERN);
  assert.notEqual(node.properties.content_id, "cff576784113260");
  assert.notEqual(node.properties.file.regions[0].id, "3887a356428e7f4");
  assert.notEqual(node.properties.file.points[0].id, "adbd1e73b1c54cc");
});

test("includes the file symlink icon in configurable icon choices", () => {
  assert.equal(ICON_NAMES.includes("file-symlink"), true);
});

test("keeps optional selects empty until an option is chosen", () => {
  const options = [
    { label: "Column 1", value: "1" },
    { label: "Column 2", value: "2" }
  ];

  assert.equal(
    defaultFieldValue({ widget: "select", required: false, options }),
    ""
  );
  assert.equal(
    defaultFieldValue({ widget: "select", required: true, options }),
    "1"
  );
  assert.equal(
    defaultFieldValue({
      widget: "select",
      required: false,
      default: "2",
      options
    }),
    "2"
  );
});

test("filters reference choices by configured record types", () => {
  const items = [
    { id: "home", type: "page" },
    { id: "news", type: "shortcut" }
  ];

  assert.deepEqual(referenceItemsForField(items, {}), items);
  assert.deepEqual(
    referenceItemsForField(items, { allowed_types: ["page"] }),
    [{ id: "home", type: "page" }]
  );
});

test("recognizes the platform save shortcuts without stealing Save As", () => {
  assert.equal(isSaveShortcut({ key: "s", metaKey: true }), true);
  assert.equal(isSaveShortcut({ key: "S", ctrlKey: true }), true);
  assert.equal(
    isSaveShortcut({ key: "s", metaKey: true, shiftKey: true }),
    false
  );
  assert.equal(isSaveShortcut({ key: "s" }), false);
});

test("recognizes only the full Inspector focus shortcut", () => {
  const shortcut = {
    key: "f",
    metaKey: true,
    ctrlKey: true,
    altKey: true,
    shiftKey: true
  };
  assert.equal(isInspectorFocusShortcut(shortcut), true);
  assert.equal(isInspectorFocusShortcut({ ...shortcut, key: "F" }), true);
  assert.equal(
    isInspectorFocusShortcut({ ...shortcut, key: "ƒ", code: "KeyF" }),
    true
  );
  for (const modifier of ["metaKey", "ctrlKey", "altKey", "shiftKey"]) {
    assert.equal(
      isInspectorFocusShortcut({ ...shortcut, [modifier]: false }),
      false
    );
  }
  assert.equal(isInspectorFocusShortcut({ ...shortcut, key: "g" }), false);
});

const routeConfig = {
  collections: {
    pages: {},
    "press releases": {},
    "résumé / notes": {}
  }
};

test("reads legacy collection-only and deep selection hashes", () => {
  assert.deepEqual(selectionRouteFromHash(routeConfig, "#pages"), {
    collectionName: "pages",
    recordId: null,
    contentId: null
  });
  assert.deepEqual(
    selectionRouteFromHash(
      routeConfig,
      "#press%20releases/release%2F2026/hero%20copy"
    ),
    {
      collectionName: "press releases",
      recordId: "release/2026",
      contentId: "hero copy"
    }
  );
});

test("writes compact encoded selection hashes", () => {
  assert.equal(
    selectionRouteHash({ collectionName: "pages" }),
    "#pages"
  );
  assert.equal(
    selectionRouteHash({
      collectionName: "press releases",
      recordId: "release/2026",
      contentId: "hero copy"
    }),
    "#press%20releases/release%2F2026/hero%20copy"
  );
  assert.equal(
    selectionRouteHash({
      collectionName: "pages",
      contentId: "orphan"
    }),
    "#pages"
  );
});

test("derives a compact route from the active editor selection", () => {
  assert.deepEqual(
    selectionRouteForState("pages", null, null, "collection"),
    {
      collectionName: "pages",
      recordId: null,
      contentId: null
    }
  );
  assert.deepEqual(
    selectionRouteForState("pages", "home", "hero", "collection"),
    {
      collectionName: "pages",
      recordId: "home",
      contentId: null
    }
  );
  assert.deepEqual(
    selectionRouteForState("pages", "home", "home", "content"),
    {
      collectionName: "pages",
      recordId: "home",
      contentId: "home"
    }
  );
  assert.deepEqual(
    selectionRouteForState("pages", "home", "hero", "content"),
    {
      collectionName: "pages",
      recordId: "home",
      contentId: "hero"
    }
  );
});

test("restores a valid content selection and falls back to its document", () => {
  const record = {
    id: "home",
    slots: {
      content: [
        {
          id: "hero",
          slots: {
            content: [{ id: "heading", slots: {} }]
          }
        }
      ]
    }
  };

  assert.equal(selectionIdForRecord(record, "heading"), "heading");
  assert.equal(selectionIdForRecord(record, "home"), "home");
  assert.equal(selectionIdForRecord(record, "missing"), "home");
  assert.equal(selectionIdForRecord(record, null), "home");
  assert.equal(selectionIdForRecord(null, "heading"), "");
});

test("round-trips reserved characters without double decoding", () => {
  const selection = {
    collectionName: "résumé / notes",
    recordId: "record/?#&=+ %",
    contentId: "node/日本語?#%"
  };
  assert.deepEqual(
    selectionRouteFromHash(routeConfig, selectionRouteHash(selection)),
    selection
  );
});

test("rejects unknown hashes and retains valid malformed parent levels", () => {
  assert.equal(selectionRouteFromHash(routeConfig, ""), null);
  assert.equal(selectionRouteFromHash(routeConfig, "#missing/home"), null);
  assert.deepEqual(selectionRouteFromHash(routeConfig, "#pages//hero"), {
    collectionName: "pages",
    recordId: null,
    contentId: null
  });
  assert.deepEqual(
    selectionRouteFromHash(routeConfig, "#pages/home/hero/extra"),
    { collectionName: "pages", recordId: "home", contentId: null }
  );
  assert.deepEqual(
    selectionRouteFromHash(routeConfig, "#pages/%E0%A4%A"),
    { collectionName: "pages", recordId: null, contentId: null }
  );
  assert.deepEqual(
    selectionRouteFromHash(routeConfig, "#pages/home/%E0%A4%A"),
    { collectionName: "pages", recordId: "home", contentId: null }
  );
});
