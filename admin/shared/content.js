import yaml from "js-yaml";
import { acceptTokens, validateMediaAccept } from "./media.js";

const YAML_OPTIONS = {
  schema: yaml.JSON_SCHEMA
};

const DUMP_OPTIONS = {
  noRefs: true,
  lineWidth: 100,
  sortKeys: false,
  quotingType: '"',
  forceQuotes: false
};

const SYSTEM_FIELDS = new Set([
  "$id",
  "$filename",
  "$storage_path",
  "$updated_at",
  "$created_at"
]);
const FIELD_MODES = new Set(["read", "edit"]);
const FIELD_DISPLAYS = new Set([
  "text",
  "date",
  "datetime",
  "toggle",
  "select",
  "badge",
  "code",
  "image"
]);
const FIELD_APPEARANCES = new Set(["title", "muted", "monospace"]);
const FIELD_ALIGNMENTS = new Set(["left", "center", "right"]);
const FIELD_WIDGETS = new Set([
  "string",
  "text",
  "markdown",
  "select",
  "boolean",
  "datetime",
  "number",
  "file",
  "image",
  "reference",
  "uuid"
]);
const BACKEND_NAMES = new Set(["node", "github"]);

function contentError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeName(value, label, status = 400) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw contentError(status, `Invalid ${label}.`);
  }
}

function normalizeRepositoryPath(value, label = "repository path", status = 400) {
  if (typeof value !== "string" || !value.trim() || value.includes("\\")) {
    throw contentError(status, `Invalid ${label}.`);
  }
  const normalized = value.replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        !/^[a-z0-9._-]+$/i.test(segment)
    )
  ) {
    throw contentError(status, `Invalid ${label}.`);
  }
  return normalized;
}

function assertContentPath(value, label, status = 400) {
  const normalized = normalizeRepositoryPath(value, label, status);
  if (normalized !== "content" && !normalized.startsWith("content/")) {
    throw contentError(status, `${label} must be inside content/.`);
  }
  return normalized;
}

function parseYaml(source) {
  return yaml.load(source, YAML_OPTIONS);
}

function dumpYaml(value) {
  return `${yaml.dump(value, DUMP_OPTIONS).trimEnd()}\n`;
}

function validateFieldReference(reference, fields, context, status = 500) {
  const configuration =
    typeof reference === "string" ? { field: reference } : reference;
  if (!isMapping(configuration) || typeof configuration.field !== "string") {
    throw contentError(status, `${context} must contain field references.`);
  }
  if (
    !SYSTEM_FIELDS.has(configuration.field) &&
    !fields[configuration.field]
  ) {
    throw contentError(
      status,
      `${context} references unknown field "${configuration.field}".`
    );
  }
  if (
    configuration.mode !== undefined &&
    !FIELD_MODES.has(configuration.mode)
  ) {
    throw contentError(
      status,
      `${context} uses unsupported mode "${configuration.mode}".`
    );
  }
  if (
    configuration.display !== undefined &&
    !FIELD_DISPLAYS.has(configuration.display)
  ) {
    throw contentError(
      status,
      `${context} uses unsupported display "${configuration.display}".`
    );
  }
  if (
    configuration.appearance !== undefined &&
    !FIELD_APPEARANCES.has(configuration.appearance)
  ) {
    throw contentError(
      status,
      `${context} uses unsupported appearance "${configuration.appearance}".`
    );
  }
  if (
    configuration.align !== undefined &&
    !FIELD_ALIGNMENTS.has(configuration.align)
  ) {
    throw contentError(
      status,
      `${context} uses unsupported alignment "${configuration.align}".`
    );
  }
}

function validateFieldName(reference, fields, context, status = 500) {
  if (typeof reference !== "string") {
    throw contentError(status, `${context} must use a field name.`);
  }
  validateFieldReference(reference, fields, context, status);
}

