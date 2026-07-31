const DEFAULT_IMAGE_ACCEPT = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml"
]);
const DEFAULT_FILE_ACCEPT = Object.freeze(["*/*"]);

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", new Set([".jpg", ".jpeg"])],
  ["image/png", new Set([".png"])],
  ["image/gif", new Set([".gif"])],
  ["image/webp", new Set([".webp"])],
  ["image/avif", new Set([".avif"])],
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

function mediaValueSource(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.src === "string") {
    return value.src.trim();
  }
  return "";
}

function recordMediaSources(record, config) {
  const sources = new Set();
  const visit = (node) => {
    const fields = config?.node_types?.[node?.type]?.fields ?? {};
    for (const [fieldName, field] of Object.entries(fields)) {
      if (!["image", "file"].includes(field?.widget)) continue;
      const source = mediaValueSource(node?.properties?.[fieldName]);
      if (source) sources.add(source);
    }
    for (const children of Object.values(node?.slots ?? {})) {
      if (Array.isArray(children)) children.forEach(visit);
    }
  };
  if (record && typeof record === "object") visit(record);
  return [...sources];
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
  const segments = relativePath.split("/");
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return `${mediaFolder}/${segments.join("/")}`;
}

function recordMediaStoragePaths(record, config) {
  return [
    ...new Set(
      recordMediaSources(record, config)
        .map((source) => mediaStoragePath(source, config))
        .filter(Boolean)
    )
  ];
}

export {
  DEFAULT_FILE_ACCEPT,
  DEFAULT_IMAGE_ACCEPT,
  acceptTokens,
  configuredImageAccept,
  configuredMediaAccept,
  mediaAcceptErrorMessage,
  mediaFileMatchesAccept,
  mediaFileMimeType,
  mediaStoragePath,
  mediaValueSource,
  recordMediaSources,
  recordMediaStoragePaths,
  validateMediaAccept
};
