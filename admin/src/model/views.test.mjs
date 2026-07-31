import assert from "node:assert/strict";
import test from "node:test";
import { groupsForPanel, panelsFor } from "./views.js";

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