function validateBackend(backend, status) {
  if (backend === undefined) return;
  if (!isMapping(backend)) {
    throw contentError(status, "backend must be a mapping.");
  }
  const name = backend.name || "node";
  if (!BACKEND_NAMES.has(name)) {
    throw contentError(status, `Unsupported backend "${name}".`);
  }
  if (name === "node") {
    if (backend.api_url !== undefined && typeof backend.api_url !== "string") {
      throw contentError(status, "The Node backend API URL must be a string.");
    }
    return;
  }
  if (
    typeof backend.repo !== "string" ||
    !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(backend.repo)
  ) {
    throw contentError(
      status,
      'The GitHub backend repo must use the form "owner/repository".'
    );
  }
  if (typeof backend.branch !== "string" || !backend.branch.trim()) {
    throw contentError(status, "The GitHub backend must define a branch.");
  }
  if (typeof backend.base_url !== "string" || !backend.base_url.trim()) {
    throw contentError(status, "The GitHub backend must define an auth base URL.");
  }
  try {
    new URL(backend.base_url);
  } catch {
    throw contentError(status, "The GitHub auth base URL must be a valid URL.");
  }
  if (backend.api_root !== undefined) {
    try {
      new URL(backend.api_root);
    } catch {
      throw contentError(status, "The GitHub API root must be a valid URL.");
    }
  }
}

