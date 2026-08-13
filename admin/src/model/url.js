import { parseInlineLinkUrl } from "../../../core/inline-link.js";

function rawUrlValue(value) {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.url === "string"
  ) {
    return value.url;
  }
  return "";
}

function parsedContentUrl(value) {
  try {
    return parseInlineLinkUrl(rawUrlValue(value));
  } catch {
    return null;
  }
}

function recordValue(record, fieldName) {
  if (!record || typeof fieldName !== "string" || !fieldName) return undefined;
  if (fieldName === "id" || fieldName === "$id") return record.id;
  if (fieldName.startsWith("properties.")) {
    return fieldName
      .slice("properties.".length)
      .split(".")
      .reduce((current, key) => current?.[key], record.properties);
  }
  return record.properties?.[fieldName] ?? record[fieldName];
}

function resolvedUrlLabel(value, collection) {
  const raw = rawUrlValue(value);
  if (!raw) return "—";
  const link = parsedContentUrl(raw);
  if (!link) {
    return raw.startsWith("minicms://") ? "Invalid content link" : raw;
  }

  const record = value && typeof value === "object"
    ? value.link?.record
    : null;
  const titleField = collection?.views?.reference?.title;
  const title = recordValue(record, titleField) ??
    record?.properties?.title ??
    record?.title;
  return ["string", "number", "boolean"].includes(typeof title) &&
    String(title).trim()
    ? String(title)
    : `Content link: ${link.ref}`;
}

export {
  parsedContentUrl,
  rawUrlValue,
  resolvedUrlLabel
};
