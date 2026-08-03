const IMAGE_CACHE_STRATEGIES = Object.freeze([
  "revalidate",
  "immutable",
  "disabled"
]);
const IMAGE_FITS = Object.freeze([
  "cover",
  "contain",
  "fill",
  "inside"
]);
const IMAGE_FORMATS = Object.freeze([
  "avif",
  "gif",
  "jpeg",
  "png",
  "tiff",
  "webp"
]);
const IMAGE_OPERATION_TYPES = Object.freeze([
  "resize",
  "rotate",
  "flatten",
  "crop",
  "quality",
  "noop"
]);

const DEFAULT_IMAGE_PROCESSING = Object.freeze({
  width: 2400,
  height: 2400,
  fit: "inside",
  format: "webp",
  quality: 82,
  cache: Object.freeze({
    schema: "v1",
    strategy: "revalidate",
    max_age: 0
  })
});

const MAX_EDGE = 8192;
const MAX_COORDINATE = 1_000_000;
const MAX_OPERATIONS = IMAGE_OPERATION_TYPES.length;
const MAX_OPERATION_BYTES = 255;
const CACHE_SCHEMA_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const CONTENT_SHA_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_SERVICE_FILENAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEDIA_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const IMAGE_SERVICE_OUTPUT_FORMATS = new Set([
  ...IMAGE_FORMATS,
  "json",
  "svg"
]);
const OPERATION_NAME_PATTERN = /^[a-z]+$/;
const OPTION_NAME_PATTERN = /^[a-z]+$/;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const NUMBER_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

function imageServiceError(message) {
  return new TypeError(message);
}

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function processingSource(config) {
  if (isMapping(config?.site)) {
    return isMapping(config.site.image_processing)
      ? config.site.image_processing
      : {};
  }
  if (isMapping(config?.image_processing)) return config.image_processing;
  return isMapping(config) ? config : {};
}

function finiteInteger(value, name, { minimum, maximum }) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw imageServiceError(
      `${name} must be an integer from ${minimum} through ${maximum}.`
    );
  }
  return value;
}

function normalizedFormat(value, name = "Image output format") {
  const format = String(value || "").toLowerCase();
  const normalized = format === "jpg" ? "jpeg" : format;
  if (!IMAGE_FORMATS.includes(normalized)) {
    throw imageServiceError(
      `${name} must be one of: ${IMAGE_FORMATS.join(", ")}.`
    );
  }
  return normalized;
}

function validateImageProcessingConfig(config) {
  const source = processingSource(config);
  if (config?.site?.image_processing !== undefined && !isMapping(config.site.image_processing)) {
    throw imageServiceError("site.image_processing must be a mapping.");
  }
  if (source.width !== undefined) {
    finiteInteger(source.width, "site.image_processing.width", {
      minimum: 1,
      maximum: MAX_EDGE
    });
  }
  if (source.height !== undefined) {
    finiteInteger(source.height, "site.image_processing.height", {
      minimum: 1,
      maximum: MAX_EDGE
    });
  }
  if (source.fit !== undefined && !IMAGE_FITS.includes(source.fit)) {
    throw imageServiceError(
      `site.image_processing.fit must be one of: ${IMAGE_FITS.join(", ")}.`
    );
  }
  if (source.format !== undefined) {
    normalizedFormat(source.format, "site.image_processing.format");
  }
  if (source.quality !== undefined) {
    finiteInteger(source.quality, "site.image_processing.quality", {
      minimum: 1,
      maximum: 100
    });
  }

  if (source.cache !== undefined && !isMapping(source.cache)) {
    throw imageServiceError("site.image_processing.cache must be a mapping.");
  }
  const cache = source.cache ?? {};
  if (
    cache.schema !== undefined &&
    (typeof cache.schema !== "string" ||
      !CACHE_SCHEMA_PATTERN.test(cache.schema))
  ) {
    throw imageServiceError(
      "site.image_processing.cache.schema must match [a-z0-9][a-z0-9_-]{0,31}."
    );
  }
  if (
    cache.strategy !== undefined &&
    !IMAGE_CACHE_STRATEGIES.includes(cache.strategy)
  ) {
    throw imageServiceError(
      `site.image_processing.cache.strategy must be one of: ${IMAGE_CACHE_STRATEGIES.join(", ")}.`
    );
  }
  if (cache.max_age !== undefined) {
    finiteInteger(cache.max_age, "site.image_processing.cache.max_age", {
      minimum: 0,
      maximum: 31_536_000
    });
  }
  return source;
}

