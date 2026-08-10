const DEFAULT_IMAGE_ACCEPT = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml"
]);
const DEFAULT_FILE_ACCEPT = Object.freeze(["*/*"]);
const IMAGE_HASH_PATTERN = /^[a-f0-9]{64}$/;
const MEDIA_COLLECTION_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const MAX_MEDIA_FILENAME_BYTES = 255;

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", new Set([".jpg", ".jpeg"])],
  ["image/png", new Set([".png"])],
  ["image/gif", new Set([".gif"])],
  ["image/webp", new Set([".webp"])],
  ["image/avif", new Set([".avif"])],
  ["image/tiff", new Set([".tif", ".tiff"])],
  ["image/svg+xml", new Set([".svg"])]
]);

function acceptTokens(value = DEFAULT_IMAGE_ACCEPT) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : DEFAULT_IMAGE_ACCEPT;
  return [...new Set(
    source
      .map((token) => String(token).trim().toLowerCase())
      .filter(Boolean)
  )];
}

function validateMediaAccept(value) {
  const rawTokens = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(",")
      : [];
  if (
    !rawTokens.length ||
    rawTokens.some((token) => typeof token !== "string" || !token.trim())
  ) {
    return false;
  }
  return rawTokens.every((rawToken) => {
    const token = rawToken.trim();
    if (token === "*/*") return true;
    if (/^\.[a-z0-9][a-z0-9._+-]*$/i.test(token)) return true;
    return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/i.test(
      token
    );
  });
}

function configuredMediaAccept(config) {
  const configured = [];
  let hasUploadField = false;
  for (const type of Object.values(config?.node_types ?? {})) {
    for (const field of Object.values(type?.fields ?? {})) {
      if (!["image", "file"].includes(field?.widget)) continue;
      hasUploadField = true;
      configured.push(
        ...acceptTokens(
          field.accept ??
            (field.widget === "file" ? DEFAULT_FILE_ACCEPT : DEFAULT_IMAGE_ACCEPT)
        )
      );
    }
  }
  return hasUploadField
    ? [...new Set(configured)]
    : acceptTokens(DEFAULT_IMAGE_ACCEPT);
}

function configuredCollectionMediaAccept(
  config,
  collection,
  widgets = ["image", "file"]
) {
  const acceptedWidgets = new Set(
    (Array.isArray(widgets) ? widgets : [widgets]).filter((widget) =>
      ["image", "file"].includes(widget)
    )
  );
  const rootTypes = Array.isArray(collection?.allowed_types)
    ? collection.allowed_types
    : [collection?.node_type].filter(Boolean);
  const hierarchyTypes = collection?.hierarchy?.enabled
    ? Array.isArray(collection.hierarchy.allowed_child_types)
      ? collection.hierarchy.allowed_child_types
      : rootTypes
    : [];
  const pendingTypes = [...rootTypes, ...hierarchyTypes];
  const visitedTypes = new Set();
  const configured = [];

  while (pendingTypes.length) {
    const typeName = pendingTypes.shift();
    if (visitedTypes.has(typeName)) continue;
    visitedTypes.add(typeName);
    const type = config?.node_types?.[typeName];
    if (!type) continue;

    for (const field of Object.values(type.fields ?? {})) {
      if (!acceptedWidgets.has(field?.widget)) continue;
      configured.push(
        ...acceptTokens(
          field.accept ??
            (field.widget === "file" ? DEFAULT_FILE_ACCEPT : DEFAULT_IMAGE_ACCEPT)
        )
      );
    }
    for (const slot of Object.values(type.slots ?? {})) {
      if (Array.isArray(slot?.allowed_types)) {
        pendingTypes.push(...slot.allowed_types);
      }
    }
  }

  return [...new Set(configured)];
}

const configuredImageAccept = configuredMediaAccept;

function filenameExtension(filename) {
  const basename = String(filename || "").split(/[\\/]/).pop() || "";
  const index = basename.lastIndexOf(".");
  return index > 0 ? basename.slice(index).toLowerCase() : "";
}

function inferredMimeTypes(extension) {
  const types = [];
  for (const [mimeType, extensions] of MIME_EXTENSIONS) {
    if (extensions.has(extension)) types.push(mimeType);
  }
  return types;
}

