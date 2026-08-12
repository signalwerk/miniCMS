import {
  assertSafeName,
  contentError,
  validateConfig,
  validateSourceConfig
} from "./content.js";
import { parseContentAddressedMediaPath } from "./image-service.js";
import { imageAssetMediaPath } from "./media.js";
import {
  buildInlineReferenceUrl,
  parseInlineReferenceUrl
} from "./inline-reference.js";
import {
  buildInlineLinkUrl,
  markdownLinkOccurrencesInMarkdown,
  parseInlineLinkUrl
} from "./inline-link.js";

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

function translateInlineReferences(markdown, collectionNames) {
  if (typeof markdown !== "string" || !markdown || !isMapping(collectionNames)) {
    return markdown;
  }
  const replacements = [];
  for (const occurrence of markdownLinkOccurrencesInMarkdown(markdown)) {
    const reference = parseInlineReferenceUrl(occurrence.href);
    const link = parseInlineLinkUrl(occurrence.href);
    const internal = reference ?? link;
    const nextCollection = internal
      ? collectionNames[internal.collection]
      : null;
    if (internal && nextCollection) {
      replacements.push({
        start: occurrence.destinationStart,
        end: occurrence.destinationEnd,
        value: reference
          ? buildInlineReferenceUrl(nextCollection, internal.ref)
          : buildInlineLinkUrl(nextCollection, internal.ref)
      });
    }
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
    if (Array.isArray(slot.default)) {
      slot.default = slot.default.map((template) => ({
        ...template,
        ...(isMapping(template.properties)
          ? {
              properties: Object.fromEntries(
                Object.entries(template.properties).map(([name, value]) => [
                  name,
                  typeof value === "string"
                    ? translateInlineReferences(
                        value,
                        route.collections?.[direction]
                      )
                    : value
                ])
              )
            }
          : {}),
        type: translatedDependency(
          route,
          "node_types",
          template.type,
          direction,
          `${context} slot "${slotName}" default`,
          status
        )
      }));
    }
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
    const internalLinks = field?.blocknote?.internal_links;
    if (Array.isArray(internalLinks?.collections)) {
      internalLinks.collections = internalLinks.collections.map(
        (collectionName) =>
          translatedDependency(
            route,
            "collections",
            collectionName,
            direction,
            `${context} field "${fieldName}" internal links`,
            status
          )
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

const SCHEMA_RENAME_KINDS = Object.freeze([
  "node_types",
  "collections"
]);

function emptySchemaRenames() {
  return {
    node_types: {},
    collections: {}
  };
}

function remoteIdentity(kind, definition) {
  if (kind === "node_types" && isRemoteNodeType(definition)) {
    return {
      connector: definition.connector,
      remoteName: definition.remote_type
    };
  }
  if (kind === "collections" && isRemoteCollection(definition)) {
    return {
      connector: definition.connector,
      remoteName: definition.remote_collection
    };
  }
  return null;
}

function normalizeSchemaRenames(
  schemaRenames,
  currentConfig,
  nextConfig,
  status = 400
) {
  const supplied = schemaRenames ?? emptySchemaRenames();
  if (!isMapping(supplied)) {
    throw contentError(status, "schemaRenames must be a mapping.");
  }
  const extraKinds = Object.keys(supplied).filter(
    (kind) => !SCHEMA_RENAME_KINDS.includes(kind)
  );
  if (extraKinds.length) {
    throw contentError(
      status,
      "schemaRenames may define only node_types and collections."
    );
  }
  if (!isMapping(currentConfig) || !isMapping(nextConfig)) {
    throw contentError(
      status,
      "Schema renames require current and next configurations."
    );
  }

  const normalized = emptySchemaRenames();
  for (const kind of SCHEMA_RENAME_KINDS) {
    const renames = supplied[kind] ?? {};
    if (!isMapping(renames)) {
      throw contentError(status, `schemaRenames.${kind} must be a mapping.`);
    }
    const currentDefinitions = currentConfig[kind];
    const nextDefinitions = nextConfig[kind];
    if (!isMapping(currentDefinitions) || !isMapping(nextDefinitions)) {
      throw contentError(
        status,
        `Schema renames require ${kind} mappings in both configurations.`
      );
    }
    const sources = new Set(Object.keys(renames));
    const targets = new Set();
    for (const [source, target] of Object.entries(renames)) {
      assertSafeName(source, `${kind} rename source`, status);
      assertSafeName(target, `${kind} rename target`, status);
      if (source === target) {
        throw contentError(
          status,
          `${kind} rename "${source}" must change its key.`
        );
      }
      if (targets.has(target)) {
        throw contentError(
          status,
          `${kind} schema rename targets must be one-to-one; "${target}" is repeated.`
        );
      }
      targets.add(target);
      if (sources.has(target)) {
        throw contentError(
          status,
          `${kind} schema renames cannot contain chains or swaps.`
        );
      }
      const currentDefinition = currentDefinitions[source];
      const nextDefinition = nextDefinitions[target];
      if (!currentDefinition) {
        throw contentError(
          status,
          `${kind} rename source "${source}" does not exist in the current configuration.`
        );
      }
      if (Object.hasOwn(nextDefinitions, source)) {
        throw contentError(
          status,
          `${kind} rename source "${source}" must be removed from the next configuration.`
        );
      }
      if (Object.hasOwn(currentDefinitions, target)) {
        throw contentError(
          status,
          `${kind} rename target "${target}" already exists in the current configuration.`
        );
      }
      if (!nextDefinition) {
        throw contentError(
          status,
          `${kind} rename target "${target}" does not exist in the next configuration.`
        );
      }

      const currentRemote = remoteIdentity(kind, currentDefinition);
      const nextRemote = remoteIdentity(kind, nextDefinition);
      if (Boolean(currentRemote) !== Boolean(nextRemote)) {
        throw contentError(
          status,
          `${kind} rename "${source}" to "${target}" cannot change schema ownership.`
        );
      }
      if (
        currentRemote &&
        (currentRemote.connector !== nextRemote.connector ||
          currentRemote.remoteName !== nextRemote.remoteName)
      ) {
        throw contentError(
          status,
          `${kind} alias rename "${source}" to "${target}" must preserve its connector and remote identity.`
        );
      }
      normalized[kind][source] = target;
    }
  }
  return normalized;
}

function migratedApiFileValue(
  value,
  collectionRenames,
  currentConfig,
  nextConfig
) {
  if (typeof value !== "string") return value;
  const parsed = parseContentAddressedMediaPath(value, currentConfig);
  const target = parsed?.collection
    ? collectionRenames[parsed.collection]
    : null;
  if (!target) return value;
  const currentPath = imageAssetMediaPath(
    { hash: parsed.hash, filename: parsed.filename },
    {
      storage: "api",
      collection: parsed.collection,
      publicFolder: currentConfig.site?.public_folder ?? "/media"
    }
  );
  if (value !== currentPath) return value;
  return imageAssetMediaPath(
    { hash: parsed.hash, filename: parsed.filename },
    {
      storage: "api",
      collection: target,
      publicFolder: nextConfig.site?.public_folder ?? "/media"
    }
  );
}

function migrateRecordSchemaKeys(
  record,
  currentConfig,
  nextConfig,
  schemaRenames,
  { storage } = {}
) {
  if (!isMapping(record)) {
    throw new TypeError("migrateRecordSchemaKeys requires a record mapping.");
  }
  if (!["api", "github"].includes(storage)) {
    throw new TypeError(
      'migrateRecordSchemaKeys storage must be "api" or "github".'
    );
  }
  const renames = normalizeSchemaRenames(
    schemaRenames,
    currentConfig,
    nextConfig,
    400
  );
  const route = connectorRoutes();
  for (const kind of SCHEMA_RENAME_KINDS) {
    const names = new Set([
      ...Object.keys(currentConfig[kind] ?? {}),
      ...Object.keys(nextConfig[kind] ?? {})
    ]);
    for (const name of names) {
      route[kind].local_to_remote[name] = renames[kind][name] ?? name;
      route[kind].remote_to_local[name] = name;
    }
  }
  const migrated = translateRecord(record, route, "local_to_remote");
  if (storage !== "api" || !Object.keys(renames.collections).length) {
    return migrated;
  }

  function migrateFileFields(currentNode, nextNode) {
    if (!isMapping(currentNode) || !isMapping(nextNode)) return;
    const fields = currentConfig.node_types?.[currentNode.type]?.fields ?? {};
    if (isMapping(nextNode.properties)) {
      for (const [fieldName, field] of Object.entries(fields)) {
        if (field?.widget !== "file") continue;
        if (!Object.hasOwn(nextNode.properties, fieldName)) continue;
        nextNode.properties[fieldName] = migratedApiFileValue(
          nextNode.properties[fieldName],
          renames.collections,
          currentConfig,
          nextConfig
        );
      }
    }
    for (const [slotName, currentChildren] of Object.entries(
      currentNode.slots ?? {}
    )) {
      const nextChildren = nextNode.slots?.[slotName];
      if (!Array.isArray(currentChildren) || !Array.isArray(nextChildren)) {
        continue;
      }
      currentChildren.forEach((child, index) =>
        migrateFileFields(child, nextChildren[index])
      );
    }
  }

  migrateFileFields(record, migrated);
  return migrated;
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
  schemaRenames = emptySchemaRenames(),
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
  const normalizedSchemaRenames = normalizeSchemaRenames(
    schemaRenames,
    currentSource,
    nextSource,
    status
  );
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
      const provenanceName =
        Object.entries(normalizedSchemaRenames.node_types).find(
          ([, target]) => target === localName
        )?.[0] ?? localName;
      const currentDeclaration =
        currentOwnershipSource.node_types?.[provenanceName];
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
      const provenanceName =
        Object.entries(normalizedSchemaRenames.collections).find(
          ([, target]) => target === localName
        )?.[0] ?? localName;
      const currentDeclaration =
        currentOwnershipSource.collections?.[provenanceName];
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
    schemaRenames: normalizedSchemaRenames,
    sourceChanged: !sameValue(currentSource, nextSource)
  };
}

export {
  collapseConfig,
  isRemoteCollection,
  isRemoteNodeType,
  materializeConfig,
  migrateRecordSchemaKeys,
  normalizeSchemaRenames,
  planConfigWrites,
  translateInlineReferences,
  translateRecord,
  validateSourceConfig
};
