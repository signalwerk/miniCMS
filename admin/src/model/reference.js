function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isReferenceScalar(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function hasReferenceValue(value) {
  return isReferenceScalar(value) && value !== "";
}

function normalizeReferenceValue(value) {
  if (isReferenceScalar(value)) {
    return { ref: value, selections: {} };
  }
  if (!isMapping(value)) {
    return { ref: "", selections: {} };
  }

  const selections = {};
  if (isMapping(value.selections)) {
    for (const [name, selectedValue] of Object.entries(value.selections)) {
      if (typeof selectedValue === "string" && selectedValue) {
        selections[name] = selectedValue;
      }
    }
  }
  return {
    ref: isReferenceScalar(value.ref) ? value.ref : "",
    selections
  };
}

function compactReferenceValue(value) {
  const reference = normalizeReferenceValue(value);
  if (!hasReferenceValue(reference.ref)) return "";
  if (!Object.keys(reference.selections).length) return reference.ref;
  return {
    ref: reference.ref,
    selections: reference.selections
  };
}

function referenceItemValue(item, name, collection) {
  if (!name || name === "id" || name === "$id") return item?.id ?? "";
  const extension = String(collection?.extension || "yml").replace(/^\./, "");
  if (name === "$filename") return `${item?.id ?? ""}.${extension}`;
  if (name === "$storage_path") {
    return `${String(collection?.folder || "").replace(/\/$/, "")}/${item?.id ?? ""}.${extension}`;
  }
  if (name === "$created_at") return item?.created_at;
  if (name === "$updated_at") return item?.updated_at;
  return item?.properties?.[name] ?? item?.[name] ?? "";
}

function referenceSelectionDefinitions(field, collection) {
  const published = collection?.views?.reference?.selections;
  if (!isMapping(published) || !Array.isArray(field?.selections)) return [];
  const enabled = new Set(field.selections);
  return Object.entries(published).flatMap(([name, definition]) =>
    enabled.has(name) && isMapping(definition)
      ? [{ ...definition, name }]
      : []
  );
}

function nestedValue(value, path) {
  if (!path) return value;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((current, segment) => current?.[segment], value);
}

function referenceSelectionOptions(item, definition, collection) {
  const options = definition?.options;
  if (!isMapping(options) || typeof options.field !== "string") return [];
  const source = referenceItemValue(item, options.field, collection);
  const candidates = nestedValue(source, options.path);
  if (!Array.isArray(candidates)) return [];
  const valueField = options.value || "id";
  const labelField = options.label || "label";
  const seenValues = new Set();
  return candidates.flatMap((candidate) => {
    if (!isMapping(candidate)) return [];
    const value = candidate[valueField];
    if (
      typeof value !== "string" ||
      !value ||
      seenValues.has(value)
    ) {
      return [];
    }
    seenValues.add(value);
    const label = candidate[labelField];
    return [{
      value,
      label: typeof label === "string" && label ? label : value,
      item: candidate
    }];
  });
}

export {
  compactReferenceValue,
  hasReferenceValue,
  normalizeReferenceValue,
  referenceItemValue,
  referenceSelectionDefinitions,
  referenceSelectionOptions
};
