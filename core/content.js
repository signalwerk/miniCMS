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
const CONNECTOR_NAMES = new Set(["api", "github"]);

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

function loopbackHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const parts = host.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts[0] === 127 &&
    parts.every(
      (part) => Number.isInteger(part) && part >= 0 && part <= 255
    )
  );
}

function normalizeConnectorOrigin(
  value,
  label,
  status,
  { allowEmpty = false, allowLoopbackHttp = false } = {}
) {
  if (typeof value !== "string") {
    throw contentError(status, `${label} must be a string.`);
  }
  const source = value.trim();
  if (!source) {
    if (allowEmpty) return "";
    throw contentError(status, `${label} must be defined.`);
  }
  let normalized;
  try {
    normalized = normalizeHttpOrigin(source, label);
  } catch (error) {
    throw contentError(status, error.message);
  }
  const url = new URL(normalized);
  const secure = url.protocol === "https:";
  const localDevelopment =
    allowLoopbackHttp &&
    url.protocol === "http:" &&
    loopbackHostname(url.hostname);
  if (!secure && !localDevelopment) {
    throw contentError(
      status,
      allowLoopbackHttp
        ? `${label} must use HTTPS or a loopback HTTP origin.`
        : `${label} must use HTTPS.`
    );
  }
  return normalized;
}

function validateConnector(connector, connectorName, status) {
  if (!isMapping(connector)) {
    throw contentError(
      status,
      `Connector "${connectorName}" must be a mapping.`
    );
  }
  if (!CONNECTOR_NAMES.has(connector.name)) {
    throw contentError(
      status,
      `Connector "${connectorName}" uses unsupported adapter "${connector.name ?? ""}".`
    );
  }
  if (connector.name === "api") {
    const reserved = ["default", "development"].includes(connectorName);
    if (connector.api_url === undefined && !reserved) {
      throw contentError(
        status,
        `Named API connector "${connectorName}" must define an HTTPS api_url.`
      );
    }
    if (connector.api_url !== undefined) {
      connector.api_url = normalizeConnectorOrigin(
        connector.api_url,
        `Connector "${connectorName}" miniCMS API URL`,
        status,
        {
          allowEmpty: reserved,
          allowLoopbackHttp: connectorName === "development"
        }
      );
    }
    const developmentLoopback =
      connectorName === "development" &&
      (connector.api_url === undefined ||
        connector.api_url === "" ||
        loopbackHostname(new URL(connector.api_url).hostname));
    if (connector.auth_url === undefined) {
      if (!developmentLoopback) {
        throw contentError(
          status,
          `API connector "${connectorName}" must define an HTTPS auth_url.`
        );
      }
    } else {
      connector.auth_url = normalizeConnectorOrigin(
        connector.auth_url,
        `Connector "${connectorName}" authentication URL`,
        status
      );
    }
    return;
  }
  if (
    typeof connector.repo !== "string" ||
    !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(connector.repo)
  ) {
    throw contentError(
      status,
      `Connector "${connectorName}" GitHub repo must use the form "owner/repository".`
    );
  }
  if (typeof connector.branch !== "string" || !connector.branch.trim()) {
    throw contentError(
      status,
      `Connector "${connectorName}" GitHub branch must be defined.`
    );
  }
  connector.base_url = normalizeConnectorOrigin(
    connector.base_url,
    `Connector "${connectorName}" GitHub auth base URL`,
    status
  );
  if (connector.api_root !== undefined) {
    connector.api_root = normalizeConnectorOrigin(
      connector.api_root,
      `Connector "${connectorName}" GitHub API root`,
      status
    );
  }
}

