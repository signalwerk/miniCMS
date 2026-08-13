import assert from "node:assert/strict";
import test from "node:test";
import {
  displayValue,
  externalHttpUrl,
  fieldIsVisible,
  groupsForPanel,
  panelsFor,
  relationValueKey,
  tableRelationOptions
} from "./views.js";

test("normalizes only absolute HTTP(S) values for external URL actions", () => {
  assert.equal(
    externalHttpUrl("https://example.com/path?q=one#section"),
    "https://example.com/path?q=one#section"
  );
  assert.equal(
    externalHttpUrl("http://localhost:4321"),
    "http://localhost:4321/"
  );
  assert.equal(
    externalHttpUrl({ url: "https://example.com/resolved", link: null }),
    "https://example.com/resolved"
  );

  for (const value of [
    "",
    null,
    undefined,
    "/relative",
    "mailto:editor@example.com",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "not a URL"
  ]) {
    assert.equal(externalHttpUrl(value), null);
  }
});

const type = {
  fields: {
    title: { label: "Title", widget: "string" },
    description: { label: "Description", widget: "text" }
  },
  views: {
    detail: {
      panels: {
        inspector: {
          position: 999,
          groups: {
            content: {
              position: 999,
              fields: ["title"]
            },
            metadata: {
              position: -1,
              fields: ["description"]
            }
          }
        },
        settings: {
          position: -1,
          groups: {}
        },
        info: {
          position: -2,
          groups: {}
        }
      }
    }
  }
};

test("uses YAML mapping order for detail panels and groups", () => {
  assert.deepEqual(
    panelsFor(type, true).map((panel) => panel.name),
    ["inspector", "settings", "info"]
  );
  assert.deepEqual(
    groupsForPanel(type, "inspector", true).map((group) => group.name),
    ["content", "metadata"]
  );
});

test("filters inspector fields using the current record properties", () => {
  const conditionalType = {
    fields: {
      mode: {
        label: "Mode",
        widget: "select",
        options: ["first_child", "selected_target"]
      },
      target: {
        label: "Target",
        widget: "reference",
        visible_when: { field: "mode", equals: "selected_target" }
      }
    },
    views: {
      detail: {
        panels: {
          inspector: {
            groups: {
              target: { fields: ["mode", "target"] }
            }
          }
        }
      }
    }
  };

  assert.equal(
    fieldIsVisible(conditionalType.fields.target, { mode: "first_child" }),
    false
  );
  assert.deepEqual(
    groupsForPanel(conditionalType, "inspector", false, {
      mode: "first_child"
    })[0].fields.map((field) => field.name),
    ["mode"]
  );
  assert.deepEqual(
    groupsForPanel(conditionalType, "inspector", false, {
      mode: "selected_target"
    })[0].fields.map((field) => field.name),
    ["mode", "target"]
  );
});

test("provides implicit Inspector and document Info panels", () => {
  const implicitType = {
    fields: {
      title: { label: "Title", widget: "string" }
    }
  };

  assert.deepEqual(
    panelsFor(implicitType, false).map(({ name, label }) => ({ name, label })),
    [{ name: "inspector", label: "Inspector" }]
  );
  assert.deepEqual(
    panelsFor(implicitType, true).map(({ name, label }) => ({ name, label })),
    [
      { name: "inspector", label: "Inspector" },
      { name: "info", label: "Info" }
    ]
  );
  assert.deepEqual(
    groupsForPanel(implicitType, "inspector", false).map((group) =>
      group.fields.map((field) => field.name)
    ),
    [["title"]]
  );
});

test("ignores retired Inspector group focus configuration", () => {
  const legacyType = structuredClone(type);
  legacyType.views.detail.panels.inspector.groups.content.focus = true;

  const [contentGroup] = groupsForPanel(legacyType, "inspector", false);
  assert.equal(Object.hasOwn(contentGroup, "focus"), false);
});

test("displays structured reference values by their target reference", () => {
  assert.equal(
    displayValue(
      {
        ref: "image-uuid",
        selections: { crop: "landscape" }
      },
      { widget: "reference" }
    ),
    "image-uuid"
  );
  assert.equal(displayValue(0, { widget: "reference" }), "0");
  assert.equal(displayValue(false, { widget: "reference" }), "false");
});

test("displays multiple references in their stored order", () => {
  const field = { widget: "reference", multiple: true };
  assert.equal(
    displayValue(["second", "first", "second"], field),
    "second, first"
  );
  assert.equal(displayValue([], field), "—");
  assert.equal(displayValue("first", field), "—");
});

