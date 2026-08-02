function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanGeometryNumber(value) {
  if (Math.abs(value) < 1e-10) return 0;
  return Number(value.toFixed(10));
}

function normalizeImageRotation(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  let normalized = cleanGeometryNumber(number % 360);
  if (normalized > 180) normalized -= 360;
  if (normalized <= -180) normalized += 360;
  return cleanGeometryNumber(normalized);
}

function imageRotationStep(modifiers = {}) {
  if (modifiers.shiftKey) return 45;
  if (modifiers.altKey) return 0.1;
  return 1;
}

function steppedImageRotation(value, direction, step = 1) {
  const rotation = normalizeImageRotation(value);
  if (!direction) return rotation;
  if (step === 45) {
    return normalizeImageRotation(
      direction > 0
        ? Math.floor(rotation / step + 1) * step
        : Math.ceil(rotation / step - 1) * step
    );
  }
  return normalizeImageRotation(rotation + direction * step);
}

function boundedImageRegion(region, imageSize) {
  if (!imageSize) {
    return {
      ...region,
      rotation: normalizeImageRotation(region.rotation)
    };
  }
  const imageWidth = Math.max(1, finiteNumber(imageSize.width, 1));
  const imageHeight = Math.max(1, finiteNumber(imageSize.height, 1));
  let width = clamp(finiteNumber(region.width, 1), 1, imageWidth);
  let height = clamp(finiteNumber(region.height, 1), 1, imageHeight);
  const rotation = normalizeImageRotation(region.rotation);
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  let halfBoundsWidth = (cosine * width + sine * height) / 2;
  let halfBoundsHeight = (sine * width + cosine * height) / 2;
  const fitScale = Math.min(
    1,
    imageWidth / (halfBoundsWidth * 2),
    imageHeight / (halfBoundsHeight * 2)
  );
  if (fitScale < 1) {
    width = Math.max(1, width * fitScale);
    height = Math.max(1, height * fitScale);
    halfBoundsWidth = (cosine * width + sine * height) / 2;
    halfBoundsHeight = (sine * width + cosine * height) / 2;
  }
  const requestedCenterX = finiteNumber(region.x) + finiteNumber(region.width, 1) / 2;
  const requestedCenterY = finiteNumber(region.y) + finiteNumber(region.height, 1) / 2;
  const centerX = clamp(
    requestedCenterX,
    halfBoundsWidth,
    imageWidth - halfBoundsWidth
  );
  const centerY = clamp(
    requestedCenterY,
    halfBoundsHeight,
    imageHeight - halfBoundsHeight
  );
  return {
    ...region,
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    rotation
  };
}

function imageRegionCenter(region) {
  return {
    x: finiteNumber(region.x) + finiteNumber(region.width) / 2,
    y: finiteNumber(region.y) + finiteNumber(region.height) / 2
  };
}

function imageRegionCorners(region) {
  const center = imageRegionCenter(region);
  const radians = (normalizeImageRotation(region.rotation) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const halfWidth = finiteNumber(region.width) / 2;
  const halfHeight = finiteNumber(region.height) / 2;
  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight]
  ].map(([x, y]) => ({
    x: center.x + cosine * x - sine * y,
    y: center.y + sine * x + cosine * y
  }));
}