function validateConfigRoot(config, status, { allowHydratedRemote = false } = {}) {
  const fail = (message) => {
    throw contentError(status, message);
  };
  const assertKey = (value, context) => {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
      fail(`${context} must use letters, numbers, underscores, or hyphens.`);
    }
  };

  if (!isMapping(config)) fail("cms.config.yml must contain a mapping.");
  if (Object.hasOwn(config, "backend")) {
    fail("cms.config.yml uses connectors; the singular backend setting is not supported.");
  }
  if (!isMapping(config.connectors)) {
    fail("cms.config.yml must define connectors as a mapping.");
  }
  if (!Object.hasOwn(config.connectors, "default")) {
    fail('cms.config.yml must define the "default" connector.');
  }
  for (const [connectorName, connector] of Object.entries(config.connectors)) {
    assertKey(connectorName, `Connector "${connectorName}"`);
    validateConnector(connector, connectorName, status);
  }
  if (!isMapping(config.collections)) {
    fail("cms.config.yml must define collections as a mapping.");
  }
  if (!isMapping(config.node_types)) {
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
    if (!isMapping(type)) {
      fail(`Node type "${typeName}" must be a mapping.`);
    }
    const remote =
      Object.hasOwn(type, "connector") || Object.hasOwn(type, "remote_type");
    if (!remote) {
      if (!isMapping(type.fields)) {
        fail(`Node type "${typeName}" must define fields as a mapping.`);
      }
      continue;
    }
    if (
      typeof type.connector !== "string" ||
      !type.connector ||
      typeof type.remote_type !== "string" ||
      !type.remote_type
    ) {
      fail(
        `Remote node type "${typeName}" must define connector and remote_type.`
      );
    }
    assertKey(type.connector, `Remote node type "${typeName}" connector`);
    assertKey(type.remote_type, `Remote node type "${typeName}" remote_type`);
    if (!config.connectors[type.connector]) {
      fail(
        `Remote node type "${typeName}" references unknown connector "${type.connector}".`
      );
    }
    if (["default", "development"].includes(type.connector)) {
      fail(
        `Remote node type "${typeName}" must use a named connector, not reserved connector "${type.connector}".`
      );
    }
    if (!allowHydratedRemote) {
      const extra = Object.keys(type).filter(
        (name) => !["connector", "remote_type"].includes(name)
      );
      if (extra.length) {
        fail(
          `Remote node type "${typeName}" may define only connector and remote_type.`
        );
      }
    } else if (!isMapping(type.fields)) {
      fail(`Remote node type "${typeName}" has not been materialized.`);
    }
  }

  for (const [collectionName, collection] of Object.entries(config.collections)) {
    assertKey(collectionName, `Collection "${collectionName}"`);
    if (!isMapping(collection)) {
      fail(`Collection "${collectionName}" must be a mapping.`);
    }
    const remote =
      Object.hasOwn(collection, "connector") ||
      Object.hasOwn(collection, "remote_collection");
    if (!remote) {
      if (typeof collection.folder !== "string" || !collection.folder) {
        fail(`Collection "${collectionName}" must define a folder.`);
      }
      if (typeof collection.node_type !== "string" || !collection.node_type) {
        fail(`Collection "${collectionName}" must define a node_type.`);
      }
      continue;
    }
    if (
      typeof collection.connector !== "string" ||
      !collection.connector ||
      typeof collection.remote_collection !== "string" ||
      !collection.remote_collection
    ) {
      fail(
        `Remote collection "${collectionName}" must define connector and remote_collection.`
      );
    }
    assertKey(
      collection.connector,
      `Remote collection "${collectionName}" connector`
    );
    assertKey(
      collection.remote_collection,
      `Remote collection "${collectionName}" remote_collection`
    );
    if (!config.connectors[collection.connector]) {
      fail(
        `Remote collection "${collectionName}" references unknown connector "${collection.connector}".`
      );
    }
    if (["default", "development"].includes(collection.connector)) {
      fail(
        `Remote collection "${collectionName}" must use a named connector, not reserved connector "${collection.connector}".`
      );
    }
    if (!allowHydratedRemote) {
      const extra = Object.keys(collection).filter(
        (name) => !["connector", "remote_collection"].includes(name)
      );
      if (extra.length) {
        fail(
          `Remote collection "${collectionName}" may define only connector and remote_collection.`
        );
      }
    } else if (
      typeof collection.folder !== "string" ||
      !collection.folder ||
      typeof collection.node_type !== "string" ||
      !collection.node_type
    ) {
      fail(`Remote collection "${collectionName}" has not been materialized.`);
    }
  }
  return config;
}

function validateSourceConfig(config, status = 500) {
  return validateConfig(config, status, { source: true });
}

