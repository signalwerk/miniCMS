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

function translatedDependency(
  routes,
  kind,
  name,
  direction,
  context,
  status
) {
  const translatedName = routes[kind]?.[direction]?.[name];
  if (!translatedName) {
    const label = kind === "collections" ? "collection" : "node type";
    const source = direction === "remote_to_local" ? "remote" : "local";
    throw contentError(
      status,
      `${context} depends on ${source} ${label} "${name}", which has no explicit ${direction === "remote_to_local" ? "local alias" : "remote route"}.`
    );
  }
  return translatedName;
}

function translateTypeDefinition(type, route, direction, context, status) {
  const translated = cloneValue(type);
  if (direction === "local_to_remote") {
    delete translated.connector;
    delete translated.remote_type;
  }
  for (const [slotName, slot] of Object.entries(translated.slots ?? {})) {
    if (!Array.isArray(slot?.allowed_types)) continue;
    slot.allowed_types = slot.allowed_types.map((typeName) =>
      translatedDependency(
        route,
        "node_types",
        typeName,
        direction,
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
        direction,
        `${context} field "${fieldName}"`,
        status
      );
    }
    if (Array.isArray(field?.allowed_types)) {
      field.allowed_types = field.allowed_types.map((typeName) =>
        translatedDependency(
          route,
          "node_types",
          typeName,
          direction,
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
        direction,
        `${context} field "${fieldName}" inline reference`,
        status
      );
    }
  }
  return translated;
}

function translateCollectionDefinition(
  collection,
  route,
  direction,
  context,
  status
) {
  const translated = cloneValue(collection);
  if (direction === "local_to_remote") {
    delete translated.connector;
    delete translated.remote_collection;
  }
  translated.node_type = translatedDependency(
    route,
    "node_types",
    translated.node_type,
    direction,
    context,
    status
  );
  if (Array.isArray(translated.allowed_types)) {
    translated.allowed_types = translated.allowed_types.map((typeName) =>
      translatedDependency(
        route,
        "node_types",
        typeName,
        direction,
        context,
        status
      )
    );
  }
  if (Array.isArray(translated.hierarchy?.allowed_child_types)) {
    translated.hierarchy.allowed_child_types =
      translated.hierarchy.allowed_child_types.map((typeName) =>
        translatedDependency(
          route,
          "node_types",
          typeName,
          direction,
          `${context} hierarchy`,
          status
        )
      );
  }
  return translated;
}

function buildRoutes(source, status) {
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
  return routes;
}

function requiredConnectorNames(source) {
  return new Set([
    ...Object.values(source.node_types)
      .map((type) => type.connector)
      .filter(Boolean),
    ...Object.values(source.collections)
      .map((collection) => collection.connector)
      .filter(Boolean)
  ]);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameRemoteOwner(current, next, remoteKey) {
  return (
    isMapping(current) &&
    current.connector === next.connector &&
    current[remoteKey] === next[remoteKey]
  );
}

function hasDefinitionBody(definition, remoteKey) {
  return Object.keys(definition ?? {}).some(
    (key) => !["connector", remoteKey].includes(key)
  );
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

  const routes = buildRoutes(source, status);
  const requiredConnectors = requiredConnectorNames(source);
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
    validateSourceConfig(remoteConfig, status);
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
    const translated = translateTypeDefinition(
      remoteType,
      routes.connectors[declaration.connector],
      "remote_to_local",
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
    const translated = translateCollectionDefinition(
      remoteCollection,
      routes.connectors[declaration.connector],
      "remote_to_local",
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

function planConfigWrites({
  effectiveConfig,
  sourceConfig,
  ownershipSourceConfig = sourceConfig,
  remoteConfigs = {},
  status = 500
} = {}) {
  const currentSource = cloneValue(sourceConfig);
  validateSourceConfig(currentSource, status);
  const currentOwnershipSource = cloneValue(ownershipSourceConfig);
  validateSourceConfig(currentOwnershipSource, status);
  if (!isMapping(remoteConfigs)) {
    throw contentError(status, "remoteConfigs must be a mapping.");
  }

  const nextSource = collapseConfig(effectiveConfig, status);
  const routes = buildRoutes(nextSource, status);
  const nextRemoteConfigs = { ...remoteConfigs };
  const changedConnectors = [];

  for (const connector of requiredConnectorNames(nextSource)) {
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

    const currentRemote = cloneValue(remoteConfigs[connector]);
    validateSourceConfig(currentRemote, status);
    const nextRemote = cloneValue(currentRemote);
    const connectorRoute = routes.connectors[connector];

    for (const [localName, declaration] of Object.entries(
      nextSource.node_types
    )) {
      if (declaration.connector !== connector) continue;
      const draft = effectiveConfig.node_types?.[localName];
      if (!hasDefinitionBody(draft, "remote_type")) continue;
      const currentDeclaration =
        currentOwnershipSource.node_types?.[localName];
      if (
        isRemoteNodeType(currentDeclaration) &&
        !sameRemoteOwner(
          currentDeclaration,
          declaration,
          "remote_type"
        )
      ) {
        throw contentError(
          status,
          `Remote node type "${localName}" cannot change its connector or remote type identity.`
        );
      }
      const previouslyOwned = sameRemoteOwner(
        currentDeclaration,
        declaration,
        "remote_type"
      );
      const existing = currentRemote.node_types?.[declaration.remote_type];
      if (existing && !previouslyOwned) {
        throw contentError(
          status,
          `Connector "${connector}" already has node type "${declaration.remote_type}". Import it with an alias instead of overwriting it.`
        );
      }
      nextRemote.node_types[declaration.remote_type] =
        translateTypeDefinition(
          draft,
          connectorRoute,
          "local_to_remote",
          `Remote node type "${localName}"`,
          status
        );
    }

    for (const [localName, declaration] of Object.entries(
      nextSource.collections
    )) {
      if (declaration.connector !== connector) continue;
      const draft = effectiveConfig.collections?.[localName];
      if (!hasDefinitionBody(draft, "remote_collection")) continue;
      const currentDeclaration =
        currentOwnershipSource.collections?.[localName];
      if (
        isRemoteCollection(currentDeclaration) &&
        !sameRemoteOwner(
          currentDeclaration,
          declaration,
          "remote_collection"
        )
      ) {
        throw contentError(
          status,
          `Remote collection "${localName}" cannot change its connector or remote collection identity.`
        );
      }
      const previouslyOwned = sameRemoteOwner(
        currentDeclaration,
        declaration,
        "remote_collection"
      );
      const existing =
        currentRemote.collections?.[declaration.remote_collection];
      if (existing && !previouslyOwned) {
        throw contentError(
          status,
          `Connector "${connector}" already has collection "${declaration.remote_collection}". Import it with an alias instead of overwriting it.`
        );
      }
      nextRemote.collections[declaration.remote_collection] =
        translateCollectionDefinition(
          draft,
          connectorRoute,
          "local_to_remote",
          `Remote collection "${localName}"`,
          status
        );
    }

    validateSourceConfig(nextRemote, status);
    nextRemoteConfigs[connector] = nextRemote;
    if (!sameValue(currentRemote, nextRemote)) {
      changedConnectors.push(connector);
    }
  }

  const materialized = materializeConfig({
    sourceConfig: nextSource,
    remoteConfigs: nextRemoteConfigs,
    status
  });
  return {
    ...materialized,
    remoteConfigs: nextRemoteConfigs,
    changedConnectors,
    sourceChanged: !sameValue(currentSource, nextSource)
  };
}

export {
  collapseConfig,
  isRemoteCollection,
  isRemoteNodeType,
  materializeConfig,
  planConfigWrites,
  translateInlineReferences,
  translateRecord,
  validateSourceConfig
};
