import assert from "node:assert/strict";
import test from "node:test";
import { ID_PATTERN } from "../../../core/id.js";
import {
  compactImageValue,
  ensureImageAnnotationIds,
  imageCoordinateSize,
  imageSource,
  normalizeImageValue,
  refreshImageAnnotationIds
} from "./image.js";

test("keeps unannotated image values as path strings", () => {
  const path = "/media/example.jpg";
  assert.deepEqual(normalizeImageValue(path), {
    src: path,
    width: null,
    height: null,
    regions: [],
    points: [],
    extra: {}
  });
  assert.equal(compactImageValue(normalizeImageValue(path)), path);
  assert.equal(imageSource(path), path);
});

test("normalizes image coordinates while preserving fractional rotation", () => {
  const normalized = normalizeImageValue({
    src: "/media/example.jpg",
    width: 1200.2,
    height: 799.7,
    regions: [
      {
        id: "region-portrait",
        label: " Portrait ",
        x: 12.4,
        y: 20.7,
        width: 400.2,
        height: 299.8,
        rotation: 406.25
      }
    ],
    points: [
      { id: "point-focus", label: "Focus", x: 220.6, y: 150.1 }
    ]
  });

  assert.deepEqual(compactImageValue(normalized), {
    src: "/media/example.jpg",
    width: 1200,
    height: 800,
    regions: [
      {
        id: "region-portrait",
        label: "Portrait",
        x: 12,
        y: 21,
        width: 400,
        height: 300,
        rotation: 46.25
      }
    ],
    points: [
      { id: "point-focus", label: "Focus", x: 221, y: 150 }
    ]
  });
});

test("keeps legacy annotation normalization deterministic until an edit migrates IDs", () => {
  const normalized = normalizeImageValue({
    src: "/media/legacy.jpg",
    regions: [{ label: "Landscape", x: 1, y: 2, width: 3, height: 4 }],
    points: [{ label: "Face", x: 5, y: 6 }]
  });

  assert.equal(normalized.regions[0].id, undefined);
  assert.equal(normalized.points[0].id, undefined);
  assert.deepEqual(normalizeImageValue(compactImageValue(normalized)), normalized);
});

test("preserves negative pre-rotation bounds for a valid rotated region", () => {
  assert.deepEqual(
    normalizeImageValue({
      src: "/media/rotated.jpg",
      width: 200,
      height: 200,
      regions: [
        {
          id: "edge",
          label: "Edge",
          x: -80,
          y: 90,
          width: 180,
          height: 20,
          rotation: 90
        }
      ]
    }).regions[0],
    {
      id: "edge",
      label: "Edge",
      x: -80,
      y: 90,
      width: 180,
      height: 20,
      rotation: 90
    }
  );
});

test("assigns immutable unique IDs at the annotation mutation boundary", () => {
  const identified = ensureImageAnnotationIds({
    src: "/media/legacy.jpg",
    regions: [
      { id: "duplicate", label: "One", x: 1, y: 2, width: 3, height: 4 },
      { id: "duplicate", label: "Two", x: 5, y: 6, width: 7, height: 8 }
    ],
    points: [{ id: "duplicate", label: "Focus", x: 9, y: 10 }]
  });

  assert.equal(identified.regions[0].id, "duplicate");
  assert.match(identified.regions[1].id, ID_PATTERN);
  assert.match(identified.points[0].id, ID_PATTERN);
  assert.notEqual(identified.regions[1].id, identified.points[0].id);
  assert.deepEqual(ensureImageAnnotationIds(identified), identified);
});

test("regenerates every annotation ID when an image-bearing node is copied", () => {
  const original = {
    src: "/media/example.jpg",
    regions: [{ id: "3887a356428e7f4", label: "Crop" }],
    points: [{ id: "adbd1e73b1c54cc", label: "Focus" }]
  };
  const refreshed = refreshImageAnnotationIds(original);

  assert.match(refreshed.regions[0].id, ID_PATTERN);
  assert.match(refreshed.points[0].id, ID_PATTERN);
  assert.notEqual(refreshed.regions[0].id, original.regions[0].id);
  assert.notEqual(refreshed.points[0].id, original.points[0].id);
  assert.notEqual(refreshed.regions[0].id, refreshed.points[0].id);
  assert.equal(original.regions[0].id, "3887a356428e7f4");
});

test("retains valid coordinate-space dimensions without annotations", () => {
  assert.deepEqual(
    compactImageValue({
      src: "/media/example.jpg",
      width: 640,
      height: 480,
      regions: [],
      points: []
    }),
    {
      src: "/media/example.jpg",
      width: 640,
      height: 480
    }
  );
});

test("drops non-positive coordinate-space dimensions", () => {
  assert.equal(
    compactImageValue({
      src: "/media/example.jpg",
      width: 0.4,
      height: -1
    }),
    "/media/example.jpg"
  );
});

test("keeps persisted coordinate dimensions authoritative over browser natural size", () => {
  assert.deepEqual(
    imageCoordinateSize(
      { src: "/media/example.svg", width: 150, height: 150 },
      300,
      300
    ),
    { width: 150, height: 150 }
  );
  assert.deepEqual(
    imageCoordinateSize("/media/example.svg", 300, 300),
    { width: 300, height: 300 }
  );
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