function validateConfig(config, status = 500, { source = false } = {}) {
  const fail = (message) => {
    throw contentError(status, message);
  };
  const assertKey = (value, context) => {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
      fail(`${context} must use letters, numbers, underscores, or hyphens.`);
    }
  };

  validateConfigRoot(config, status, { allowHydratedRemote: !source });

  for (const [typeName, type] of Object.entries(config.node_types)) {
    if (source && Object.hasOwn(type, "remote_type")) continue;
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
        if (
          (type.connector || "default") !==
          (config.node_types[allowedType].connector || "default")
        ) {
          fail(
            `Node type "${typeName}" slot "${slotName}" cannot contain node type "${allowedType}" from another connector.`
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
    if (source && Object.hasOwn(collection, "remote_collection")) continue;
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
      (collection.connector || "default") !==
      (config.node_types[collection.node_type].connector || "default")
    ) {
      fail(
        `Collection "${collectionName}" cannot use node type "${collection.node_type}" from another connector.`
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
      if (
        (collection.connector || "default") !==
        (config.node_types[allowedType].connector || "default")
      ) {
        fail(
          `Collection "${collectionName}" cannot allow node type "${allowedType}" from another connector.`
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
      if (
        (collection.connector || "default") !==
        (config.node_types[childType].connector || "default")
      ) {
        fail(
          `Collection "${collectionName}" hierarchy cannot allow node type "${childType}" from another connector.`
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

  const collectionFoldersByConnector = new Map();
  for (const [collectionName, collection] of Object.entries(
    config.collections
  )) {
    if (source && Object.hasOwn(collection, "remote_collection")) continue;
    const connector = collection.connector || "default";
    const folder = assertContentPath(
      collection.folder,
      `Collection "${collectionName}" folder`,
      status
    );
    if (folder === "content") {
      fail(`Collection "${collectionName}" folder must be below content/.`);
    }
    const configured = collectionFoldersByConnector.get(connector) ?? [];
    for (const existing of configured) {
      if (
        folder === existing.folder ||
        folder.startsWith(`${existing.folder}/`) ||
        existing.folder.startsWith(`${folder}/`)
      ) {
        fail(
          `Collection "${collectionName}" folder overlaps collection "${existing.name}" folder on connector "${connector}".`
        );
      }
    }
    configured.push({ name: collectionName, folder });
    collectionFoldersByConnector.set(connector, configured);
  }

  const mediaFolder = assertContentPath(
    config.site?.media_folder || "content/media",
    "site.media_folder",
    status
  );
  if (mediaFolder === "content") {
    fail("site.media_folder must be below content/.");
  }
  for (const collection of collectionFoldersByConnector.get("default") ?? []) {
    if (
      mediaFolder === collection.folder ||
      mediaFolder.startsWith(`${collection.folder}/`) ||
      collection.folder.startsWith(`${mediaFolder}/`)
    ) {
      fail(
        `site.media_folder overlaps collection "${collection.name}" folder.`
      );
    }
  }
  const imageCache = config.site?.image_processing?.cache;
  if (isMapping(imageCache)) {
    delete imageCache.strategy;
    delete imageCache.max_age;
  }
  try {
    validateImageProcessingConfig(config);
  } catch (error) {
    fail(error.message);
  }

  for (const [typeName, type] of Object.entries(config.node_types)) {
    if (source && Object.hasOwn(type, "remote_type")) continue;
    for (const [fieldName, field] of Object.entries(type.fields)) {
      const inlineReference = field.blocknote?.inline_reference;
      if (inlineReference) {
        const targetCollection = config.collections[inlineReference.collection];
        if (!targetCollection) {
          fail(
            `Node type "${typeName}" markdown field "${fieldName}" inline reference uses unknown collection "${inlineReference.collection}".`
          );
        }
        if (source && Object.hasOwn(targetCollection, "remote_collection")) {
          continue;
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
      if (source && Object.hasOwn(targetCollection, "remote_collection")) {
        if (
          field.widget === "tags" &&
          (field.value_field !== undefined || field.allowed_types !== undefined)
        ) {
          fail(
            `Node type "${typeName}" tags field "${fieldName}" may configure only its collection relation.`
          );
        }
        if (
          field.widget === "reference" &&
          field.allowed_types !== undefined &&
          !Array.isArray(field.allowed_types)
        ) {
          fail(
            `Node type "${typeName}" reference field "${fieldName}" allowed_types must be an array.`
          );
        }
        if (
          field.widget === "reference" &&
          field.selections !== undefined &&
          !Array.isArray(field.selections)
        ) {
          fail(
            `Node type "${typeName}" reference field "${fieldName}" selections must be an array.`
          );
        }
        const seenSelections = new Set();
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
        }
        continue;
      }
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
  validateSourceConfig,
  validateRecord
};