function normalizeImageProcessingConfig(config) {
  const source = validateImageProcessingConfig(config);
  const strategy =
    source.cache?.strategy ?? DEFAULT_IMAGE_PROCESSING.cache.strategy;
  const defaultMaxAge = strategy === "immutable" ? 31_536_000 : 0;
  return Object.freeze({
    width: source.width ?? DEFAULT_IMAGE_PROCESSING.width,
    height: source.height ?? DEFAULT_IMAGE_PROCESSING.height,
    fit: source.fit ?? DEFAULT_IMAGE_PROCESSING.fit,
    format: normalizedFormat(
      source.format ?? DEFAULT_IMAGE_PROCESSING.format
    ),
    quality: source.quality ?? DEFAULT_IMAGE_PROCESSING.quality,
    cache: Object.freeze({
      schema: source.cache?.schema ?? DEFAULT_IMAGE_PROCESSING.cache.schema,
      strategy,
      max_age: source.cache?.max_age ?? defaultMaxAge
    })
  });
}

function mediaSource(value) {
  if (typeof value === "string") return value.trim();
  if (isMapping(value) && typeof value.src === "string") {
    return value.src.trim();
  }
  return "";
}

function isExternalImageSource(value) {
  const source = mediaSource(value);
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source);
}

function sourcePath(value) {
  const source = mediaSource(value);
  if (!source || isExternalImageSource(source)) return source;
  if (source.includes("\\") || /[\u0000-\u001f\u007f]/.test(source)) {
    throw imageServiceError(
      "Image source paths must not contain backslashes or control characters."
    );
  }
  const pathname = source.split(/[?#]/, 1)[0];
  const segments = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (
    !segments.length ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw imageServiceError("Image source paths must not traverse directories.");
  }
  return pathname.startsWith("/") ? `/${segments.join("/")}` : segments.join("/");
}

function imageSourceExtension(value) {
  const pathname = sourcePath(value);
  if (!pathname || isExternalImageSource(pathname)) return "";
  const filename = pathname.split("/").pop() || "";
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(index + 1).toLowerCase() : "";
}

function isSvgImageSource(value) {
  return imageSourceExtension(value) === "svg";
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value);
}

function imageServiceSlug(value) {
  const pathname = sourcePath(value);
  const filename = pathname.split("/").pop() || "image";
  const extensionIndex = filename.lastIndexOf(".");
  const stem = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const slug = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "image";
}

function operationError(message) {
  return imageServiceError(`Invalid image operations: ${message}`);
}

function integerOption(value, label, { minimum = 0, maximum = MAX_EDGE } = {}) {
  if (typeof value !== "string" || !INTEGER_PATTERN.test(value)) {
    throw operationError(`${label} must be an integer.`);
  }
  const number = Number(value);
  if (number < minimum || number > maximum) {
    throw operationError(`${label} must be from ${minimum} through ${maximum}.`);
  }
  return String(number);
}

function plainNumber(value) {
  const serialized = String(value);
  if (!/[eE]/.test(serialized)) return serialized;

  const [coefficient, exponentValue] = serialized.toLowerCase().split("e");
  const exponent = Number(exponentValue);
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const point = unsigned.indexOf(".");
  const digits = unsigned.replace(".", "");
  const decimalIndex = (point < 0 ? unsigned.length : point) + exponent;
  let expanded;
  if (decimalIndex <= 0) {
    expanded = `0.${"0".repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    expanded = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  } else {
    expanded = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  }
  return negative ? `-${expanded}` : expanded;
}

function numberOption(value, label, { minimum, maximum }) {
  if (
    (typeof value !== "string" || !NUMBER_PATTERN.test(value)) &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw operationError(`${label} must be a number.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw operationError(`${label} must be from ${minimum} through ${maximum}.`);
  }
  return Object.is(number, -0) ? "0" : plainNumber(number);
}

function positiveNumberOption(value, label) {
  return numberOption(value, label, {
    minimum: 1,
    maximum: MAX_COORDINATE
  });
}

function exactOptions(options, allowed, type) {
  const keys = Object.keys(options);
  const unknown = keys.find((key) => !allowed.includes(key));
  if (unknown) throw operationError(`${type} does not support option "${unknown}".`);
}

function normalizedOperation(operation) {
  if (!isMapping(operation) || typeof operation.type !== "string") {
    throw operationError("every operation must have a type.");
  }
  const type = operation.type.toLowerCase();
  const options = isMapping(operation.options) ? operation.options : {};
  if (!IMAGE_OPERATION_TYPES.includes(type)) {
    throw operationError(`unsupported operation "${type}".`);
  }

  if (type === "resize") {
    exactOptions(options, ["value", "width", "height", "fit"], type);
    if (options.value !== undefined && options.width !== undefined) {
      throw operationError("resize width is repeated.");
    }
    const widthValue = options.width ?? options.value;
    const width = widthValue === undefined
      ? undefined
      : integerOption(String(widthValue), "resize width", { minimum: 1 });
    const height = options.height === undefined
      ? undefined
      : integerOption(String(options.height), "resize height", { minimum: 1 });
    if (!width && !height) throw operationError("resize requires width or height.");
    const fit = options.fit === undefined ? "inside" : String(options.fit).toLowerCase();
    if (!IMAGE_FITS.includes(fit)) {
      throw operationError(`resize fit must be one of: ${IMAGE_FITS.join(", ")}.`);
    }
    return { type, options: { ...(width ? { width } : {}), ...(height ? { height } : {}), fit } };
  }

  if (type === "rotate") {
    exactOptions(options, ["value", "angle"], type);
    if (options.value !== undefined && options.angle !== undefined) {
      throw operationError("rotation angle is repeated.");
    }
    const angle = options.angle ?? options.value;
    if (angle === undefined) throw operationError("rotate requires angle.");
    return {
      type,
      options: {
        angle: numberOption(angle, "rotation angle", {
          minimum: -360,
          maximum: 360
        })
      }
    };
  }

  if (type === "flatten") {
    exactOptions(options, ["value", "background", "alpha"], type);
    if (options.value !== undefined && options.background !== undefined) {
      throw operationError("flatten background is repeated.");
    }
    const normalized = {};
    const backgroundValue = options.background ?? options.value;
    if (backgroundValue !== undefined) {
      const background = String(backgroundValue).replace(/^#/, "").toLowerCase();
      if (!/^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(background)) {
        throw operationError("flatten background must be a 3, 4, 6, or 8 digit hex color.");
      }
      normalized.background = background;
    }
    if (options.alpha !== undefined) {
      if (options.alpha !== "remove") {
        throw operationError('flatten alpha must be "remove".');
      }
      normalized.alpha = "remove";
    }
    if (!Object.keys(normalized).length) {
      throw operationError("flatten requires background or alpha.");
    }
    return { type, options: normalized };
  }

  if (type === "crop") {
    exactOptions(
      options,
      ["left", "top", "width", "height", "rotation"],
      type
    );
    if (options.width === undefined || options.height === undefined) {
      throw operationError("crop requires width and height.");
    }
    const rotation = options.rotation === undefined
      ? undefined
      : numberOption(options.rotation, "crop rotation", {
          minimum: -180,
          maximum: 180
        });
    return {
      type,
      options: {
        left: numberOption(options.left ?? 0, "crop left", {
          minimum: -MAX_COORDINATE,
          maximum: MAX_COORDINATE
        }),
        top: numberOption(options.top ?? 0, "crop top", {
          minimum: -MAX_COORDINATE,
          maximum: MAX_COORDINATE
        }),
        width: positiveNumberOption(options.width, "crop width"),
        height: positiveNumberOption(options.height, "crop height"),
        ...(rotation === undefined || Number(rotation) === 0
          ? {}
          : { rotation })
      }
    };
  }

  if (type === "quality") {
    exactOptions(options, ["value"], type);
    if (options.value === undefined) throw operationError("quality requires a value.");
    return {
      type,
      options: {
        value: integerOption(String(options.value), "quality", {
          minimum: 1,
          maximum: 100
        })
      }
    };
  }

  exactOptions(options, [], type);
  return { type: "noop", options: {} };
}

function parseImageOperations(value) {
  if (
    typeof value !== "string" ||
    !value ||
    utf8Bytes(value).length > MAX_OPERATION_BYTES
  ) {
    throw operationError("the operation stack is missing or too long.");
  }
  const segments = value.split(";");
  if (!segments.length || segments.length > MAX_OPERATIONS || segments.some((entry) => !entry)) {
    throw operationError(`use between 1 and ${MAX_OPERATIONS} non-empty operations.`);
  }
  const seen = new Set();
  const operations = segments.map((segment) => {
    const at = segment.indexOf("@");
    if (at !== segment.lastIndexOf("@")) {
      throw operationError("an operation may contain only one @ separator.");
    }
    const type = (at < 0 ? segment : segment.slice(0, at)).toLowerCase();
    if (!OPERATION_NAME_PATTERN.test(type)) {
      throw operationError("operation names must contain lowercase letters.");
    }
    if (seen.has(type)) throw operationError(`operation "${type}" is repeated.`);
    seen.add(type);
    const definition = at < 0 ? "" : segment.slice(at + 1);
    const options = {};
    if (definition) {
      if (!definition.includes(":") && !definition.includes(",")) {
        options.value = definition;
      } else {
        for (const element of definition.split(",")) {
          const colon = element.indexOf(":");
          if (colon <= 0 || colon !== element.lastIndexOf(":")) {
            throw operationError(`malformed option "${element}".`);
          }
          const key = element.slice(0, colon).toLowerCase();
          const optionValue = element.slice(colon + 1).toLowerCase();
          if (!OPTION_NAME_PATTERN.test(key) || !optionValue) {
            throw operationError(`malformed option "${element}".`);
          }
          if (Object.hasOwn(options, key)) {
            throw operationError(`option "${key}" is repeated.`);
          }
          options[key] = optionValue;
        }
      }
    }
    return normalizedOperation({ type, options });
  });
  return validateOperationStack(operations);
}

function validateOperationStack(operations) {
  if (
    operations.length > 1 &&
    operations.some((operation) => operation.type === "noop")
  ) {
    throw operationError("noop must be the only operation.");
  }
  const qualityIndex = operations.findIndex(
    (operation) => operation.type === "quality"
  );
  if (qualityIndex >= 0 && qualityIndex !== operations.length - 1) {
    throw operationError("quality must be the final operation.");
  }
  const cropIndex = operations.findIndex(
    (operation) => operation.type === "crop"
  );
  if (cropIndex > 0) {
    throw operationError("crop must be the first operation.");
  }
  if (
    cropIndex >= 0 &&
    operations.some((operation) => operation.type === "rotate")
  ) {
    throw operationError("crop cannot be combined with rotate.");
  }
  return operations;
}

const OPERATION_OPTION_ORDER = Object.freeze({
  resize: ["width", "height", "fit"],
  rotate: ["angle"],
  flatten: ["background", "alpha"],
  crop: ["left", "top", "width", "height", "rotation"],
  quality: ["value"],
  noop: []
});

function serializeImageOperations(operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > MAX_OPERATIONS) {
    throw operationError(`use between 1 and ${MAX_OPERATIONS} operations.`);
  }
  const seen = new Set();
  const normalized = operations.map((entry) => {
    const operation = normalizedOperation(entry);
    if (seen.has(operation.type)) {
      throw operationError(`operation "${operation.type}" is repeated.`);
    }
    seen.add(operation.type);
    return operation;
  });
  validateOperationStack(normalized);
  const serialized = normalized.map((operation) => {
    const values = OPERATION_OPTION_ORDER[operation.type]
      .filter((key) => operation.options[key] !== undefined)
      .map((key) => `${key}:${operation.options[key]}`);
    if (!values.length) return operation.type;
    if (operation.type === "quality") {
      return `${operation.type}@${operation.options.value}`;
    }
    return `${operation.type}@${values.join(",")}`;
  }).join(";");
  if (utf8Bytes(serialized).length > MAX_OPERATION_BYTES) {
    throw operationError("the operation stack is too long.");
  }
  return serialized;
}

function configuredOperations(processing, overrides) {
  if (overrides.operations !== undefined) {
    if (typeof overrides.operations === "string") {
      return parseImageOperations(overrides.operations);
    }
    return overrides.operations.map(normalizedOperation);
  }
  const requestedWidth = overrides.width === undefined
    ? processing.width
    : overrides.width;
  const requestedHeight = overrides.height === undefined
    ? processing.height
    : overrides.height;
  const width = requestedWidth === null
    ? null
    : Math.min(requestedWidth, processing.width);
  const height = requestedHeight === null
    ? null
    : Math.min(requestedHeight, processing.height);
  const fit = overrides.fit ?? processing.fit;
  const quality = overrides.quality ?? processing.quality;
  return [
    ...(
      width === null && height === null
        ? []
        : [{
      type: "resize",
      options: {
        ...(width === null ? {} : { width }),
        ...(height === null ? {} : { height }),
        fit
      }
    }]
    ),
    { type: "quality", options: { value: quality } }
  ];
}

function imageServicePath(value, options = {}) {
  const configuredSource = sourcePath(value);
  if (!configuredSource || isExternalImageSource(configuredSource)) {
    return configuredSource;
  }
  const addressedSource = parseContentAddressedMediaPath(
    configuredSource,
    options.config
  );
  if (!addressedSource) {
    throw imageServiceError(
      "Image-service sources must use /media/<collection>/<sha256>/<filename>."
    );
  }
  const source = addressedSource.path;
  const processing = normalizeImageProcessingConfig(options.config);
  const svg = isSvgImageSource(source);
  const operations = options.info || svg
    ? [{ type: "noop", options: {} }]
    : configuredOperations(processing, options);
  const stack = serializeImageOperations(operations);
  const format = options.info
    ? "json"
    : svg
      ? "svg"
      : normalizedFormat(options.format ?? processing.format);
  return [
    "",
    processing.cache.schema,
    "media",
    addressedSource.collection,
    addressedSource.sha,
    stack,
    `${imageServiceSlug(source)}.${format}`
  ].join("/");
}

function normalizeHttpOrigin(value, label = "URL") {
  let base;
  try {
    base = new URL(value);
  } catch {
    throw imageServiceError(`${label} must be an absolute URL.`);
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw imageServiceError(
      `${label} must be an HTTP(S) origin without credentials, path, query, or hash.`
    );
  }
  return base.origin;
}

function buildImageServiceUrl(value, options = {}) {
  const route = imageServicePath(value, options);
  if (!route || isExternalImageSource(route) || !options.baseUrl) return route;
  const origin = normalizeHttpOrigin(options.baseUrl, "The image service base URL");
  return new URL(route, `${origin}/`).toString();
}

/**
 * Parses the canonical derivative identity so renderers can replace its
 * operation stack without needing the original media filename.
 */
function parseImageServiceUrl(value) {
  const source = typeof value === "string"
    ? value
    : isMapping(value) && typeof value.src === "string"
      ? value.src
      : "";
  if (!source || source !== source.trim()) return null;

  let url;
  let baseUrl = "";
  try {
    if (isExternalImageSource(source)) {
      url = new URL(source);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        return null;
      }
      baseUrl = url.origin;
    } else {
      if (!source.startsWith("/") || source.startsWith("//")) return null;
      url = new URL(source, "http://minicms.invalid");
    }
  } catch {
    return null;
  }
  if (url.search || url.hash) return null;

  const segments = url.pathname.slice(1).split("/");
  if (
    segments.length !== 6 ||
    !CACHE_SCHEMA_PATTERN.test(segments[0]) ||
    segments[1] !== "media"
  ) {
    return null;
  }

  const [schema, , collection, sha, stack, output] = segments;
  const extensionIndex = output.lastIndexOf(".");
  if (
    !safeMediaSegment(collection) ||
    !CONTENT_SHA_PATTERN.test(sha) ||
    extensionIndex <= 0
  ) {
    return null;
  }
  const filename = output.slice(0, extensionIndex);
  const format = output.slice(extensionIndex + 1);
  if (
    filename.length > 80 ||
    !IMAGE_SERVICE_FILENAME_PATTERN.test(filename) ||
    !IMAGE_SERVICE_OUTPUT_FORMATS.has(format)
  ) {
    return null;
  }

  let operations;
  try {
    operations = parseImageOperations(stack);
  } catch {
    return null;
  }
  if (serializeImageOperations(operations) !== stack) return null;

  const canonicalPath = [
    "",
    schema,
    "media",
    collection,
    sha,
    stack,
    `${filename}.${format}`
  ].join("/");
  if (source !== `${baseUrl}${canonicalPath}`) return null;

  return Object.freeze({
    baseUrl,
    schema,
    collection,
    sha,
    operations: Object.freeze(operations),
    filename,
    format
  });
}