test("displays tag ID arrays without coercing them to editor strings", () => {
  assert.equal(
    displayValue(["aaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbb"], { widget: "tags" }),
    "aaaaaaaaaaaaaaa, bbbbbbbbbbbbbbb"
  );
  assert.equal(displayValue([], { widget: "tags" }), "—");
});

test("keeps scalar values readable when a non-image widget uses image display", () => {
  assert.equal(
    displayValue("/media/previews/card.png", {
      widget: "file",
      display: "image"
    }),
    "/media/previews/card.png"
  );
});

test("builds typed table relation options from configured target titles", () => {
  const targetCollection = {
    identifier_field: "name",
    views: {
      reference: { value: "content_id", title: "display_name" }
    }
  };
  const field = {
    widget: "reference",
    collection: "people",
    value_field: "external_code"
  };
  const options = tableRelationOptions(field, targetCollection, [
    {
      id: "ada",
      type: "person",
      properties: {
        content_id: "aaaaaaaaaaaaaaa",
        external_code: 0,
        display_name: "Ada Lovelace"
      }
    },
    {
      id: "string-zero",
      type: "person",
      properties: {
        content_id: "bbbbbbbbbbbbbbb",
        external_code: "0",
        display_name: "String Zero"
      }
    }
  ]);

  assert.equal(options.get(relationValueKey(0)).label, "Ada Lovelace");
  assert.equal(options.get(relationValueKey("0")).label, "String Zero");
  assert.equal(options.has(relationValueKey("aaaaaaaaaaaaaaa")), false);
});

test("uses the configured tag label instead of its generated ID", () => {
  const options = tableRelationOptions(
    { widget: "tags", collection: "tags" },
    {
      views: {
        reference: { value: "content_id", title: "name" }
      }
    },
    [
      {
        id: "research",
        type: "tag",
        properties: {
          content_id: "aaaaaaaaaaaaaaa",
          name: "Research"
        }
      }
    ]
  );

  assert.equal(
    options.get(relationValueKey("aaaaaaaaaaaaaaa")).label,
    "Research"
  );
});

test("displays configured labels for table references and tags", () => {
  const referenceOptions = new Map([
    [
      relationValueKey("author-a"),
      { value: "author-a", label: "Ada Lovelace" }
    ],
    [
      relationValueKey("author-b"),
      { value: "author-b", label: "Grace Hopper" }
    ]
  ]);
  const tagOptions = new Map([
    [
      relationValueKey("aaaaaaaaaaaaaaa"),
      { value: "aaaaaaaaaaaaaaa", label: "Research" }
    ],
    [
      relationValueKey("bbbbbbbbbbbbbbb"),
      { value: "bbbbbbbbbbbbbbb", label: "Typography" }
    ]
  ]);
  const readyReferences = { options: referenceOptions, loading: false };
  const readyTags = { options: tagOptions, loading: false };

  assert.equal(
    displayValue("author-a", { widget: "reference" }, readyReferences),
    "Ada Lovelace"
  );
  assert.equal(
    displayValue(
      { ref: "author-b", selections: { crop: "portrait" } },
      { widget: "reference" },
      readyReferences
    ),
    "Grace Hopper"
  );
  assert.equal(
    displayValue(
      ["author-b", "author-a", "author-b"],
      { widget: "reference", multiple: true },
      readyReferences
    ),
    "Grace Hopper, Ada Lovelace"
  );
  assert.equal(
    displayValue(
      ["bbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaa"],
      { widget: "tags" },
      readyTags
    ),
    "Typography, Research"
  );
});

test("never exposes relation IDs while table labels load or are missing", () => {
  const referenceField = { widget: "reference" };
  const tagField = { widget: "tags" };
  const loading = { options: new Map(), loading: true };
  const ready = { options: new Map(), loading: false };

  assert.equal(displayValue("private-id", referenceField, loading), "…");
  assert.equal(
    displayValue("private-id", referenceField, ready),
    "Missing reference"
  );
  assert.equal(
    displayValue(["aaaaaaaaaaaaaaa"], tagField, loading),
    "…"
  );
  assert.equal(
    displayValue(["aaaaaaaaaaaaaaa"], tagField, ready),
    "Missing tag"
  );
  assert.equal(displayValue("", referenceField, ready), "—");
  assert.equal(displayValue([], tagField, ready), "—");
});
