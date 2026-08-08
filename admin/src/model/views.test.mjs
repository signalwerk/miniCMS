import assert from "node:assert/strict";
import test from "node:test";
import {
  displayValue,
  fieldIsVisible,
  groupsForPanel,
  panelsFor
} from "./views.js";

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
