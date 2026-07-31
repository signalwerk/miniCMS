import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultFieldValue,
  isSaveShortcut,
  referenceItemsForField
} from "./editor.js";

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
