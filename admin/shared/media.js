const DEFAULT_IMAGE_ACCEPT = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml"
]);

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
    if (/^\.[a-z0-9][a-z0-9._+-]*$/i.test(token)) return true;
    return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/i.test(
      token
    );
  });
}

function configuredImageAccept(config) {
  const configured = [];
  let hasImageField = false;
  for (const type of Object.values(config?.node_types ?? {})) {
    for (const field of Object.values(type?.fields ?? {})) {
      if (field?.widget !== "image") continue;
      hasImageField = true;
      configured.push(...acceptTokens(field.accept));
    }
  }
  return hasImageField
    ? [...new Set(configured)]
    : acceptTokens(DEFAULT_IMAGE_ACCEPT);
}

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

function mediaFileMatchesAccept(file, accept = DEFAULT_IMAGE_ACCEPT) {
  const extension = filenameExtension(file?.name ?? file?.filename);
  const mimeType = String(file?.type ?? file?.mimeType ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const inferredTypes = inferredMimeTypes(extension);

  return acceptTokens(accept).some(
    (token) => {
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

export {
  DEFAULT_IMAGE_ACCEPT,
  acceptTokens,
  configuredImageAccept,
  mediaFileMatchesAccept,
  validateMediaAccept
};
