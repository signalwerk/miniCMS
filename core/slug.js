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
    date = new Date()
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
  return sanitizeFilenameStem(rendered);
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

export function uniqueFilenameStem(value, usedIds) {
  const base = sanitizeFilenameStem(value);
  const normalizedIds = new Set(
    [...usedIds].map((id) => String(id).toLowerCase())
  );
  let candidate = base;
  let counter = 2;
  while (normalizedIds.has(candidate.toLowerCase())) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  usedIds.add(candidate);
  return candidate;
}
