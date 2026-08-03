import {
  collapseConfig,
  materializeConfig,
  translateRecord
} from "../../../core/connectors.js";
import { validateSourceConfig } from "../../../core/content.js";
import { createApiAdapter } from "./api.js";
import { createGitHubAdapter } from "./github.js";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function translatedRecord(value, connectorRoutes, direction) {
  return value && typeof value === "object" && typeof value.type === "string"
    ? translateRecord(value, connectorRoutes, direction)
    : clone(value);
}

function mapAdapterResult(result, connectorRoutes, localCollection) {
  if (!result || typeof result !== "object") return result;
  if (Array.isArray(result)) {
    return result.map((item) =>
      translatedRecord(item, connectorRoutes, "remote_to_local")
    );
  }
  const mapped = { ...result };
  if (localCollection && Object.hasOwn(mapped, "collection")) {
    mapped.collection = localCollection;
  }
  if (Array.isArray(mapped.items)) {
    mapped.items = mapped.items.map((item) =>
      translatedRecord(item, connectorRoutes, "remote_to_local")
    );
  }
  if (mapped.item) {
    mapped.item = translatedRecord(
      mapped.item,
      connectorRoutes,
      "remote_to_local"
    );
  }
  if (mapped.record) {
    mapped.record = translatedRecord(
      mapped.record,
      connectorRoutes,
      "remote_to_local"
    );
  }
  return mapped;
}

function referencedConnectorNames(config) {
  const names = new Set();
  for (const definition of [
    ...Object.values(config.collections ?? {}),
    ...Object.values(config.node_types ?? {})
  ]) {
    if (
      definition &&
      typeof definition === "object" &&
      typeof definition.connector === "string" &&
      !["default", "development"].includes(definition.connector)
    ) {
      names.add(definition.connector);
    }
  }
  return names;
}

function aggregateSession(entries) {
  const sessions = entries.map(([connector, adapter]) => ({
    connector,
    adapter,
    session: adapter.session()
  }));
  const required = sessions.filter(
    ({ session }) => session.authenticationRequired
  );
  const pending = required.find(({ session }) => !session.authenticated);
  const representative = pending ?? required[0] ?? sessions[0];
  const authenticated = required.every(({ session }) => session.authenticated);
  const count = sessions.length;
  return {
    authenticated,
    authenticationRequired: required.length > 0,
    provider: representative?.session.provider || "local",
    label:
      pending?.session.label ||
      (count === 1
        ? representative?.session.label || "Local"
        : `${count} connectors`),
    ...(representative?.session.login
      ? { login: representative.session.login }
      : {}),
    ...(representative?.session.avatarUrl
      ? { avatarUrl: representative.session.avatarUrl }
      : {}),
    ...(pending ? { pendingConnector: pending.connector } : {})
  };
}

async function defaultConnectorFactory({
  key,
  connector,
  sourceConfig,
  fetchImpl,
  options
}) {
  if (connector.name === "api") {
    const { apiUrl: suppliedApiUrl, ...sharedApiOptions } = options;
    return createApiAdapter({
      fetchImpl,
      ...sharedApiOptions,
      apiUrl:
        (key === "development" && suppliedApiUrl !== undefined
          ? suppliedApiUrl
          : connector.api_url) ?? ""
    });
  }
  if (connector.name === "github") {
    return createGitHubAdapter({
      ...options,
      config: sourceConfig,
      connector,
      fetchImpl
    });
  }
  throw new Error(`Unsupported miniCMS connector "${connector.name}".`);
}

