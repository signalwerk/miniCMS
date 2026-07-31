import assert from "node:assert/strict";
import test from "node:test";
import { fieldIsVisible, groupsForPanel, panelsFor } from "./views.js";

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
