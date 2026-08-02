import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedImageRegion,
  imageCropViewport,
  imagePointInRegionCoordinates,
  imagePointOutsideRegion,
  imageRegionCorners,
  imageRegionRotationFromPoint,
  imageRotationStep,
  normalizeImageRotation,
  resizedImageRegion,
  steppedImageRotation
} from "./imageGeometry.js";

const region = {
  id: "region-one",
  x: 40,
  y: 40,
  width: 20,
  height: 10,
  rotation: 90
};
const imageSize = { width: 200, height: 100 };

test("normalizes image-region rotations without discarding fractional degrees", () => {
  assert.equal(normalizeImageRotation(361.25), 1.25);
  assert.equal(normalizeImageRotation(12.300000000000002), 12.3);
  assert.equal(normalizeImageRotation(-180), 180);
  assert.equal(normalizeImageRotation("not-an-angle"), 0);
});

test("selects ordinary, precise, and snapped rotation steps", () => {
  assert.equal(imageRotationStep({}), 1);
  assert.equal(imageRotationStep({ altKey: true }), 0.1);
  assert.equal(imageRotationStep({ shiftKey: true }), 45);
  assert.equal(imageRotationStep({ altKey: true, shiftKey: true }), 45);

  assert.equal(steppedImageRotation(12.3, 1, 0.1), 12.4);
  assert.equal(steppedImageRotation(12.3, -1, 0.1), 12.2);
  assert.equal(steppedImageRotation(12.3, 1, 45), 45);
  assert.equal(steppedImageRotation(12.3, -1, 45), 0);
});

test("maps source points into a rotated region", () => {
  assert.deepEqual(imagePointInRegionCoordinates({ x: 50, y: 35 }, region), {
    x: 0,
    y: 5
  });
  assert.equal(imagePointOutsideRegion({ x: 50, y: 35 }, region), false);
  assert.equal(imagePointOutsideRegion({ x: 40, y: 45 }, region), true);
});

test("keeps every rotated region corner inside the source image", () => {
  const bounded = {
    x: -10,
    y: -20,
    width: 180,
    height: 90,
    rotation: 45
  };
  const fitted = resizedImageRegion(
    bounded,
    "e",
    0,
    0,
    imageSize
  );
  for (const corner of imageRegionCorners(fitted)) {
    assert.ok(corner.x >= -1e-9 && corner.x <= imageSize.width + 1e-9);
    assert.ok(corner.y >= -1e-9 && corner.y <= imageSize.height + 1e-9);
  }
});

test("can restore original dimensions after a bounded rotation frame", () => {
  const original = {
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    rotation: 0
  };
  const rotated = boundedImageRegion(
    { ...original, rotation: 45 },
    imageSize
  );
  assert.ok(rotated.width < original.width);
  assert.deepEqual(boundedImageRegion(original, imageSize), original);
});

test("preserves valid rotated geometry whose local rectangle crosses an edge", () => {
  const edge = {
    x: -80,
    y: 90,
    width: 180,
    height: 20,
    rotation: 90
  };
  assert.deepEqual(
    boundedImageRegion(edge, { width: 200, height: 200 }),
    edge
  );
});

test("derives ordinary, precise, and snapped rotation from the pointer", () => {
  const top = { x: 50, y: 20 };
  const diagonal = { x: 80, y: 15 };
  assert.equal(imageRegionRotationFromPoint(region, top), 0);
  assert.equal(imageRegionRotationFromPoint(region, diagonal, 45), 45);

  const center = { x: 50, y: 45 };
  const pointerAngle = -77.66;
  const precise = {
    x: center.x + Math.cos((pointerAngle * Math.PI) / 180) * 30,
    y: center.y + Math.sin((pointerAngle * Math.PI) / 180) * 30
  };
  assert.equal(imageRegionRotationFromPoint(region, precise), 12);
  assert.equal(imageRegionRotationFromPoint(region, precise, 0.1), 12.3);
});

test("anchors ordinary and precise pointer steps to a fractional drag start", () => {
  const fractional = { ...region, rotation: 12.3 };
  const center = { x: 50, y: 45 };
  const pointAt = (degrees) => ({
    x: center.x + Math.cos((degrees * Math.PI) / 180) * 30,
    y: center.y + Math.sin((degrees * Math.PI) / 180) * 30
  });
  const start = pointAt(-80);

  assert.equal(
    imageRegionRotationFromPoint(fractional, pointAt(-79.88), 1, start),
    12.3
  );
  assert.equal(
    imageRegionRotationFromPoint(fractional, pointAt(-79.88), 0.1, start),
    12.4
  );
  assert.equal(
    imageRegionRotationFromPoint(fractional, pointAt(-78.8), 1, start),
    13.3
  );
  assert.equal(
    imageRegionRotationFromPoint(fractional, pointAt(-79.88), 45, start),
    0
  );
});

test("continues rotation across the signed-angle boundary without jumping", () => {
  const center = { x: 50, y: 45 };
  const pointAt = (degrees) => ({
    x: center.x + Math.cos((degrees * Math.PI) / 180) * 20,
    y: center.y + Math.sin((degrees * Math.PI) / 180) * 20
  });
  assert.equal(
    imageRegionRotationFromPoint(
      { ...region, rotation: 0 },
      pointAt(-179),
      1,
      pointAt(179)
    ),
    2
  );
});

test("maps a rotated crop into an inverse-rotated viewport", () => {
  assert.deepEqual(imageCropViewport(imageSize, region), {
    aspectRatio: 2,
    sourceWidth: 1000,
    sourceLeft: -200,
    sourceTop: -400,
    sourceOriginX: 25,
    sourceOriginY: 45,
    sourceRotation: -90
  });
});

test("projects resize movement onto the rotated region axes", () => {
  assert.deepEqual(resizedImageRegion(region, "e", 0, 20, imageSize), {
    id: "region-one",
    x: 30,
    y: 50,
    width: 40,
    height: 10,
    rotation: 90
  });
});
