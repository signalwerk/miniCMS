import assert from "node:assert/strict";
import test from "node:test";
import { focusPropsForNode } from "./preview.js";

test("focus returns all authoring props and reports its boundary", () => {
  const selected = [];
  const boundaries = [];
  const props = focusPropsForNode("hero", {
      selectedId: "hero",
      onSelectNode: (id) => selected.push(id),
      onBoundary: (id, element) => boundaries.push([id, element])
    });

  assert.equal(props["data-minicms-node-id"], "hero");
  assert.equal(props["data-minicms-selected"], "true");
  assert.equal(props["aria-pressed"], true);
  const element = {};
  props.ref(element);
  props.ref(null);
  assert.deepEqual(boundaries, [["hero", element], ["hero", null]]);

  let prevented = false;
  let stopped = false;
  props.onClick({
    target: { closest: () => ({}) },
    currentTarget: { focus() {} },
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; }
  });
  assert.deepEqual(selected, ["hero"]);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test("focus supports keyboard activation without nested key handling", () => {
  const selected = [];
  const props = focusPropsForNode("copy", {
    selectedId: "other",
    onSelectNode: (id) => selected.push(id)
  });
  const boundary = {};
  props.onKeyDown({
    key: "Enter",
    repeat: false,
    target: boundary,
    currentTarget: boundary,
    preventDefault() {},
    stopPropagation() {}
  });
  props.onKeyDown({
    key: " ",
    repeat: false,
    target: {},
    currentTarget: boundary,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.deepEqual(selected, ["copy"]);
  assert.equal(props["data-minicms-selected"], undefined);
});
