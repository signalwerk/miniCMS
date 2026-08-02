import test from "node:test";
import assert from "node:assert/strict";
import {
  compactReferenceValue,
  hasReferenceValue,
  normalizeReferenceValue,
  referenceItemValue,
  referenceSelectionDefinitions,
  referenceSelectionOptions
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
