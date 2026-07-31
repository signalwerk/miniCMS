import assert from "node:assert/strict";
import test from "node:test";
import {
  compactImageValue,
  imageSource,
  normalizeImageValue
} from "./image.js";

test("keeps unannotated image values as path strings", () => {
  const path = "/media/example.jpg";
  assert.deepEqual(normalizeImageValue(path), {
    src: path,
    regions: [],
    points: [],
    extra: {}
  });
  assert.equal(compactImageValue(normalizeImageValue(path)), path);
  assert.equal(imageSource(path), path);
});

test("normalizes annotated image coordinates to original-pixel integers", () => {
  const normalized = normalizeImageValue({
    src: "/media/example.jpg",
    regions: [
      { label: " Portrait ", x: 12.4, y: 20.7, width: 400.2, height: 299.8 }
    ],
    points: [{ label: "Focus", x: 220.6, y: 150.1 }]
  });

  assert.deepEqual(compactImageValue(normalized), {
    src: "/media/example.jpg",
    regions: [
      { label: "Portrait", x: 12, y: 21, width: 400, height: 300 }
    ],
    points: [{ label: "Focus", x: 221, y: 150 }]
  });
});

test("preserves future image metadata while editing annotations", () => {
  assert.deepEqual(
    compactImageValue({
      src: "/media/example.jpg",
      credit: "Archive",
      points: []
    }),
    {
      src: "/media/example.jpg",
      credit: "Archive"
    }
  );
});
