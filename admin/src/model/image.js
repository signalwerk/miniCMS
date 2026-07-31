function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function annotationLabel(value, fallback) {
  const label = String(value ?? "").trim();
  return label || fallback;
}

function normalizeImageValue(value) {
  if (typeof value === "string") {
    return {
      src: value,
      regions: [],
      points: [],
      extra: {}
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      src: "",
      regions: [],
      points: [],
      extra: {}
    };
  }

  const {
    src,
    path,
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
    regions: Array.isArray(regions)
      ? regions.map((region, index) => ({
          label: annotationLabel(region?.label, `Region ${index + 1}`),
          x: Math.max(0, integer(region?.x)),
          y: Math.max(0, integer(region?.y)),
          width: Math.max(1, integer(region?.width, 1)),
          height: Math.max(1, integer(region?.height, 1))
        }))
      : [],
    points: Array.isArray(points)
      ? points.map((point, index) => ({
          label: annotationLabel(point?.label, `Point ${index + 1}`),
          x: Math.max(0, integer(point?.x)),
          y: Math.max(0, integer(point?.y))
        }))
      : [],
    extra
  };
}

function compactImageValue(value) {
  const image = normalizeImageValue(value);
  if (!image.src) return "";

  const hasAnnotations = image.regions.length > 0 || image.points.length > 0;
  const hasExtra = Object.keys(image.extra).length > 0;
  if (!hasAnnotations && !hasExtra) return image.src;

  return {
    src: image.src,
    ...image.extra,
    ...(image.regions.length ? { regions: image.regions } : {}),
    ...(image.points.length ? { points: image.points } : {})
  };
}

function imageSource(value) {
  return normalizeImageValue(value).src;
}

export {
  compactImageValue,
  imageSource,
  normalizeImageValue
};