function validateConfig(config, status = 500) {
  const fail = (message) => {
    throw contentError(status, message);
  };
  const assertKey = (value, context) => {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
      fail(`${context} must use letters, numbers, underscores, or hyphens.`);
    }
  };

  validateBackend(config?.backend, status);
  if (!isMapping(config?.collections)) {
    fail("cms.config.yml must define collections as a mapping.");
  }
  if (!isMapping(config?.node_types)) {
    fail("cms.config.yml must define node_types as a mapping.");
  }
  if (!Object.keys(config.collections).length) {
    fail("cms.config.yml must define at least one collection.");
  }
  if (!Object.keys(config.node_types).length) {
    fail("cms.config.yml must define at least one node type.");
  }

  for (const [typeName, type] of Object.entries(config.node_types)) {
    assertKey(typeName, `Node type "${typeName}"`);
    if (!isMapping(type?.fields)) {
      fail(`Node type "${typeName}" must define fields as a mapping.`);
    }
    for (const [fieldName, field] of Object.entries(type.fields)) {
      assertKey(fieldName, `Field "${typeName}.${fieldName}"`);
      if (!isMapping(field)) {
        fail(`Field "${typeName}.${fieldName}" must be a mapping.`);
      }
      if (!FIELD_WIDGETS.has(field.widget)) {
        fail(
          `Field "${typeName}.${fieldName}" uses unsupported widget "${field.widget ?? ""}".`
        );
      }
      if (field.widget === "select" && !Array.isArray(field.options)) {
        fail(
          `Select field "${typeName}.${fieldName}" must define an options array.`
        );
      }
      if (
        ["image", "file"].includes(field.widget) &&
        field.accept !== undefined &&
        !validateMediaAccept(field.accept)
      ) {
        const fieldType = field.widget === "image" ? "Image" : "File";
        fail(
          `${fieldType} field "${typeName}.${fieldName}" must define accepted file types as an array of MIME types or extensions.`
        );
      }
      if (
        ["image", "file"].includes(field.widget) &&
        typeof field.accept === "string"
      ) {
        field.accept = acceptTokens(field.accept);
      }
    }
    if (type.slots !== undefined && !isMapping(type.slots)) {
      fail(`Node type "${typeName}" must define slots as a mapping.`);
    }
    for (const [slotName, slot] of Object.entries(type.slots ?? {})) {
      assertKey(slotName, `Slot "${typeName}.${slotName}"`);
      if (!Array.isArray(slot?.allowed_types)) {
        fail(
          `Node type "${typeName}" slot "${slotName}" must define allowed_types as an array.`
        );
      }
      for (const allowedType of slot.allowed_types) {
        if (!config.node_types[allowedType]) {
          fail(
            `Node type "${typeName}" slot "${slotName}" references unknown node type "${allowedType}".`
          );
        }
      }
    }
    for (const [panelName, panel] of Object.entries(
      type.views?.detail?.panels ?? {}
    )) {
      if (!isMapping(panel?.groups)) {
        fail(
          `Node type "${typeName}" detail panel "${panelName}" must define groups as a mapping.`
        );
      }
      for (const [groupName, group] of Object.entries(panel.groups)) {
        if (!Array.isArray(group?.fields)) {
          fail(
            `Node type "${typeName}" detail group "${groupName}" must define a fields array.`
          );
        }
        for (const reference of group.fields) {
          validateFieldReference(
            reference,
            type.fields,
            `Node type "${typeName}" detail group "${groupName}"`,
            status
          );
        }
      }
    }
  }

  for (const [collectionName, collection] of Object.entries(
    config.collections
  )) {
    assertKey(collectionName, `Collection "${collectionName}"`);
    if (!isMapping(collection)) {
      fail(`Collection "${collectionName}" must be a mapping.`);
    }
    if (
      collection.slug !== undefined &&
      (typeof collection.slug !== "string" || !collection.slug.trim())
    ) {
      fail(
        `Collection "${collectionName}" must define slug as a non-empty template string.`
      );
    }
    if (
      collection.delete_files_with_record !== undefined &&
      typeof collection.delete_files_with_record !== "boolean"
    ) {
      fail(
        `Collection "${collectionName}" delete_files_with_record must be a boolean.`
      );
    }
    if (typeof collection.folder !== "string" || !collection.folder) {
      fail(`Collection "${collectionName}" must define a folder.`);
    }
    assertContentPath(
      collection.folder,
      `Collection "${collectionName}" folder`,
      status
    );
    const extension = String(collection.extension || "yml").replace(/^\./, "");
    if (!["yml", "yaml"].includes(extension)) {
      fail(
        `Collection "${collectionName}" uses unsupported extension "${extension}".`
      );
    }
    if (!config.node_types[collection.node_type]) {
      fail(
        `Collection "${collectionName}" references unknown node type "${collection.node_type}".`
      );
    }
    if (
      collection.allowed_types !== undefined &&
      !Array.isArray(collection.allowed_types)
    ) {
      fail(`Collection "${collectionName}" allowed_types must be an array.`);
    }
    for (const allowedType of collection.allowed_types ?? []) {
      if (!config.node_types[allowedType]) {
        fail(
          `Collection "${collectionName}" references unknown allowed type "${allowedType}".`
        );
      }
    }
    if (
      collection.hierarchy?.allowed_child_types !== undefined &&
      !Array.isArray(collection.hierarchy.allowed_child_types)
    ) {
      fail(
        `Collection "${collectionName}" hierarchy allowed_child_types must be an array.`
      );
    }
    for (const childType of collection.hierarchy?.allowed_child_types ?? []) {
      if (!config.node_types[childType]) {
        fail(
          `Collection "${collectionName}" hierarchy references unknown child type "${childType}".`
        );
      }
    }
    const list = collection.views?.list;
    if (list?.type && !["tree", "table"].includes(list.type)) {
      fail(
        `Collection "${collectionName}" uses unsupported list type "${list.type}".`
      );
    }
    const rootFields = config.node_types[collection.node_type].fields;
    if (collection.identifier_field) {
      validateFieldName(
        collection.identifier_field,
        rootFields,
        `Collection "${collectionName}" title field`,
        status
      );
    }
    if (collection.hierarchy?.id_field) {
      validateFieldName(
        collection.hierarchy.id_field,
        rootFields,
        `Collection "${collectionName}" hierarchy ID field`,
        status
      );
    }
    if (list?.columns !== undefined && !Array.isArray(list.columns)) {
      fail(`Collection "${collectionName}" list columns must be an array.`);
    }
    for (const reference of list?.columns ?? []) {
      validateFieldReference(
        reference,
        rootFields,
        `Collection "${collectionName}" list columns`,
        status
      );
    }
    if (
      list?.search?.fields !== undefined &&
      !Array.isArray(list.search.fields)
    ) {
      fail(`Collection "${collectionName}" search fields must be an array.`);
    }
    for (const reference of list?.search?.fields ?? []) {
      validateFieldName(
        reference,
        rootFields,
        `Collection "${collectionName}" search fields`,
        status
      );
    }
    if (list?.sort?.field) {
      validateFieldName(
        list.sort.field,
        rootFields,
        `Collection "${collectionName}" list sort`,
        status
      );
    }
    const referenceView = collection.views?.reference;
    if (referenceView) {
      for (const [name, reference] of [
        ["value", referenceView.value],
        ["image", referenceView.image],
        ["title", referenceView.title],
        ...(
          Array.isArray(referenceView.description)
            ? referenceView.description
            : referenceView.description
              ? [referenceView.description]
              : []
        ).map((reference) => ["description", reference])
      ]) {
        if (!reference) continue;
        validateFieldName(
          reference,
          rootFields,
          `Collection "${collectionName}" reference ${name}`,
          status
        );
      }
    }
  }

  const mediaFolder = config.site?.media_folder || "content/media";
  assertContentPath(mediaFolder, "site.media_folder", status);

  for (const [typeName, type] of Object.entries(config.node_types)) {
    for (const [fieldName, field] of Object.entries(type.fields)) {
      if (field.widget !== "reference") continue;
      if (!config.collections[field.collection]) {
        fail(
          `Node type "${typeName}" reference field "${fieldName}" uses unknown collection "${field.collection}".`
        );
      }
      if (field.value_field) {
        const targetCollection = config.collections[field.collection];
        validateFieldName(
          field.value_field,
          config.node_types[targetCollection.node_type].fields,
          `Node type "${typeName}" reference field "${fieldName}"`,
          status
        );
      }
    }
  }
  return config;
}