async function createConnectorAdapter({
  sourceConfig,
  environment = "production",
  fetchImpl = fetch,
  connectorOptions = {},
  connectorFactory = defaultConnectorFactory
}) {
  if (!["production", "development"].includes(environment)) {
    throw new TypeError(
      'miniCMS environment must be "production" or "development".'
    );
  }
  if (
    !connectorOptions ||
    typeof connectorOptions !== "object" ||
    Array.isArray(connectorOptions)
  ) {
    throw new TypeError("miniCMS connectorOptions must be a mapping.");
  }
  const trustedSourceConfig = validateSourceConfig(clone(sourceConfig));
  const trustedConnectors = clone(trustedSourceConfig.connectors);
  const activeConnectorName =
    environment === "development" && trustedConnectors.development
      ? "development"
      : "default";
  const activeDefinition = trustedConnectors[activeConnectorName];
  if (!activeDefinition) {
    throw new Error(`The ${activeConnectorName} connector is not configured.`);
  }

  const namedConnectors = referencedConnectorNames(trustedSourceConfig);
  const adapterEntries = await Promise.all([
    Promise.resolve(
      connectorFactory({
        key: activeConnectorName,
        connector: activeDefinition,
        sourceConfig: trustedSourceConfig,
        fetchImpl,
        options: connectorOptions[activeConnectorName] ?? {},
        active: true
      })
    ).then((adapter) => ["default", adapter]),
    ...[...namedConnectors].map(async (key) => {
      const connector = trustedConnectors[key];
      if (!connector) {
        throw new Error(`Connector "${key}" is not configured.`);
      }
      return [
        key,
        await connectorFactory({
          key,
          connector,
          sourceConfig: trustedSourceConfig,
          fetchImpl,
          options: connectorOptions[key] ?? {},
          active: false
        })
      ];
    })
  ]);
  const adapters = new Map(adapterEntries);
  const listeners = new Set();
  const unsubscribe = adapterEntries.map(([, adapter]) =>
    adapter.subscribeSession(() => {
      const session = aggregateSession(adapterEntries);
      for (const listener of listeners) listener(session);
    })
  );
  let routes = null;
  let remoteConfigs = null;
  let configPromise = null;

  function withTrustedConnectors(config) {
    return validateSourceConfig({
      ...clone(config),
      connectors: clone(trustedConnectors)
    });
  }

  async function loadRemoteConfigs() {
    const entries = await Promise.all(
      [...namedConnectors].map(async (key) => [
        key,
        await adapters.get(key).config()
      ])
    );
    return Object.fromEntries(entries);
  }

  function materialize(nextSource, nextRemoteConfigs = remoteConfigs ?? {}) {
    const result = materializeConfig({
      sourceConfig: withTrustedConnectors(nextSource),
      remoteConfigs: nextRemoteConfigs
    });
    routes = result.routes;
    remoteConfigs = nextRemoteConfigs;
    return result;
  }

  async function loadConfig() {
    if (!configPromise) {
      configPromise = Promise.all([
        adapters.get("default").config(),
        loadRemoteConfigs()
      ])
        .then(([nextSource, nextRemoteConfigs]) =>
          materialize(nextSource, nextRemoteConfigs).config
        )
        .catch((error) => {
          configPromise = null;
          throw error;
        });
    }
    return configPromise;
  }

  function connectorRoute(collectionName) {
    const route = routes?.collections?.[collectionName];
    if (!route) {
      throw new Error(`Collection "${collectionName}" does not exist.`);
    }
    const connector = route.connector || "default";
    const adapter = adapters.get(connector);
    if (!adapter) {
      throw new Error(`Connector "${connector}" is not available.`);
    }
    return {
      adapter,
      connector,
      remoteCollection: route.remote_collection || collectionName,
      connectorRoutes: routes.connectors?.[connector]
    };
  }

  function mediaAdapter(options = {}) {
    return options.collection
      ? connectorRoute(options.collection).adapter
      : adapters.get("default");
  }

  async function saveConfig(config) {
    const collapsed = collapseConfig(config);
    const result = await adapters.get("default").saveConfig(collapsed);
    configPromise = null;
    const nextSource = result?.config ?? collapsed;
    const next = materialize(nextSource);
    configPromise = Promise.resolve(next.config);
    return { ...result, config: next.config };
  }

  const composite = {
    name: "connectors",
    label:
      adapterEntries.length === 1
        ? adapterEntries[0][1].label
        : `${adapterEntries.length} connectors`,
    session: () => aggregateSession(adapterEntries),
    subscribeSession(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async login() {
      const pending = adapterEntries.find(([, adapter]) => {
        const session = adapter.session();
        return session.authenticationRequired && !session.authenticated;
      });
      if (pending) {
        await pending[1].login();
      }
      return aggregateSession(adapterEntries);
    },
    async logout() {
      await Promise.all(
        adapterEntries.flatMap(([, adapter]) => {
          const session = adapter.session();
          return session.authenticationRequired && session.authenticated
            ? [adapter.logout()]
            : [];
        })
      );
      return aggregateSession(adapterEntries);
    },
    config: loadConfig,
    saveConfig,
    async list(collectionName) {
      const route = connectorRoute(collectionName);
      const result = await route.adapter.list(route.remoteCollection);
      return mapAdapterResult(
        result,
        route.connectorRoutes,
        collectionName
      );
    },
    async record(collectionName, id) {
      const route = connectorRoute(collectionName);
      const result = await route.adapter.record(route.remoteCollection, id);
      return translatedRecord(
        result,
        route.connectorRoutes,
        "remote_to_local"
      );
    },
    async save(collectionName, record) {
      const route = connectorRoute(collectionName);
      const result = await route.adapter.save(
        route.remoteCollection,
        translatedRecord(record, route.connectorRoutes, "local_to_remote")
      );
      return mapAdapterResult(
        result,
        route.connectorRoutes,
        collectionName
      );
    },
    async create(collectionName, record) {
      const route = connectorRoute(collectionName);
      const result = await route.adapter.create(
        route.remoteCollection,
        translatedRecord(record, route.connectorRoutes, "local_to_remote")
      );
      return mapAdapterResult(
        result,
        route.connectorRoutes,
        collectionName
      );
    },
    async rename(collectionName, id, nextId) {
      const route = connectorRoute(collectionName);
      const result = await route.adapter.rename(
        route.remoteCollection,
        id,
        nextId
      );
      return mapAdapterResult(
        result,
        route.connectorRoutes,
        collectionName
      );
    },
    async remove(collectionName, id) {
      const route = connectorRoute(collectionName);
      return route.adapter.remove(route.remoteCollection, id);
    },
    uploadMedia(file, collectionName) {
      const route = connectorRoute(collectionName);
      return route.adapter.uploadMedia(file, route.remoteCollection);
    },
    resolveMediaUrl(path, options = {}) {
      return mediaAdapter(options).resolveMediaUrl(path);
    },
    resolveImageUrl(path, options = {}) {
      const { collection: _collection, ...imageOptions } = options;
      return mediaAdapter(options).resolveImageUrl(path, imageOptions);
    },
    getImageInfo(path, options = {}) {
      const target = mediaAdapter(options);
      return typeof target.getImageInfo === "function"
        ? target.getImageInfo(path)
        : Promise.resolve(null);
    },
    destroy() {
      unsubscribe.forEach((stop) => stop());
      listeners.clear();
    }
  };

  return composite;
}

export {
  aggregateSession,
  createConnectorAdapter,
  mapAdapterResult,
  referencedConnectorNames
};
