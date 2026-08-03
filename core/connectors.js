import {
  contentError,
  validateConfig,
  validateSourceConfig
} from "./content.js";
import {
  buildInlineReferenceUrl,
  parseInlineReferenceUrl
} from "./inline-reference.js";

function isMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isMapping(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [name, cloneValue(entry)])
  );
}

function isRemoteNodeType(value) {
  return (
    isMapping(value) &&
    typeof value.connector === "string" &&
    Boolean(value.connector) &&
    typeof value.remote_type === "string" &&
    Boolean(value.remote_type)
  );
}

function isRemoteCollection(value) {
  return (
    isMapping(value) &&
    typeof value.connector === "string" &&
    Boolean(value.connector) &&
    typeof value.remote_collection === "string" &&
    Boolean(value.remote_collection)
  );
}

function skipCodeSpan(markdown, start) {
  let size = 1;
  while (markdown[start + size] === "`") size += 1;
  const delimiter = "`".repeat(size);
  const end = markdown.indexOf(delimiter, start + size);
  return end === -1 ? markdown.length : end + size;
}

function closingLabelBracket(markdown, start) {
  let depth = 1;
  for (let cursor = start; cursor < markdown.length; cursor += 1) {
    if (markdown[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (markdown[cursor] === "`") {
      cursor = skipCodeSpan(markdown, cursor) - 1;
      continue;
    }
    if (markdown[cursor] === "[") depth += 1;
    if (markdown[cursor] !== "]") continue;
    depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
}

function translateInlineReferences(markdown, collectionNames) {
  if (typeof markdown !== "string" || !markdown || !isMapping(collectionNames)) {
    return markdown;
  }
  const replacements = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    if (markdown[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (markdown[cursor] === "`") {
      cursor = skipCodeSpan(markdown, cursor);
      continue;
    }
    if (markdown[cursor] !== "[" || markdown[cursor - 1] === "!") {
      cursor += 1;
      continue;
    }
    const labelEnd = closingLabelBracket(markdown, cursor + 1);
    if (labelEnd === -1 || markdown[labelEnd + 1] !== "(") {
      cursor += 1;
      continue;
    }
    let destinationStart = labelEnd + 2;
    while (/[ \t\n\r]/.test(markdown[destinationStart] ?? "")) {
      destinationStart += 1;
    }
    const angled = markdown[destinationStart] === "<";
    if (angled) destinationStart += 1;
    let destinationEnd = destinationStart;
    while (
      destinationEnd < markdown.length &&
      (angled
        ? markdown[destinationEnd] !== ">"
        : !/[\s)]/.test(markdown[destinationEnd]))
    ) {
      destinationEnd += 1;
    }
    const afterDestination = angled ? destinationEnd + 1 : destinationEnd;
    if (
      destinationEnd === destinationStart ||
      (angled && markdown[destinationEnd] !== ">") ||
      markdown[afterDestination] !== ")"
    ) {
      cursor = labelEnd + 1;
      continue;
    }
    const reference = parseInlineReferenceUrl(
      markdown.slice(destinationStart, destinationEnd)
    );
    const nextCollection = reference
      ? collectionNames[reference.collection]
      : null;
    if (reference && nextCollection) {
      replacements.push({
        start: destinationStart,
        end: destinationEnd,
        value: buildInlineReferenceUrl(nextCollection, reference.ref)
      });
    }
    cursor = afterDestination + 1;
  }
  if (!replacements.length) return markdown;
  let translated = markdown;
  for (const replacement of replacements.reverse()) {
    translated =
      translated.slice(0, replacement.start) +
      replacement.value +
      translated.slice(replacement.end);
  }
  return translated;
}

function translateRecord(record, connectorRoute, direction) {
  if (!isMapping(record)) {
    throw new TypeError("translateRecord requires a record mapping.");
  }
  if (!isMapping(connectorRoute)) {
    throw new TypeError("translateRecord requires connector routes.");
  }
  if (!["local_to_remote", "remote_to_local"].includes(direction)) {
    throw new TypeError(
      'translateRecord direction must be "local_to_remote" or "remote_to_local".'
    );
  }
  const typeNames = connectorRoute.node_types?.[direction];
  const collectionNames = connectorRoute.collections?.[direction];
  if (!isMapping(typeNames) || !isMapping(collectionNames)) {
    throw new TypeError("translateRecord received incomplete connector routes.");
  }

  function translateNode(node) {
    if (!isMapping(node)) return cloneValue(node);
    const translatedType = typeNames[node.type];
    if (typeof translatedType !== "string" || !translatedType) {
      throw new Error(
        `Node type "${node.type ?? ""}" has no ${direction.replaceAll("_", " ")} route.`
      );
    }
    const translated = cloneValue(node);
    translated.type = translatedType;
    if (isMapping(translated.properties)) {
      translated.properties = Object.fromEntries(
        Object.entries(translated.properties).map(([name, value]) => [
          name,
          typeof value === "string"
            ? translateInlineReferences(value, collectionNames)
            : value
        ])
      );
    }
    if (isMapping(translated.slots)) {
      translated.slots = Object.fromEntries(
        Object.entries(translated.slots).map(([name, children]) => [
          name,
          Array.isArray(children)
            ? children.map(translateNode)
            : cloneValue(children)
        ])
      );
    }
    return translated;
  }

  return translateNode(record);
}

function connectorRoutes() {
  return {
    collections: {
      local_to_remote: {},
      remote_to_local: {}
    },
    node_types: {
      local_to_remote: {},
      remote_to_local: {}
    }
  };
}

function addRoute(routes, kind, localName, connector, remoteName, status) {
  routes[kind][localName] = {
    connector,
    [kind === "collections" ? "remote_collection" : "remote_type"]:
      remoteName
  };
  routes.connectors[connector] ??= connectorRoutes();
  const group = routes.connectors[connector][kind];
  const existing = group.remote_to_local[remoteName];
  if (existing && existing !== localName) {
    const label = kind === "collections" ? "collection" : "node type";
    throw contentError(
      status,
      `Connector "${connector}" remote ${label} "${remoteName}" is aliased by both "${existing}" and "${localName}".`
    );
  }
  group.local_to_remote[localName] = remoteName;
  group.remote_to_local[remoteName] = localName;
}

function translatedDependency(routes, kind, remoteName, context, status) {
  const localName = routes[kind].remote_to_local[remoteName];
  if (!localName) {
    const label = kind === "collections" ? "collection" : "node type";
    throw contentError(
      status,
      `${context} depends on remote ${label} "${remoteName}", which has no explicit local alias.`
    );
  }
  return localName;
}

function translateRemoteType(type, route, context, status) {
  const translated = cloneValue(type);
  for (const [slotName, slot] of Object.entries(translated.slots ?? {})) {
    if (!Array.isArray(slot?.allowed_types)) continue;
    slot.allowed_types = slot.allowed_types.map((remoteType) =>
      translatedDependency(
        route,
        "node_types",
        remoteType,
        `${context} slot "${slotName}"`,
        status
      )
    );
  }
  for (const [fieldName, field] of Object.entries(translated.fields ?? {})) {
    if (field?.widget === "reference" || field?.widget === "tags") {
      field.collection = translatedDependency(
        route,
        "collections",
        field.collection,
        `${context} field "${fieldName}"`,
        status
      );
    }
    if (Array.isArray(field?.allowed_types)) {
      field.allowed_types = field.allowed_types.map((remoteType) =>
        translatedDependency(
          route,
          "node_types",
          remoteType,
          `${context} field "${fieldName}"`,
          status
        )
      );
    }
    const inlineReference = field?.blocknote?.inline_reference;
    if (isMapping(inlineReference)) {
      inlineReference.collection = translatedDependency(
        route,
        "collections",
        inlineReference.collection,
        `${context} field "${fieldName}" inline reference`,
        status
      );
    }
  }
  return translated;
}

function translateRemoteCollection(collection, route, context, status) {
  const translated = cloneValue(collection);
  translated.node_type = translatedDependency(
    route,
    "node_types",
    translated.node_type,
    context,
    status
  );
  if (Array.isArray(translated.allowed_types)) {
    translated.allowed_types = translated.allowed_types.map((remoteType) =>
      translatedDependency(
        route,
        "node_types",
        remoteType,
        context,
        status
      )
    );
  }
  if (Array.isArray(translated.hierarchy?.allowed_child_types)) {
    translated.hierarchy.allowed_child_types =
      translated.hierarchy.allowed_child_types.map((remoteType) =>
        translatedDependency(
          route,
          "node_types",
          remoteType,
          `${context} hierarchy`,
          status
        )
      );
  }
  return translated;
}

function collapseConfig(effectiveConfig, status = 500) {
  const collapsed = cloneValue(effectiveConfig);
  for (const [name, type] of Object.entries(collapsed.node_types ?? {})) {
    if (
      Object.hasOwn(type ?? {}, "connector") ||
      Object.hasOwn(type ?? {}, "remote_type")
    ) {
      collapsed.node_types[name] = {
        connector: type?.connector,
        remote_type: type?.remote_type
      };
    }
  }
  for (const [name, collection] of Object.entries(
    collapsed.collections ?? {}
  )) {
    if (
      Object.hasOwn(collection ?? {}, "connector") ||
      Object.hasOwn(collection ?? {}, "remote_collection")
    ) {
      collapsed.collections[name] = {
        connector: collection?.connector,
        remote_collection: collection?.remote_collection
      };
    }
  }
  return validateSourceConfig(collapsed, status);
}

function materializeConfig({ sourceConfig, remoteConfigs = {}, status = 500 } = {}) {
  const source = cloneValue(sourceConfig);
  validateSourceConfig(source, status);
  if (!isMapping(remoteConfigs)) {
    throw contentError(status, "remoteConfigs must be a mapping.");
  }

  const routes = {
    collections: {},
    node_types: {},
    connectors: {}
  };
  for (const typeName of Object.keys(source.node_types)) {
    const type = source.node_types[typeName];
    const connector = type.connector ?? "default";
    const remoteType = type.remote_type ?? typeName;
    addRoute(routes, "node_types", typeName, connector, remoteType, status);
  }
  for (const collectionName of Object.keys(source.collections)) {
    const collection = source.collections[collectionName];
    const connector = collection.connector ?? "default";
    const remoteCollection = collection.remote_collection ?? collectionName;
    addRoute(
      routes,
      "collections",
      collectionName,
      connector,
      remoteCollection,
      status
    );
  }

  const requiredConnectors = new Set([
    ...Object.values(source.node_types)
      .map((type) => type.connector)
      .filter(Boolean),
    ...Object.values(source.collections)
      .map((collection) => collection.connector)
      .filter(Boolean)
  ]);
  const validatedRemoteConfigs = {};
  for (const connector of requiredConnectors) {
    if (["default", "development"].includes(connector)) {
      throw contentError(
        status,
        `Remote aliases must use a named connector, not the reserved "${connector}" connector.`
      );
    }
    if (!Object.hasOwn(remoteConfigs, connector)) {
      throw contentError(
        status,
        `Remote connector "${connector}" configuration was not provided.`
      );
    }
    const remoteConfig = cloneValue(remoteConfigs[connector]);
    validateConfig(remoteConfig, status);
    validatedRemoteConfigs[connector] = remoteConfig;
  }

  const effective = cloneValue(source);
  for (const [localName, declaration] of Object.entries(source.node_types)) {
    if (!declaration.connector) continue;
    const remoteConfig = validatedRemoteConfigs[declaration.connector];
    const remoteType = remoteConfig.node_types?.[declaration.remote_type];
    if (!remoteType) {
      throw contentError(
        status,
        `Connector "${declaration.connector}" has no node type "${declaration.remote_type}" for alias "${localName}".`
      );
    }
    if (remoteType.connector || remoteType.remote_type) {
      throw contentError(
        status,
        `Connector "${declaration.connector}" node type "${declaration.remote_type}" must be owned by that remote project.`
      );
    }
    const translated = translateRemoteType(
      remoteType,
      routes.connectors[declaration.connector],
      `Remote node type "${localName}"`,
      status
    );
    effective.node_types[localName] = {
      connector: declaration.connector,
      remote_type: declaration.remote_type,
      ...translated
    };
  }

  for (const [localName, declaration] of Object.entries(source.collections)) {
    if (!declaration.connector) continue;
    const remoteConfig = validatedRemoteConfigs[declaration.connector];
    const remoteCollection =
      remoteConfig.collections?.[declaration.remote_collection];
    if (!remoteCollection) {
      throw contentError(
        status,
        `Connector "${declaration.connector}" has no collection "${declaration.remote_collection}" for alias "${localName}".`
      );
    }
    if (remoteCollection.connector || remoteCollection.remote_collection) {
      throw contentError(
        status,
        `Connector "${declaration.connector}" collection "${declaration.remote_collection}" must be owned by that remote project.`
      );
    }
    const translated = translateRemoteCollection(
      remoteCollection,
      routes.connectors[declaration.connector],
      `Remote collection "${localName}"`,
      status
    );
    effective.collections[localName] = {
      connector: declaration.connector,
      remote_collection: declaration.remote_collection,
      ...translated
    };
  }

  const config = validateConfig(effective, status);
  return {
    config,
    sourceConfig: collapseConfig(config, status),
    routes
  };
}

export {
  collapseConfig,
  isRemoteCollection,
  isRemoteNodeType,
  materializeConfig,
  translateInlineReferences,
  translateRecord,
  validateSourceConfig
};