function prependImageServiceOperations(value, operations) {
  const derivative = parseImageServiceUrl(value);
  if (
    !derivative ||
    !IMAGE_FORMATS.includes(derivative.format) ||
    derivative.operations.some(
      (operation) => !["resize", "quality"].includes(operation.type)
    )
  ) {
    return null;
  }
  if (!Array.isArray(operations) || !operations.length) {
    throw operationError("prepend at least one operation.");
  }
  const stack = serializeImageOperations([
    ...operations,
    ...derivative.operations
  ]);
  const route = [
    "",
    derivative.schema,
    "media",
    derivative.collection,
    derivative.sha,
    stack,
    `${derivative.filename}.${derivative.format}`
  ].join("/");
  return `${derivative.baseUrl}${route}`;
}

function imageServiceMediaPath(value, config) {
  const source = typeof value === "string" ? value : "";
  if (!source || isExternalImageSource(source)) return source;
  const suffixIndex = source.search(/[?#]/);
  const pathname = suffixIndex < 0 ? source : source.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? "" : source.slice(suffixIndex);
  const normalizedPath = sourcePath(pathname);
  const relativePath = normalizedPath.replace(/^\/+/, "");
  const publicFolder = String(config?.site?.public_folder ?? "/media")
    .replace(/^\/+|\/+$/g, "");
  const mediaFolder = String(config?.site?.media_folder ?? "content/media")
    .replace(/^\/+|\/+$/g, "");

  for (const prefix of new Set([mediaFolder, publicFolder, "media"])) {
    if (!prefix) continue;
    if (relativePath === prefix) return `/media${suffix}`;
    if (relativePath.startsWith(`${prefix}/`)) {
      return `/media/${relativePath.slice(prefix.length + 1)}${suffix}`;
    }
  }
  if (!publicFolder) return `/media/${relativePath}${suffix}`;
  return `/${relativePath}${suffix}`;
}

function safeMediaSegment(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    utf8Bytes(value).length <= 255 &&
    MEDIA_SEGMENT_PATTERN.test(value)
  );
}

function parseContentAddressedMediaPath(value, config) {
  const route = imageServiceMediaPath(value, config);
  if (!route || isExternalImageSource(route)) return null;
  const pathname = route.split(/[?#]/, 1)[0];
  if (!pathname.startsWith("/media/")) return null;
  const segments = pathname.slice("/media/".length).split("/");
  if (segments.length !== 3) return null;
  const [collection, sha, filename] = segments;
  if (
    !safeMediaSegment(collection) ||
    !CONTENT_SHA_PATTERN.test(sha) ||
    !safeMediaSegment(filename)
  ) {
    return null;
  }
  return Object.freeze({
    collection,
    sha,
    filename,
    path: `/media/${collection}/${sha}/${filename}`
  });
}

function buildImageServiceMediaUrl(value, options = {}) {
  const route = imageServiceMediaPath(value, options.config);
  if (!route || isExternalImageSource(route)) return route;
  const addressed = parseContentAddressedMediaPath(route);
  if (!addressed) {
    throw imageServiceError(
      "Media-service sources must use /media/<collection>/<sha256>/<filename>."
    );
  }
  const suffixIndex = route.search(/[?#]/);
  const canonicalRoute = `${addressed.path}${
    suffixIndex < 0 ? "" : route.slice(suffixIndex)
  }`;
  if (!options.baseUrl) return canonicalRoute;
  const origin = normalizeHttpOrigin(options.baseUrl, "The image service base URL");
  return new URL(canonicalRoute, `${origin}/`).toString();
}

export {
  DEFAULT_IMAGE_PROCESSING,
  IMAGE_CACHE_STRATEGIES,
  IMAGE_FITS,
  IMAGE_FORMATS,
  buildImageServiceMediaUrl,
  buildImageServiceUrl,
  imageServiceMediaPath,
  imageServicePath,
  imageServiceSlug,
  isExternalImageSource,
  isSvgImageSource,
  normalizeHttpOrigin,
  normalizeImageProcessingConfig,
  parseContentAddressedMediaPath,
  parseImageServiceUrl,
  parseImageOperations,
  prependImageServiceOperations,
  serializeImageOperations,
  validateImageProcessingConfig
};
