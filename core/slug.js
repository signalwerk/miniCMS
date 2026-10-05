const DATE_PARTS = {
  year: (date) => String(date.getFullYear()).padStart(4, "0"),
  month: (date) => String(date.getMonth() + 1).padStart(2, "0"),
  day: (date) => String(date.getDate()).padStart(2, "0"),
  hour: (date) => String(date.getHours()).padStart(2, "0"),
  minute: (date) => String(date.getMinutes()).padStart(2, "0"),
  second: (date) => String(date.getSeconds()).padStart(2, "0")
};

function fieldValue(fields, path) {
  return path.split(".").reduce((value, segment) => value?.[segment], fields);
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join("-");
  if (typeof value === "object") return "";
  return String(value);
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_WIDGET_TOKEN =
  /{{\s*((?:fields\.)?[A-Za-z0-9][A-Za-z0-9_-]*)\s*}}/g;

export function sanitizeSlug(value, fallback = "") {
  const sanitized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

export function slugWidgetTemplateFieldNames(template) {
  const names = [];
  for (const match of String(template ?? "").matchAll(SLUG_WIDGET_TOKEN)) {
    const name = match[1].replace(/^fields\./, "");
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function isSlugWidgetTemplate(template) {
  if (typeof template !== "string" || !template.trim()) return false;
  const fields = slugWidgetTemplateFieldNames(template);
  const remainder = template.replace(SLUG_WIDGET_TOKEN, "");
  return fields.length > 0 && !/[{}]/.test(remainder);
}

export function renderSlugWidgetTemplate(template, fields = {}) {
  const rendered = String(template ?? "").replace(
    SLUG_WIDGET_TOKEN,
    (_match, rawName) =>
      stringValue(fieldValue(fields, rawName.replace(/^fields\./, "")))
  );
  return sanitizeSlug(rendered);
}

export function sanitizeFilenameStem(value, fallback = "item") {
  const sanitized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return sanitized || fallback;
}

export function renderSlugTemplate(
  template,
  {
    fields = {},
    identifierField = "title",
    date = new Date(),
    fallback = "item"
  } = {}
) {
  const creationDate = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isNaN(creationDate.getTime())
    ? new Date()
    : creationDate;
  const rendered = String(template || "{{slug}}").replace(
    /{{\s*([^{}]+?)\s*}}/g,
    (_match, rawTag) => {
      const tag = rawTag.trim();
      if (tag === "slug") {
        return sanitizeFilenameStem(
          fieldValue(fields, identifierField) ?? fields.title ?? ""
        );
      }
      if (DATE_PARTS[tag]) return DATE_PARTS[tag](safeDate);
      if (tag.startsWith("fields.")) {
        return stringValue(fieldValue(fields, tag.slice("fields.".length)));
      }
      return stringValue(fieldValue(fields, tag));
    }
  );
  return sanitizeFilenameStem(rendered, fallback);
}

const RECORD_FILE_ID_PATTERN = /(?:^|-)([a-z0-9]{15})$/;
const MAX_RECORD_FILE_SLUG_LENGTH = 120;

// Record files are named `<slug>-<id>` from the collection's slug template,
// or just `<id>` without a template or when the template renders empty. The
// trailing opaque id is the record's identity; the slug is cosmetic.
export function recordFileStem(id, collection, { fields = {}, date = new Date() } = {}) {
  if (!collection?.slug) return id;
  const slug = renderSlugTemplate(collection.slug, {
    fields,
    identifierField: collection.identifier_field || "title",
    date,
    fallback: ""
  })
    .slice(0, MAX_RECORD_FILE_SLUG_LENGTH)
    .replace(/[._-]+$/, "");
  return slug ? `${slug}-${id}` : id;
}

export function recordIdFromFileStem(stem) {
  return RECORD_FILE_ID_PATTERN.exec(String(stem ?? ""))?.[1] ?? null;
}

export function slugTemplateFieldNames(template, identifierField = "title") {
  const names = [];
  for (const match of String(template || "").matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
    const tag = match[1].trim();
    const name =
      tag === "slug"
        ? identifierField
        : DATE_PARTS[tag]
          ? ""
          : tag.startsWith("fields.")
            ? tag.slice("fields.".length)
            : tag;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
