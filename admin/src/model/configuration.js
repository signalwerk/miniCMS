import { translateInlineReferences } from "../../../core/connectors.js";
import { isInternalLinkCollectionCompatible } from "../../../core/content.js";

const SCHEMA_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

const SCHEMA_SECTIONS = new Set(["node_types", "collections"]);
const SLOT_DEFAULT_PROPERTY_WIDGETS = new Set([
  "string",
  "text",
  "url",
  "markdown",
  "select",
  "boolean",
  "datetime",
  "number"
]);
function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionValue(option) {
  return isMapping(option) ? option.value : option;
}

function validSlotDefaultProperty(field, value) {
  if (!SLOT_DEFAULT_PROPERTY_WIDGETS.has(field?.widget)) return false;
  if (["string", "text", "url", "markdown", "datetime"].includes(field.widget)) {
    return typeof value === "string";
  }
  if (field.widget === "boolean") return typeof value === "boolean";
  if (field.widget === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  return (field.options ?? []).some((option) => Object.is(
    optionValue(option),
    value
  ));
}

function reconcileSlotDefaultTemplates(config) {
  for (const type of Object.values(config.node_types ?? {})) {
    for (const slot of Object.values(type.slots ?? {})) {
      if (!Array.isArray(slot.default)) continue;
      const allowedTypes = new Set(slot.allowed_types ?? []);
      slot.default = slot.default.flatMap((template) => {
        if (
          !isMapping(template) ||
          !allowedTypes.has(template.type) ||
          !config.node_types?.[template.type]
        ) {
          return [];
        }
        const nextTemplate = { type: template.type };
        const fields = config.node_types[template.type].fields ?? {};
        const properties = Object.fromEntries(
          Object.entries(template.properties ?? {}).filter(
            ([name, value]) => validSlotDefaultProperty(fields[name], value)
          )
        );
        if (Object.keys(properties).length) nextTemplate.properties = properties;
        return [nextTemplate];
      });
      if (Number.isInteger(slot.max) && slot.max >= 1) {
        slot.default = slot.default.slice(0, slot.max);
      }
      if (!slot.default.length) delete slot.default;
    }
  }
  return config;
}

function reconcileMarkdownInternalLinks(config) {
  const collectionKeys = new Set(Object.keys(config.collections ?? {}));
  for (const type of Object.values(config.node_types ?? {})) {
    for (const field of Object.values(type.fields ?? {})) {
      const internalLinks = field.blocknote?.internal_links;
      if (!internalLinks) continue;
      const seen = new Set();
      const collections = (Array.isArray(internalLinks.collections)
        ? internalLinks.collections
        : []
      ).filter((collection) => {
        if (
          typeof collection !== "string" ||
          !collection ||
          !collectionKeys.has(collection) ||
          seen.has(collection)
        ) {
          return false;
        }
        seen.add(collection);
        return true;
      });
      if (collections.length) {
        internalLinks.collections = collections;
        continue;
      }
      delete field.blocknote.internal_links;
      if (!Object.keys(field.blocknote).length) delete field.blocknote;
    }
  }
  return config;
}

function internalLinkCollectionEntries(config) {
  return Object.entries(config.collections ?? {}).filter(([collectionName]) =>
    isInternalLinkCollectionCompatible(config, collectionName)
  );
}

function assertSection(section) {
  if (!SCHEMA_SECTIONS.has(section)) {
    throw new Error(`Unsupported schema section "${section}".`);
  }
}

function createSchemaOperations() {
  return {
    schemaRenames: {
      node_types: {},
      collections: {}
    },
    freshEntries: {
      node_types: {},
      collections: {}
    },
    retiredEntries: {
      node_types: {},
      collections: {}
    }
  };
}

function createContentTypeDefinition({
  key,
  label,
  connector = "default"
}) {
  return {
    ...(connector !== "default"
      ? { connector, remote_type: key }
      : {}),
    label,
    kind: "content",
    icon: "file-text",
    fields: {
      content_id: {
        label: "ID",
        widget: "id",
        readonly: true,
        required: true
      },
      title: {
        label: "Title",
        widget: "string",
        required: true
      }
    }
  };
}

function normalizedOperations(operations) {
  const next = createSchemaOperations();
  for (const section of SCHEMA_SECTIONS) {
    Object.assign(
      next.schemaRenames[section],
      operations?.schemaRenames?.[section] ?? {}
    );
    Object.assign(
      next.freshEntries[section],
      operations?.freshEntries?.[section] ?? {}
    );
    Object.assign(
      next.retiredEntries[section],
      operations?.retiredEntries?.[section] ?? {}
    );
  }
  return next;
}

function normalizedFolder(folder) {
  return String(folder || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");
}

function siblingFolder(folder, key) {
  const normalized = normalizedFolder(folder);
  const separator = normalized.lastIndexOf("/");
  return separator === -1
    ? key
    : `${normalized.slice(0, separator)}/${key}`;
}

function pathsOverlap(first, second) {
  return (
    first === second ||
    first.startsWith(`${second}/`) ||
    second.startsWith(`${first}/`)
  );
}

function collectionFolderConflict(config, currentKey, folder, connector) {
  const candidate = normalizedFolder(folder);
  for (const [key, collection] of Object.entries(config.collections ?? {})) {
    if (key === currentKey) continue;
    if ((collection.connector || "default") !== connector) continue;
    const existing = normalizedFolder(collection.folder);
    if (candidate && existing && pathsOverlap(candidate, existing)) {
      return `The folder “${candidate}” conflicts with collection “${key}”.`;
    }
  }
  const mediaFolder = normalizedFolder(config.site?.media_folder);
  if (
    connector === "default" &&
    candidate &&
    mediaFolder &&
    pathsOverlap(candidate, mediaFolder)
  ) {
    return `The folder “${candidate}” conflicts with the project media folder.`;
  }
  return "";
}

function remoteIdentityConflict(config, section, currentKey, identity, connector) {
  const property = section === "collections"
    ? "remote_collection"
    : "remote_type";
  for (const [key, definition] of Object.entries(config[section] ?? {})) {
    if (key === currentKey) continue;
    if (definition.connector !== connector) continue;
    if ((definition[property] || key) === identity) {
      return `The remote key “${identity}” is already used by “${key}”.`;
    }
  }
  return "";
}

function schemaRenameError(
  config,
  operations,
  section,
  currentKey,
  requestedKey
) {
  assertSection(section);
  const key = String(requestedKey ?? "").trim();
  if (!key) return "Enter a key.";
  if (!SCHEMA_KEY_PATTERN.test(key)) {
    return "Use letters, numbers, underscores, or hyphens, starting with a letter or number.";
  }
  if (key === currentKey) return "";
  if (Object.hasOwn(config[section] ?? {}, key)) {
    return `The key “${key}” already exists.`;
  }

  const state = normalizedOperations(operations);
  if (Object.hasOwn(state.retiredEntries[section], key)) {
    return `The key “${key}” is reserved until the pending deletion is saved.`;
  }
  const ownOrigin = Object.entries(state.schemaRenames[section]).find(
    ([, destination]) => destination === currentKey
  )?.[0];
  if (
    Object.hasOwn(state.schemaRenames[section], key) &&
    key !== ownOrigin
  ) {
    return `The key “${key}” is reserved by another pending rename.`;
  }

  const definition = config[section]?.[currentKey];
  if (!definition) return `The key “${currentKey}” no longer exists.`;
  const fresh = Boolean(state.freshEntries[section][currentKey]);
  if (fresh && definition.connector) {
    const identityError = remoteIdentityConflict(
      config,
      section,
      currentKey,
      key,
      definition.connector
    );
    if (identityError) return identityError;
  }
  if (section === "collections" && (!definition.connector || fresh)) {
    return collectionFolderConflict(
      config,
      currentKey,
      siblingFolder(definition.folder, key),
      definition.connector || "default"
    );
  }
  return "";
}

function replaceMappingKey(mapping, currentKey, nextKey, value) {
  return Object.fromEntries(
    Object.entries(mapping ?? {}).map(([key, entry]) =>
      key === currentKey ? [nextKey, value] : [key, entry]
    )
  );
}

function insertMappingEntryAfter(mapping, sourceKey, key, value) {
  const entries = [];
  for (const [candidateKey, candidate] of Object.entries(mapping ?? {})) {
    entries.push([candidateKey, candidate]);
    if (candidateKey === sourceKey) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

function replaceArrayValue(values, currentKey, nextKey) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => value === currentKey ? nextKey : value);
}

function rewriteNodeTypeDependencies(config, currentKey, nextKey) {
  for (const collection of Object.values(config.collections ?? {})) {
    if (collection.node_type === currentKey) {
      collection.node_type = nextKey;
    }
    if (collection.allowed_types) {
      collection.allowed_types = replaceArrayValue(
        collection.allowed_types,
        currentKey,
        nextKey
      );
    }
    if (collection.hierarchy?.allowed_child_types) {
      collection.hierarchy.allowed_child_types = replaceArrayValue(
        collection.hierarchy.allowed_child_types,
        currentKey,
        nextKey
      );
    }
  }

  for (const type of Object.values(config.node_types ?? {})) {
    for (const slot of Object.values(type.slots ?? {})) {
      slot.allowed_types = replaceArrayValue(
        slot.allowed_types,
        currentKey,
        nextKey
      );
      for (const template of slot.default ?? []) {
        if (template.type === currentKey) template.type = nextKey;
      }
    }
    for (const field of Object.values(type.fields ?? {})) {
      if (field.widget === "reference" && field.allowed_types) {
        field.allowed_types = replaceArrayValue(
          field.allowed_types,
          currentKey,
          nextKey
        );
      }
    }
  }
}

function rewriteCollectionDependencies(config, currentKey, nextKey) {
  for (const type of Object.values(config.node_types ?? {})) {
    for (const slot of Object.values(type.slots ?? {})) {
      for (const template of slot.default ?? []) {
        for (const [propertyName, value] of Object.entries(
          template.properties ?? {}
        )) {
          if (typeof value !== "string") continue;
          template.properties[propertyName] = translateInlineReferences(
            value,
            { [currentKey]: nextKey }
          );
        }
      }
    }
    for (const field of Object.values(type.fields ?? {})) {
      if (
        ["reference", "tags"].includes(field.widget) &&
        field.collection === currentKey
      ) {
        field.collection = nextKey;
      }
      const inlineReference = field.blocknote?.inline_reference;
      if (
        field.widget === "markdown" &&
        inlineReference?.collection === currentKey
      ) {
        inlineReference.collection = nextKey;
      }
      const internalLinks = field.blocknote?.internal_links;
      if (
        field.widget === "markdown" &&
        Array.isArray(internalLinks?.collections)
      ) {
        internalLinks.collections = replaceArrayValue(
          internalLinks.collections,
          currentKey,
          nextKey
        );
      }
    }
  }
  for (const referenceSet of Object.values(
    config.site?.reference_sets ?? {}
  )) {
    referenceSet.collections = replaceArrayValue(
      referenceSet.collections,
      currentKey,
      nextKey
    );
  }
  reconcileMarkdownInternalLinks(config);
}

function composeRename(renames, currentKey, nextKey) {
  const origin = Object.entries(renames).find(
    ([, destination]) => destination === currentKey
  )?.[0] ?? currentKey;
  if (nextKey === origin) delete renames[origin];
  else renames[origin] = nextKey;
}

function renameSchemaEntry(
  config,
  operations,
  section,
  currentKey,
  requestedKey
) {
  const key = String(requestedKey ?? "").trim();
  const error = schemaRenameError(
    config,
    operations,
    section,
    currentKey,
    key
  );
  if (error) throw new Error(error);
  if (key === currentKey) {
    return { config, operations: normalizedOperations(operations), key };
  }

  const next = structuredClone(config);
  const state = normalizedOperations(operations);
  const definition = next[section][currentKey];
  const fresh = Boolean(state.freshEntries[section][currentKey]);

  if (section === "node_types") {
    if (fresh && definition.connector) definition.remote_type = key;
    next.node_types = replaceMappingKey(
      next.node_types,
      currentKey,
      key,
      definition
    );
    rewriteNodeTypeDependencies(next, currentKey, key);
  } else {
    if (!definition.connector || fresh) {
      definition.folder = siblingFolder(definition.folder, key);
    }
    if (fresh && definition.connector) definition.remote_collection = key;
    next.collections = replaceMappingKey(
      next.collections,
      currentKey,
      key,
      definition
    );
    rewriteCollectionDependencies(next, currentKey, key);
  }

  if (fresh) {
    delete state.freshEntries[section][currentKey];
    state.freshEntries[section][key] = true;
  } else {
    composeRename(state.schemaRenames[section], currentKey, key);
  }
  return { config: next, operations: state, key };
}

function duplicateCandidateError(config, operations, section, sourceKey, key) {
  if (Object.hasOwn(config[section] ?? {}, key)) return true;
  if (Object.hasOwn(operations.retiredEntries[section], key)) return true;
  const source = config[section]?.[sourceKey];
  if (!source) return true;
  if (source.connector) {
    if (
      remoteIdentityConflict(
        config,
        section,
        sourceKey,
        key,
        source.connector
      )
    ) {
      return true;
    }
  }
  if (section === "collections") {
    return Boolean(collectionFolderConflict(
      config,
      sourceKey,
      siblingFolder(source.folder, key),
      source.connector || "default"
    ));
  }
  return false;
}

function duplicateKey(config, operations, section, sourceKey) {
  const base = `${sourceKey}-copy`;
  let suffix = 1;
  while (true) {
    const key = suffix === 1 ? base : `${base}${suffix}`;
    if (!duplicateCandidateError(config, operations, section, sourceKey, key)) {
      return { key, copyNumber: suffix };
    }
    suffix += 1;
  }
}

function labelFromKey(value) {
  const label = String(value || "")
    .replace(/[_-]+/g, " ")
    .trim();
  return label ? label[0].toUpperCase() + label.slice(1) : "Untitled";
}

function copyLabel(value, fallbackKey, copyNumber) {
  const source = String(value || "").trim() || labelFromKey(fallbackKey);
  return `${source} copy${copyNumber === 1 ? "" : ` ${copyNumber}`}`;
}

function duplicateSchemaEntry(config, operations, section, sourceKey) {
  assertSection(section);
  const source = config[section]?.[sourceKey];
  if (!source) throw new Error(`The key “${sourceKey}” no longer exists.`);
  const state = normalizedOperations(operations);
  const { key, copyNumber } = duplicateKey(
    config,
    state,
    section,
    sourceKey
  );
  const definition = structuredClone(source);
  definition.label = copyLabel(source.label, sourceKey, copyNumber);
  if (section === "node_types" && definition.connector) {
    definition.remote_type = key;
  }
  if (section === "collections") {
    definition.label_singular = copyLabel(
      source.label_singular,
      sourceKey,
      copyNumber
    );
    definition.folder = siblingFolder(definition.folder, key);
    if (definition.connector) definition.remote_collection = key;
  }

  const next = structuredClone(config);
  next[section] = insertMappingEntryAfter(
    next[section],
    sourceKey,
    key,
    definition
  );
  state.freshEntries[section][key] = true;
  return { config: next, operations: state, key };
}

function deleteSchemaEntryOperation(operations, section, key) {
  assertSection(section);
  const state = normalizedOperations(operations);
  if (state.freshEntries[section][key]) {
    delete state.freshEntries[section][key];
    return state;
  }
  const origin = Object.entries(state.schemaRenames[section]).find(
    ([, destination]) => destination === key
  )?.[0];
  if (origin) delete state.schemaRenames[section][origin];
  state.retiredEntries[section][origin ?? key] = true;
  return state;
}

function markSchemaEntryFresh(operations, section, key) {
  assertSection(section);
  const state = normalizedOperations(operations);
  state.freshEntries[section][key] = true;
  return state;
}

export {
  SCHEMA_KEY_PATTERN,
  createContentTypeDefinition,
  createSchemaOperations,
  deleteSchemaEntryOperation,
  duplicateSchemaEntry,
  internalLinkCollectionEntries,
  markSchemaEntryFresh,
  reconcileMarkdownInternalLinks,
  renameSchemaEntry,
  reconcileSlotDefaultTemplates,
  schemaRenameError,
  siblingFolder
};
