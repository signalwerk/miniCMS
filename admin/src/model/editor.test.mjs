import assert from "node:assert/strict";
import test from "node:test";
import { defaultFieldValue, referenceItemsForField } from "./editor.js";

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
