import { normalizeImageRotation } from "./imageGeometry.js";
import { createId } from "../../../core/id.js";
import { imageAsset } from "../../../core/media.js";

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
  const asset = imageAsset(value);
  if (!asset) {
    return {
      hash: "",
      filename: "",
      width: null,
      height: null,
      regions: [],
      points: [],
      extra: {}
    };
  }

  const {
    hash: _hash,
    filename: _filename,
    src: _resolvedSource,
    path: _legacyPath,
    sha: _legacyHash,
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
  for (const key of [
    "hash",
    "filename",
    "src",
    "path",
    "sha",
    "width",
    "height",
    "regions",
    "points",
    "extra"
  ]) {
    delete extra[key];
  }

  return {
    hash: asset.hash,
    filename: asset.filename,
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
  const asset = imageAsset(image);
  if (!asset) return "";

  return {
    ...image.extra,
    hash: asset.hash,
    filename: asset.filename,
    ...(image.width !== null ? { width: image.width } : {}),
    ...(image.height !== null ? { height: image.height } : {}),
    ...(image.regions.length ? { regions: image.regions } : {}),
    ...(image.points.length ? { points: image.points } : {})
  };
}

function imageAssetValue(value) {
  return imageAsset(value);
}

function imageFilename(value) {
  return imageAsset(value)?.filename || "";
}

function imageAssetKey(value) {
  const asset = imageAsset(value);
  return asset ? `${asset.hash}:${asset.filename}` : "";
}

function hasImageValue(value) {
  return Boolean(imageAsset(value));
}

function resolveImagePresentation(adapter, value, field, options = {}) {
  if (field?.display !== "image") return "";
  if (field.widget === "image") {
    const asset = imageAssetValue(value);
    return asset ? adapter.resolveImageUrl?.(asset, options) || "" : "";
  }
  if (typeof value !== "string" || !value) return "";
  return adapter.resolveMediaUrl?.(value, {
    collection: options.collection
  }) || "";
}

function imageInfoCoordinateSize(value) {
  const candidates = [value, value?.meta, value?.info, value?.metadata];
  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const width = positiveInteger(
      candidate.normalizedWidth ?? candidate.width
    );
    const height = positiveInteger(
      candidate.normalizedHeight ?? candidate.height
    );
    if (width && height) return { width, height };
  }
  return null;
}

function imageCoordinateSize(
  value,
  naturalWidth,
  naturalHeight,
  imageInfo = null
) {
  const image = normalizeImageValue(value);
  if (image.width && image.height) {
    return { width: image.width, height: image.height };
  }
  const informationSize = imageInfoCoordinateSize(imageInfo);
  if (informationSize) return informationSize;
  const width = positiveInteger(naturalWidth);
  const height = positiveInteger(naturalHeight);
  return width && height ? { width, height } : null;
}

export {
  compactImageValue,
  createImageAnnotationId,
  ensureImageAnnotationIds,
  imageCoordinateSize,
  imageAssetKey,
  imageAssetValue,
  imageFilename,
  imageInfoCoordinateSize,
  hasImageValue,
  normalizeImageValue,
  resolveImagePresentation,
  refreshImageAnnotationIds
};