function imagePointInRegionCoordinates(point, region) {
  if (!point || !region) return null;
  const center = imageRegionCenter(region);
  const radians = (normalizeImageRotation(region.rotation) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const deltaX = finiteNumber(point.x) - center.x;
  const deltaY = finiteNumber(point.y) - center.y;
  return {
    x: cleanGeometryNumber(
      cosine * deltaX + sine * deltaY + finiteNumber(region.width) / 2
    ),
    y: cleanGeometryNumber(
      -sine * deltaX + cosine * deltaY + finiteNumber(region.height) / 2
    )
  };
}

function imagePointOutsideRegion(point, region) {
  const local = imagePointInRegionCoordinates(point, region);
  if (!local) return false;
  return (
    local.x < 0 ||
    local.x > finiteNumber(region.width) ||
    local.y < 0 ||
    local.y > finiteNumber(region.height)
  );
}

function pointerAngle(region, point) {
  const center = imageRegionCenter(region);
  return (
    Math.atan2(
      finiteNumber(point.y) - center.y,
      finiteNumber(point.x) - center.x
    ) *
    180) /
    Math.PI;
}

function imageRegionRotationFromPoint(
  region,
  point,
  step = 1,
  startPoint = null
) {
  const normalizedStep = Math.max(0.001, Math.abs(finiteNumber(step, 1)));
  let angle;
  if (startPoint) {
    const startAngle = pointerAngle(region, startPoint);
    const currentAngle = pointerAngle(region, point);
    const delta = ((currentAngle - startAngle + 540) % 360) - 180;
    const rotation = normalizeImageRotation(region.rotation);
    if (normalizedStep !== 45) {
      return normalizeImageRotation(
        rotation + Math.round(delta / normalizedStep) * normalizedStep
      );
    }
    angle = rotation + delta;
  } else {
    angle = pointerAngle(region, point) + 90;
  }
  return normalizeImageRotation(
    Math.round(angle / normalizedStep) * normalizedStep
  );
}

function imageCropViewport(imageSize, crop) {
  if (!imageSize || !crop) return null;
  const imageWidth = finiteNumber(imageSize.width);
  const imageHeight = finiteNumber(imageSize.height);
  const width = finiteNumber(crop.width);
  const height = finiteNumber(crop.height);
  if (!imageWidth || !imageHeight || !width || !height) return null;
  const centerX = finiteNumber(crop.x) + width / 2;
  const centerY = finiteNumber(crop.y) + height / 2;
  const rotation = normalizeImageRotation(crop.rotation);
  return {
    aspectRatio: width / height,
    sourceWidth: (imageWidth / width) * 100,
    sourceLeft: 50 - (centerX / width) * 100,
    sourceTop: 50 - (centerY / height) * 100,
    sourceOriginX: (centerX / imageWidth) * 100,
    sourceOriginY: (centerY / imageHeight) * 100,
    sourceRotation: rotation ? -rotation : 0
  };
}

function resizedImageRegion(
  region,
  handle,
  deltaX,
  deltaY,
  imageSize,
  minimumSize = 8
) {
  const bounded = boundedImageRegion(region, imageSize);
  const radians = (bounded.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localDeltaX = cosine * deltaX + sine * deltaY;
  const localDeltaY = -sine * deltaX + cosine * deltaY;
  const minimumWidth = Math.min(minimumSize, imageSize.width);
  const minimumHeight = Math.min(minimumSize, imageSize.height);
  let left = -bounded.width / 2;
  let top = -bounded.height / 2;
  let right = bounded.width / 2;
  let bottom = bounded.height / 2;

  if (handle.includes("w")) {
    left = clamp(left + localDeltaX, right - imageSize.width, right - minimumWidth);
  }
  if (handle.includes("e")) {
    right = clamp(right + localDeltaX, left + minimumWidth, left + imageSize.width);
  }
  if (handle.includes("n")) {
    top = clamp(top + localDeltaY, bottom - imageSize.height, bottom - minimumHeight);
  }
  if (handle.includes("s")) {
    bottom = clamp(bottom + localDeltaY, top + minimumHeight, top + imageSize.height);
  }

  const localCenterX = (left + right) / 2;
  const localCenterY = (top + bottom) / 2;
  const center = imageRegionCenter(bounded);
  const centerX =
    center.x + cosine * localCenterX - sine * localCenterY;
  const centerY =
    center.y + sine * localCenterX + cosine * localCenterY;
  const width = right - left;
  const height = bottom - top;

  return boundedImageRegion(
    {
      ...bounded,
      x: Math.round(centerX - width / 2),
      y: Math.round(centerY - height / 2),
      width: Math.round(width),
      height: Math.round(height)
    },
    imageSize
  );
}

export {
  boundedImageRegion,
  imageCropViewport,
  imagePointInRegionCoordinates,
  imagePointOutsideRegion,
  imageRegionCenter,
  imageRegionCorners,
  imageRegionRotationFromPoint,
  imageRotationStep,
  normalizeImageRotation,
  resizedImageRegion,
  steppedImageRotation
};