function mediaFileMimeType(file) {
  return String(file?.type ?? file?.mimeType ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function mediaAcceptErrorMessage(file, accept = DEFAULT_IMAGE_ACCEPT) {
  const acceptedTypes = acceptTokens(accept);
  const mimeType = mediaFileMimeType(file) || "unknown";
  return [
    `The upload must match a configured accepted file type (${acceptedTypes.join(", ")}).`,
    `Received MIME type: ${mimeType}.`
  ].join(" ");
}

function mediaFileMatchesAccept(file, accept = DEFAULT_IMAGE_ACCEPT) {
  const extension = filenameExtension(file?.name ?? file?.filename);
  const mimeType = mediaFileMimeType(file);
  const inferredTypes = inferredMimeTypes(extension);

  return acceptTokens(accept).some(
    (token) => {
      if (token === "*/*") return true;
      if (token.startsWith(".")) return extension === token;
      if (token.endsWith("/*")) {
        const prefix = token.slice(0, -1);
        return (
          mimeType.startsWith(prefix) ||
          inferredTypes.some((type) => type.startsWith(prefix))
        );
      }
      return (
        mimeType === token ||
        inferredTypes.includes(token) ||
        MIME_EXTENSIONS.get(token)?.has(extension) === true
      );
    }
  );
}

function utf8Length(value) {
  return new TextEncoder().encode(value).length;
}

function normalizedMediaFilename(value) {
  if (typeof value !== "string") return "";
  const filename = value.normalize("NFC");
  if (
    !filename ||
    filename === "." ||
    filename === ".." ||
    utf8Length(filename) > MAX_MEDIA_FILENAME_BYTES ||
    /[\\/\u0000-\u001f\u007f]/.test(filename)
  ) {
    return "";
  }
  return filename;
}

function imageAsset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const hash = typeof value.hash === "string" ? value.hash : "";
  const filename = normalizedMediaFilename(value.filename);
  if (!IMAGE_HASH_PATTERN.test(hash) || !filename) return null;
  return Object.freeze({ hash, filename });
}

function isCanonicalImageAsset(value) {
  const asset = imageAsset(value);
  return Boolean(
    asset &&
      value.hash === asset.hash &&
      value.filename === asset.filename
  );
}

async function sha256Hex(value, cryptoImplementation = globalThis.crypto) {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null;
  if (!bytes || typeof cryptoImplementation?.subtle?.digest !== "function") {
    throw new TypeError("SHA-256 hashing is not available.");
  }
  const digest = new Uint8Array(
    await cryptoImplementation.subtle.digest("SHA-256", bytes)
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function mediaFilenameWithSuffix(filename, suffix) {
  const normalized = normalizedMediaFilename(filename);
  if (!normalized || !Number.isSafeInteger(suffix) || suffix < 2) return "";
  const extensionIndex = normalized.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  let stem = hasExtension ? normalized.slice(0, extensionIndex) : normalized;
  let extension = hasExtension ? normalized.slice(extensionIndex) : "";
  const suffixText = `-${suffix}`;
  if (utf8Length(`f${suffixText}${extension}`) > MAX_MEDIA_FILENAME_BYTES) {
    extension = "";
  }
  const ending = `${suffixText}${extension}`;
  while (stem && utf8Length(`${stem}${ending}`) > MAX_MEDIA_FILENAME_BYTES) {
    stem = [...stem].slice(0, -1).join("");
  }
  const fallback = utf8Length(`file${ending}`) <= MAX_MEDIA_FILENAME_BYTES
    ? "file"
    : "f";
  return normalizedMediaFilename(`${stem || fallback}${ending}`);
}

function encodeMediaSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function imageAssetMediaPath(
  value,
  {
    storage = "api",
    collection,
    publicFolder = "/media"
  } = {}
) {
  const asset = imageAsset(value);
  if (!asset) return "";
  const prefix = String(publicFolder || "/media").replace(/\/+$/, "");
  if (storage === "github") {
    return `${prefix}/${asset.hash}/${encodeMediaSegment(asset.filename)}`;
  }
  if (storage !== "api") return "";
  const collectionName = String(collection ?? "");
  if (!MEDIA_COLLECTION_PATTERN.test(collectionName)) return "";
  return `${prefix}/${encodeMediaSegment(collectionName)}/${asset.hash}/${encodeMediaSegment(asset.filename)}`;
}

function mediaValueSource(value) {
  if (typeof value === "string") return value.trim();
  return "";
}

function recordMediaSources(record, config) {
  const sources = [];
  const visit = (node) => {
    const fields = config?.node_types?.[node?.type]?.fields ?? {};
    for (const [fieldName, field] of Object.entries(fields)) {
      if (!["image", "file"].includes(field?.widget)) continue;
      const value = node?.properties?.[fieldName];
      if (field.widget === "image") {
        const asset = imageAsset(value);
        if (asset) sources.push({ widget: "image", value: asset });
      } else {
        const source = mediaValueSource(value);
        if (source) sources.push({ widget: "file", value: source });
      }
    }
    for (const children of Object.values(node?.slots ?? {})) {
      if (Array.isArray(children)) children.forEach(visit);
    }
  };
  if (record && typeof record === "object") visit(record);
  return sources;
}

function mediaStoragePath(source, config) {
  const value = mediaValueSource(source);
  if (!value) return null;
  const mediaFolder = String(
    config?.site?.media_folder || "content/media"
  ).replace(/^\/+|\/+$/g, "");
  const publicFolder = String(
    config?.site?.public_folder || "/media"
  ).replace(/\/+$/, "");
  let relativePath = "";
  if (value.startsWith(`${publicFolder}/`)) {
    relativePath = value.slice(publicFolder.length + 1);
  } else if (value.startsWith(`${mediaFolder}/`)) {
    relativePath = value.slice(mediaFolder.length + 1);
  } else {
    return null;
  }
  relativePath = relativePath.split(/[?#]/, 1)[0];
  let segments;
  try {
    segments = relativePath.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(segment)
    )
  ) {
    return null;
  }
  return `${mediaFolder}/${segments.join("/")}`;
}

function apiMediaStoragePath(source, config) {
  const storagePath = mediaStoragePath(source, config);
  if (!storagePath) return null;
  const mediaFolder = String(
    config?.site?.media_folder || "content/media"
  ).replace(/^\/+|\/+$/g, "");
  const relative = storagePath.slice(mediaFolder.length + 1);
  const segments = relative.split("/");
  if (segments.length !== 3 || !IMAGE_HASH_PATTERN.test(segments[1])) {
    return null;
  }
  return `${mediaFolder}/${segments[0]}/${segments[1]}/asset.dat`;
}

function recordMediaStoragePaths(record, config, options = {}) {
  const storage = options.storage || "github";
  const mediaFolder = String(
    config?.site?.media_folder || "content/media"
  ).replace(/^\/+|\/+$/g, "");
  const collection = String(options.collection ?? "");
  const paths = recordMediaSources(record, config).flatMap((entry) => {
    if (entry.widget === "image") {
      if (storage === "api") {
        if (!MEDIA_COLLECTION_PATTERN.test(collection)) return [];
        return [`${mediaFolder}/${collection}/${entry.value.hash}/asset.dat`];
      }
      return [`${mediaFolder}/${entry.value.hash}/${entry.value.filename}`];
    }
    const path = storage === "api"
      ? apiMediaStoragePath(entry.value, config)
      : mediaStoragePath(entry.value, config);
    return path ? [path] : [];
  });
  return [...new Set(paths)];
}

function recordMediaFilenames(record, config) {
  return [
    ...new Set(
      recordMediaSources(record, config).map((entry) => {
        if (entry.widget === "image") return entry.value.filename;
        const pathname = entry.value.split(/[?#]/, 1)[0];
        const encoded = pathname.split("/").filter(Boolean).pop() || pathname;
        try {
          return decodeURIComponent(encoded);
        } catch {
          return encoded;
        }
      })
    )
  ];
}

export {
  DEFAULT_FILE_ACCEPT,
  DEFAULT_IMAGE_ACCEPT,
  IMAGE_HASH_PATTERN,
  acceptTokens,
  configuredCollectionMediaAccept,
  configuredImageAccept,
  configuredMediaAccept,
  imageAsset,
  imageAssetMediaPath,
  isCanonicalImageAsset,
  mediaFilenameWithSuffix,
  mediaAcceptErrorMessage,
  mediaFileMatchesAccept,
  mediaFileMimeType,
  mediaStoragePath,
  mediaValueSource,
  normalizedMediaFilename,
  recordMediaFilenames,
  recordMediaSources,
  recordMediaStoragePaths,
  sha256Hex,
  validateMediaAccept
};
