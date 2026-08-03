import { typeField, typeFields } from "./editor.js";
import { imageSource } from "./image.js";
import {
  hasReferenceValue,
  normalizeReferenceValue
} from "./reference.js";

function displayValue(value, field) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.widget === "tags" && Array.isArray(value)) {
    return value.length ? value.map(String).join(", ") : "—";
  }
  if (field.widget === "reference") {
    const reference = normalizeReferenceValue(value).ref;
    return hasReferenceValue(reference) ? String(reference) : "—";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field.display === "image" || field.widget === "image") {
    return imageSource(value) || "—";
  }
  if (field.display === "date" || field.widget === "datetime") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return field.display === "datetime"
        ? date.toLocaleString()
        : date.toLocaleDateString();
    }
  }
  if (field.widget === "select") {
    const option = field.options?.find((candidate) =>
      typeof candidate === "object"
        ? candidate.value === value
        : candidate === value
    );
    if (option && typeof option === "object") return option.label;
  }
  return String(value);
}

function systemFieldValue(name, record, collection, item) {
  const extension = String(collection.extension || "yml").replace(/^\./, "");
  const fileName = `${record.id}.${extension}`;
  if (name === "$id") return record.id;
  if (name === "$filename") return fileName;
  if (name === "$storage_path") {
    return `${String(collection.folder).replace(/\/$/, "")}/${fileName}`;
  }
  if (name === "$updated_at") return item?.updated_at;
  if (name === "$created_at") return item?.created_at;
  return "";
}

const SYSTEM_FIELD_DEFINITIONS = {
  $id: { label: "Record ID", display: "code" },
  $filename: { label: "File name", display: "code" },
  $storage_path: { label: "Storage path", display: "code" },
  $updated_at: { label: "Updated", display: "datetime" },
  $created_at: { label: "Created", display: "datetime" }
};

function detailField(type, reference) {
  const configuration =
    typeof reference === "string" ? { field: reference } : reference;
  const name = configuration?.field;
  if (!name) return null;
  if (name.startsWith("$")) {
    const systemField = SYSTEM_FIELD_DEFINITIONS[name];
    return systemField
      ? {
          name,
          system: true,
          mode: "read",
          ...systemField,
          ...configuration
        }
      : null;
  }
  const field = typeField(type, name);
  return field
    ? {
        mode: "edit",
        ...field,
        ...configuration,
        name
      }
    : null;
}

function fieldIsVisible(field, properties) {
  const condition = field?.visible_when;
  if (!condition || properties === undefined) return true;
  return properties?.[condition.field] === condition.equals;
}

function panelsFor(type, includeInfo = false) {
  const configuredPanels = type?.views?.detail?.panels ?? {};
  let panels = Object.entries(configuredPanels)
    .filter(([name]) => includeInfo || name !== "info")
    .map(([name, panel]) => ({
      name,
      label: panel.label || name,
      groups: panel.groups ?? {}
    }));
  if (!panels.length) {
    panels = [
      {
        name: "inspector",
        label: "Inspector",
        groups: {}
      }
    ];
  }
  if (includeInfo && !panels.some((panel) => panel.name === "info")) {
    panels.push({ name: "info", label: "Info", groups: {} });
  }
  return panels;
}

function groupsForPanel(
  type,
  panelName,
  includeInfo = false,
  properties
) {
  const panels = panelsFor(type, includeInfo);
  const activePanel = panels.find((panel) => panel.name === panelName) || panels[0];
  const definitions = activePanel.groups;
  let groups = Object.entries(definitions)
    .map(([name, definition]) => ({
      name,
      label: definition.label || name,
      icon: definition.icon,
      description: definition.description,
      fields: (definition.fields ?? [])
        .map((reference) => detailField(type, reference))
        .filter((field) => field && fieldIsVisible(field, properties))
    }))
    .filter((group) => group.fields.length);

  if (!groups.length && activePanel.name === panels[0].name) {
    groups = [
      {
        name: "properties",
        label: "Properties",
        fields: typeFields(type)
          .filter((field) => fieldIsVisible(field, properties))
          .map((field) => ({
            mode: "edit",
            ...field
          }))
      }
    ];
  }

  if (activePanel.name === "info") {
    const configuredNames = new Set(
      groups.flatMap((group) => group.fields.map((field) => field.name))
    );
    const missingSystemFields = ["$filename", "$storage_path"].filter(
      (name) => !configuredNames.has(name)
    );
    if (missingSystemFields.length) {
      groups.push({
        name: "stored_file",
        label: "Stored file",
        icon: "file-text",
        description: "Repository-relative collection record location.",
        fields: missingSystemFields.map((name) => detailField(type, name))
      });
    }
  }
  return groups;
}

export {
  SYSTEM_FIELD_DEFINITIONS,
  detailField,
  displayValue,
  fieldIsVisible,
  groupsForPanel,
  panelsFor,
  systemFieldValue
};