function collectNodes(record, visit) {
  const walk = (node) => {
    visit(node);
    for (const children of Object.values(node?.slots ?? {})) {
      if (Array.isArray(children)) children.forEach(walk);
    }
  };
  walk(record);
}

function validateRecord(record, collection, config, status = 400) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw contentError(
      status,
      "The request body must be a complete record object."
    );
  }
  assertSafeName(record.id, "record id", status);

  const allowedRootTypes = collection.allowed_types ?? [collection.node_type];
  if (!allowedRootTypes.includes(record.type)) {
    throw contentError(
      status,
      `Record type "${record.type ?? ""}" is not allowed in collection "${collection.name}".`
    );
  }

  const seenIds = new Set();
  collectNodes(record, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw contentError(status, "Every content node must be an object.");
    }
    assertSafeName(node.id, "node id", status);
    if (!config.node_types?.[node.type]) {
      throw contentError(status, `Unknown node type "${node.type ?? ""}".`);
    }
    if (seenIds.has(node.id)) {
      throw contentError(
        status,
        `Node id "${node.id}" occurs more than once.`
      );
    }
    seenIds.add(node.id);

    for (const [slotName, children] of Object.entries(node.slots ?? {})) {
      const slot = config.node_types[node.type]?.slots?.[slotName];
      if (!slot) {
        throw contentError(
          status,
          `Type "${node.type}" has no slot "${slotName}".`
        );
      }
      if (!Array.isArray(children)) {
        throw contentError(status, `Slot "${slotName}" must be an array.`);
      }
      if (slot.max && children.length > slot.max) {
        throw contentError(
          status,
          `Slot "${slotName}" accepts at most ${slot.max} items.`
        );
      }
      for (const child of children) {
        if (!slot.allowed_types?.includes(child.type)) {
          throw contentError(
            status,
            `Type "${child.type}" is not allowed in ${node.type}.${slotName}.`
          );
        }
      }
    }
  });
  return record;
}

function hierarchyValue(record, collection, fieldName, fallback) {
  const configuredField = collection.hierarchy?.[fieldName];
  if (!configuredField) return fallback;
  return (
    record.properties?.[configuredField] ??
    record[configuredField] ??
    fallback
  );
}

function toTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function summarizeRecord(record, metadata, collection) {
  const hierarchyId = hierarchyValue(
    record,
    collection,
    "id_field",
    record.id
  );
  const parent = hierarchyValue(
    record,
    collection,
    "parent_field",
    record.parent ?? null
  );
  return {
    id: record.id,
    hierarchy_id: hierarchyId,
    type: record.type,
    parent,
    order: Number.isFinite(record.order) ? record.order : 0,
    title: record.properties?.title || record.id,
    hidden: Boolean(record.properties?.hidden),
    properties: record.properties ?? {},
    created_at: toTimestamp(metadata?.created_at ?? metadata?.birthtime),
    updated_at: toTimestamp(metadata?.updated_at ?? metadata?.mtime)
  };
}

export {
  assertContentPath,
  assertSafeName,
  contentError,
  dumpYaml,
  hierarchyValue,
  normalizeRepositoryPath,
  parseYaml,
  summarizeRecord,
  validateConfig,
  validateRecord
};
