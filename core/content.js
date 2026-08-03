import yaml from "js-yaml";
import { ID_PATTERN } from "./id.js";
import {
  normalizeHttpOrigin,
  validateImageProcessingConfig
} from "./image-service.js";
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
  "url",
  "markdown",
  "select",
  "boolean",
  "datetime",
  "number",
  "file",
  "image",
  "reference",
  "tags",
  "id",
  "uuid"
]);
const INLINE_REFERENCE_VALUE_WIDGETS = new Set([
  "string",
  "text",
  "url",
  "markdown",
  "select",
  "datetime",
  "id"
]);
const INLINE_REFERENCE_PREVIEW_WIDGETS = new Set([
  ...INLINE_REFERENCE_VALUE_WIDGETS,
  "boolean",
  "number"
]);
const REFERENCE_SELECTION_KINDS = new Set([
  "image_region",
  "image_point"
]);
const BACKEND_NAMES = new Set(["api", "node", "github"]);

function contentError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWebUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
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
  const configuredName = backend.name || "api";
  const name = configuredName === "node" ? "api" : configuredName;
  if (!BACKEND_NAMES.has(name)) {
    throw contentError(status, `Unsupported backend "${name}".`);
  }
  if (configuredName === "node" || backend.name === undefined) {
    backend.name = "api";
  }
  if (name === "api") {
    if (backend.api_url !== undefined && typeof backend.api_url !== "string") {
      throw contentError(status, "The miniCMS API URL must be a string.");
    }
    if (backend.api_url !== undefined) {
      const apiUrl = backend.api_url.trim();
      if (!apiUrl) {
        backend.api_url = "";
        return;
      }
      try {
        backend.api_url = normalizeHttpOrigin(
          apiUrl,
          "The miniCMS API URL"
        );
      } catch (error) {
        throw contentError(status, error.message);
      }
      if (!backend.api_url.startsWith("https://")) {
        throw contentError(status, "The miniCMS API URL must use HTTPS.");
      }
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
      if (field.required === false) {
        delete field.required;
      } else if (field.required !== undefined && field.required !== true) {
        fail(
          `Field "${typeName}.${fieldName}" required must be true when configured.`
        );
      }
      if (field.widget === "uuid") field.widget = "id";
      if (field.blocknote !== undefined && field.widget !== "markdown") {
        fail(
          `Field "${typeName}.${fieldName}" may configure BlockNote only for a markdown widget.`
        );
      }
      if (field.blocknote !== undefined) {
        if (!isMapping(field.blocknote)) {
          fail(
            `Markdown field "${typeName}.${fieldName}" blocknote must be a mapping.`
          );
        }
        const inlineReference = field.blocknote.inline_reference;
        if (inlineReference !== undefined) {
          if (!isMapping(inlineReference)) {
            fail(
              `Markdown field "${typeName}.${fieldName}" blocknote.inline_reference must be a mapping.`
            );
          }
          if (
            typeof inlineReference.collection !== "string" ||
            !inlineReference.collection.trim()
          ) {
            fail(
              `Markdown field "${typeName}.${fieldName}" inline reference must define a collection.`
            );
          }
          if (
            inlineReference.preview_field !== undefined &&
            (typeof inlineReference.preview_field !== "string" ||
              !inlineReference.preview_field.trim())
          ) {
            fail(
              `Markdown field "${typeName}.${fieldName}" inline reference preview_field must be a non-empty field name.`
            );
          }
        }
      }
      if (field.widget !== "reference" && field.selections !== undefined) {
        fail(
          `Field "${typeName}.${fieldName}" may define selections only for a reference widget.`
        );
      }
      if (field.widget === "select" && !Array.isArray(field.options)) {
        fail(
          `Select field "${typeName}.${fieldName}" must define an options array.`
        );
      }
      if (field.widget === "tags" && field.default !== undefined) {
        fail(
          `Tags field "${typeName}.${fieldName}" cannot define a default.`
        );
      }
      if (
        field.widget === "url" &&
        field.default !== undefined &&
        field.default !== "" &&
        !isWebUrl(field.default)
      ) {
        fail(
          `URL field "${typeName}.${fieldName}" default must be an absolute HTTP or HTTPS URL.`
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
      if (field.visible_when !== undefined) {
        if (
          !isMapping(field.visible_when) ||
          typeof field.visible_when.field !== "string" ||
          !Object.hasOwn(field.visible_when, "equals")
        ) {
          fail(
            `Field "${typeName}.${fieldName}" visible_when must define a field and equals value.`
          );
        }
        if (
          field.visible_when.field === fieldName ||
          !type.fields[field.visible_when.field]
        ) {
          fail(
            `Field "${typeName}.${fieldName}" visible_when references unknown controlling field "${field.visible_when.field}".`
          );
        }
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
      if (
        referenceView.selections !== undefined &&
        !isMapping(referenceView.selections)
      ) {
        fail(
          `Collection "${collectionName}" reference selections must be a mapping.`
        );
      }
      for (const [selectionName, selection] of Object.entries(
        referenceView.selections ?? {}
      )) {
        assertKey(
          selectionName,
          `Collection "${collectionName}" reference selection "${selectionName}"`
        );
        if (!isMapping(selection)) {
          fail(
            `Collection "${collectionName}" reference selection "${selectionName}" must be a mapping.`
          );
        }
        if (!REFERENCE_SELECTION_KINDS.has(selection.kind)) {
          fail(
            `Collection "${collectionName}" reference selection "${selectionName}" uses unsupported kind "${selection.kind ?? ""}".`
          );
        }
        if (
          selection.label !== undefined &&
          (typeof selection.label !== "string" || !selection.label.trim())
        ) {
          fail(
            `Collection "${collectionName}" reference selection "${selectionName}" label must be a non-empty string.`
          );
        }
        if (!isMapping(selection.options)) {
          fail(
            `Collection "${collectionName}" reference selection "${selectionName}" must define options.`
          );
        }
        validateFieldName(
          selection.options.field,
          rootFields,
          `Collection "${collectionName}" reference selection "${selectionName}" options`,
          status
        );
        if (rootFields[selection.options.field]?.widget !== "image") {
          fail(
            `Collection "${collectionName}" reference selection "${selectionName}" must use an image field.`
          );
        }
        const expectedPath =
          selection.kind === "image_region" ? "regions" : "points";
        if (selection.options.path !== expectedPath) {
          fail(
            `Collection "${collectionName}" reference selection "${selectionName}" kind "${selection.kind}" must use options path "${expectedPath}".`
          );
        }
        for (const optionName of ["value", "label"]) {
          if (
            selection.options[optionName] !== undefined &&
            (typeof selection.options[optionName] !== "string" ||
              !selection.options[optionName].trim())
          ) {
            fail(
              `Collection "${collectionName}" reference selection "${selectionName}" option ${optionName} must be a non-empty field name.`
            );
          }
        }
        if ((selection.options.value || "id") !== "id") {
          fail(
            `Collection "${collectionName}" reference selection "${selectionName}" must use annotation IDs as option values.`
          );
        }
        if ((selection.options.label || "label") !== "label") {
          fail(
            `Collection "${collectionName}" reference selection "${selectionName}" must use annotation labels as option labels.`
          );
        }
      }
    }
  }

  const mediaFolder = config.site?.media_folder || "content/media";
  assertContentPath(mediaFolder, "site.media_folder", status);
  try {
    validateImageProcessingConfig(config);
  } catch (error) {
    fail(error.message);
  }

  for (const [typeName, type] of Object.entries(config.node_types)) {
    for (const [fieldName, field] of Object.entries(type.fields)) {
      const inlineReference = field.blocknote?.inline_reference;
      if (inlineReference) {
        const targetCollection = config.collections[inlineReference.collection];
        if (!targetCollection) {
          fail(
            `Node type "${typeName}" markdown field "${fieldName}" inline reference uses unknown collection "${inlineReference.collection}".`
          );
        }
        const targetFields =
          config.node_types[targetCollection.node_type].fields;
        const valueField = targetCollection.views?.reference?.value || "id";
        if (
          !["id", "$id"].includes(valueField) &&
          !INLINE_REFERENCE_VALUE_WIDGETS.has(targetFields[valueField]?.widget)
        ) {
          fail(
            `Node type "${typeName}" markdown field "${fieldName}" inline reference value field "${valueField}" must store text.`
          );
        }
        if (inlineReference.preview_field) {
          validateFieldName(
            inlineReference.preview_field,
            targetFields,
            `Node type "${typeName}" markdown field "${fieldName}" inline reference preview`,
            status
          );
          if (
            !SYSTEM_FIELDS.has(inlineReference.preview_field) &&
            !INLINE_REFERENCE_PREVIEW_WIDGETS.has(
              targetFields[inlineReference.preview_field]?.widget
            )
          ) {
            fail(
              `Node type "${typeName}" markdown field "${fieldName}" inline reference preview field "${inlineReference.preview_field}" must store scalar text.`
            );
          }
        }
      }
      if (!["reference", "tags"].includes(field.widget)) continue;
      const fieldKind = field.widget === "tags" ? "tags" : "reference";
      if (!config.collections[field.collection]) {
        fail(
          `Node type "${typeName}" ${fieldKind} field "${fieldName}" uses unknown collection "${field.collection ?? ""}".`
        );
      }
      const targetCollection = config.collections[field.collection];
      const targetTypes = targetCollection.allowed_types ?? [
        targetCollection.node_type
      ];

      if (field.widget === "tags") {
        if (!targetTypes.includes(targetCollection.node_type)) {
          fail(
            `Collection "${field.collection}" must allow its node type "${targetCollection.node_type}" so tags can be created.`
          );
        }
        if (
          field.value_field !== undefined ||
          field.allowed_types !== undefined
        ) {
          fail(
            `Node type "${typeName}" tags field "${fieldName}" may configure only its collection relation.`
          );
        }
        const referenceView = targetCollection.views?.reference;
        const valueField = referenceView?.value;
        const titleField = referenceView?.title;
        if (typeof valueField !== "string" || !valueField) {
          fail(
            `Collection "${field.collection}" must publish a reference value field for tags.`
          );
        }
        if (typeof titleField !== "string" || !titleField) {
          fail(
            `Collection "${field.collection}" must publish a reference title field for tags.`
          );
        }
        if (["id", "$id"].includes(valueField)) {
          fail(
            `Collection "${field.collection}" must publish an opaque generated-ID field for tags, not its record ID.`
          );
        }
        const tagTypes = [
          ...new Set([targetCollection.node_type, ...targetTypes])
        ];
        for (const targetType of tagTypes) {
          const targetFields = config.node_types[targetType]?.fields ?? {};
          if (targetFields[valueField]?.widget !== "id") {
            fail(
              `Collection "${field.collection}" tags value field "${valueField}" must use the id widget on type "${targetType}".`
            );
          }
          if (targetFields[titleField]?.widget !== "string") {
            fail(
              `Collection "${field.collection}" tags title field "${titleField}" must use the string widget on type "${targetType}".`
            );
          }
        }
        continue;
      }

      if (
        field.allowed_types !== undefined &&
        !Array.isArray(field.allowed_types)
      ) {
        fail(
          `Node type "${typeName}" ${fieldKind} field "${fieldName}" allowed_types must be an array.`
        );
      }
      for (const allowedType of field.allowed_types ?? []) {
        if (!targetTypes.includes(allowedType)) {
          fail(
            `Node type "${typeName}" ${fieldKind} field "${fieldName}" uses type "${allowedType}" outside its target collection.`
          );
        }
      }

      if (field.selections !== undefined && !Array.isArray(field.selections)) {
        fail(
          `Node type "${typeName}" reference field "${fieldName}" selections must be an array.`
        );
      }
      const publishedSelections =
        targetCollection.views?.reference?.selections ?? {};
      const seenSelections = new Set();
      const selectionSourceFields = new Set();
      for (const selectionName of field.selections ?? []) {
        if (typeof selectionName !== "string" || !selectionName) {
          fail(
            `Node type "${typeName}" reference field "${fieldName}" selections must contain names.`
          );
        }
        if (seenSelections.has(selectionName)) {
          fail(
            `Node type "${typeName}" reference field "${fieldName}" repeats selection "${selectionName}".`
          );
        }
        seenSelections.add(selectionName);
        if (!publishedSelections[selectionName]) {
          fail(
            `Node type "${typeName}" reference field "${fieldName}" uses unknown selection "${selectionName}" from collection "${field.collection}".`
          );
        }
        selectionSourceFields.add(
          publishedSelections[selectionName].options.field
        );
      }
      if (selectionSourceFields.size > 1) {
        fail(
          `Node type "${typeName}" reference field "${fieldName}" selections must use the same source field.`
        );
      }
      if (field.value_field) {
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

    const fields = config.node_types[node.type]?.fields ?? {};
    for (const [fieldName, field] of Object.entries(fields)) {
      if (!Object.hasOwn(node.properties ?? {}, fieldName)) continue;
      const value = node.properties[fieldName];
      if (field.widget === "tags" && (
        !Array.isArray(value) ||
        value.some(
          (tagId, index) =>
            typeof tagId !== "string" ||
            !ID_PATTERN.test(tagId) ||
            value.indexOf(tagId) !== index
        )
      )) {
        throw contentError(
          status,
          `Tags field "${node.type}.${fieldName}" must contain an array of unique generated IDs.`
        );
      }
      if (
        field.widget === "url" &&
        value !== "" &&
        !isWebUrl(value)
      ) {
        throw contentError(
          status,
          `URL field "${node.type}.${fieldName}" must be empty or contain an absolute HTTP or HTTPS URL.`
        );
      }
    }

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
  const titleField = collection.views?.reference?.title || "title";
  return {
    id: record.id,
    hierarchy_id: hierarchyId,
    type: record.type,
    parent,
    order: Number.isFinite(record.order) ? record.order : 0,
    title:
      record.properties?.[titleField] || record.properties?.title || record.id,
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
