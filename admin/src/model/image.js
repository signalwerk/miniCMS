import { normalizeImageRotation } from "./imageGeometry.js";
import { createId } from "../../../core/id.js";

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function annotationLabel(value, fallback) {
  const label = String(value ?? "").trim();
  return label || fallback;
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  return rounded > 0 ? rounded : null;
}

function createImageAnnotationId() {
  return createId();
}

function annotationId(value) {
  return String(value ?? "").trim();
}

function normalizeImageValue(value) {
  if (typeof value === "string") {
    return {
      src: value,
      width: null,
      height: null,
      regions: [],
      points: [],
      extra: {}
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      src: "",
      width: null,
      height: null,
      regions: [],
      points: [],
      extra: {}
    };
  }

  const {
    src,
    path,
    width,
    height,
    regions,
    points,
    extra: normalizedExtra,
    ...extraProperties
  } = value;
  const extra = {
    ...(normalizedExtra &&
    typeof normalizedExtra === "object" &&
    !Array.isArray(normalizedExtra)
      ? normalizedExtra
      : {}),
    ...extraProperties
  };

  return {
    src: String(src ?? path ?? ""),
    width: positiveInteger(width),
    height: positiveInteger(height),
    regions: Array.isArray(regions)
      ? regions.map((region, index) => {
          const id = annotationId(region?.id);
          const rotation = normalizeImageRotation(region?.rotation);
          return {
            ...(id ? { id } : {}),
            label: annotationLabel(region?.label, `Region ${index + 1}`),
            x: rotation
              ? integer(region?.x)
              : Math.max(0, integer(region?.x)),
            y: rotation
              ? integer(region?.y)
              : Math.max(0, integer(region?.y)),
            width: Math.max(1, integer(region?.width, 1)),
            height: Math.max(1, integer(region?.height, 1)),
            ...(rotation ? { rotation } : {})
          };
        })
      : [],
    points: Array.isArray(points)
      ? points.map((point, index) => {
          const id = annotationId(point?.id);
          return {
            ...(id ? { id } : {}),
            label: annotationLabel(point?.label, `Point ${index + 1}`),
            x: Math.max(0, integer(point?.x)),
            y: Math.max(0, integer(point?.y))
          };
        })
      : [],
    extra
  };
}

function ensureImageAnnotationIds(value) {
  const image = normalizeImageValue(value);
  const seen = new Set();
  function identified(items) {
    return items.map((item) => {
      let id = annotationId(item.id);
      if (!id || seen.has(id)) id = createId(seen);
      else seen.add(id);
      return { ...item, id };
    });
  }
  return {
    ...image,
    regions: identified(image.regions),
    points: identified(image.points)
  };
}

function refreshImageAnnotationIds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const seen = new Set();
  const refreshed = (items) =>
    Array.isArray(items)
      ? items.map((item) => ({ ...item, id: createId(seen) }))
      : items;
  return {
    ...value,
    ...(Object.hasOwn(value, "regions")
      ? { regions: refreshed(value.regions) }
      : {}),
    ...(Object.hasOwn(value, "points")
      ? { points: refreshed(value.points) }
      : {})
  };
}

function compactImageValue(value) {
  const image = normalizeImageValue(value);
  if (!image.src) return "";

  const hasAnnotations = image.regions.length > 0 || image.points.length > 0;
  const hasDimensions = image.width !== null || image.height !== null;
  const hasExtra = Object.keys(image.extra).length > 0;
  if (!hasAnnotations && !hasDimensions && !hasExtra) return image.src;

  return {
    src: image.src,
    ...image.extra,
    ...(image.width !== null ? { width: image.width } : {}),
    ...(image.height !== null ? { height: image.height } : {}),
    ...(image.regions.length ? { regions: image.regions } : {}),
    ...(image.points.length ? { points: image.points } : {})
  };
}

function imageSource(value) {
  return normalizeImageValue(value).src;
}

function imageCoordinateSize(value, naturalWidth, naturalHeight) {
  const image = normalizeImageValue(value);
  if (image.width && image.height) {
    return { width: image.width, height: image.height };
  }
  const width = positiveInteger(naturalWidth);
  const height = positiveInteger(naturalHeight);
  return width && height ? { width, height } : null;
}

export {
  compactImageValue,
  createImageAnnotationId,
  ensureImageAnnotationIds,
  imageCoordinateSize,
  imageSource,
  normalizeImageValue,
  refreshImageAnnotationIds
};
