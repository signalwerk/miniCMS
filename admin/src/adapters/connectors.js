import {
  collapseConfig,
  materializeConfig,
  planConfigWrites,
  translateRecord
} from "../../../core/connectors.js";
import { validateSourceConfig } from "../../../core/content.js";
import { createApiAdapter } from "./api.js";
import { createGitHubAdapter } from "./github.js";

const CONNECTOR_AUTHENTICATION_REQUIRED =
  "MINICMS_CONNECTOR_AUTHENTICATION_REQUIRED";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function sameValue(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && sameValue(left[key], right[key])
    )
  );
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

function rememberConnectorOwnership(currentSource, plannedSource, connector) {
  const next = clone(currentSource);
  for (const kind of ["node_types", "collections"]) {
    next[kind] ??= {};
    for (const [name, definition] of Object.entries(
      plannedSource[kind] ?? {}
    )) {
      if (definition.connector === connector) {
        next[kind][name] = clone(definition);
      }
    }
  }
  return next;
}

function connectorAuthenticationError(connector) {
  const error = new Error(
    `Connector "${connector}" requires sign-in. Select Sign in and save to continue.`
  );
  error.code = CONNECTOR_AUTHENTICATION_REQUIRED;
  error.connector = connector;
  return error;
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
          : connector.api_url) ?? "",
      authUrl: connector.auth_url ?? ""
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

function browserDeploymentStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function githubRepositoryIdentity(connector) {
  return `${connector.repo.toLowerCase()}@${connector.branch || "main"}`;
}

function githubTarget(connector) {
  const apiRoot = connector.api_root || "https://api.github.com";
  return `${apiRoot}|${githubRepositoryIdentity(connector)}`;
}

function deploymentProjectIdentity(connector) {
  if (connector.name === "github") return githubTarget(connector);
  if (connector.name === "api") {
    return `api:${connector.api_url || "same-origin"}`;
  }
  return connector.name;
}

function registerGithubTarget(targets, key, connector) {
  if (connector?.name !== "github") return;
  const target = githubTarget(connector);
  const existing = targets.get(target);
  if (existing && existing !== key) {
    throw new Error(
      `GitHub connectors "${existing}" and "${key}" target the same repository branch "${githubRepositoryIdentity(connector)}".`
    );
  }
  targets.set(target, key);
}

async function createConnectorAdapter({
  sourceConfig,
  environment = "production",
  fetchImpl = fetch,
  connectorOptions = {},
  connectorFactory = defaultConnectorFactory,
  deploymentStorage = browserDeploymentStorage()
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
  const githubConnectors = Object.entries(trustedConnectors).filter(
    ([, connector]) => connector.name === "github"
  );
  const deploymentStorageKey = githubConnectors.length
    ? `minicms:skip-deployments:v1:${deploymentProjectIdentity(
        trustedConnectors.default
      )}`
    : null;
  let storedSkipDeployments = false;
  if (deploymentStorageKey) {
    try {
      storedSkipDeployments =
        deploymentStorage?.getItem(deploymentStorageKey) === "true";
    } catch {
      // Browser storage is optional; the active editor session still works.
    }
  }
  const activeConnectorName =
    environment === "development" && trustedConnectors.development
      ? "development"
      : "default";
  const activeDefinition = trustedConnectors[activeConnectorName];
  if (!activeDefinition) {
    throw new Error(`The ${activeConnectorName} connector is not configured.`);
  }

  const namedConnectors = referencedConnectorNames(trustedSourceConfig);
  const runtimeGithubTargets = new Map();
  for (const [key, connector] of [
    [activeConnectorName, activeDefinition],
    ...[...namedConnectors].map((key) => [key, trustedConnectors[key]])
  ]) {
    registerGithubTarget(runtimeGithubTargets, key, connector);
  }
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
  const unsubscribe = [];
  const activations = new Map();
  const preparedAdapters = new Map();
  let routes = null;
  let currentSourceConfig = null;
  let provisionalOwnershipSourceConfig = null;
  let remoteConfigs = null;
  let configPromise = null;
  let skipDeployments = storedSkipDeployments;
  let deploymentTail = Promise.resolve();

  function applyDeploymentPreference(
    adapter,
    value = skipDeployments,
    options
  ) {
    return adapter.setSkipDeployments?.(value, options);
  }

  async function updateDeploymentSkipping(
    value,
    { resume = true, persist = true } = {}
  ) {
    const next = value === true;
    const activeLeaves = new Set(adapters.values());
    const preparedLeaves = new Set(
      [...preparedAdapters.values()].filter(
        (adapter) => !activeLeaves.has(adapter)
      )
    );

    try {
      for (const adapter of activeLeaves) {
        await applyDeploymentPreference(adapter, next, { resume });
      }
      await Promise.all(
        [...preparedLeaves].map((adapter) =>
          applyDeploymentPreference(adapter, next, { resume: false })
        )
      );
    } catch (error) {
      await Promise.allSettled(
        [...activeLeaves, ...preparedLeaves].map((adapter) =>
          applyDeploymentPreference(adapter, skipDeployments, {
            resume: false
          })
        )
      );
      throw error;
    }

    skipDeployments = next;
    if (persist && deploymentStorageKey) {
      try {
        if (next) deploymentStorage?.setItem(deploymentStorageKey, "true");
        else deploymentStorage?.removeItem(deploymentStorageKey);
      } catch {
        // Browser storage is optional; the active editor session still works.
      }
    }
  }

  function enqueueDeploymentUpdate(value, options) {
    const operation = deploymentTail.then(
      () => updateDeploymentSkipping(value, options),
      () => updateDeploymentSkipping(value, options)
    );
    deploymentTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  await Promise.all(
    adapterEntries.map(([, adapter]) =>
      applyDeploymentPreference(adapter, skipDeployments, { resume: false })
    )
  );

  function emitSession() {
    const session = aggregateSession(adapterEntries);
    for (const listener of listeners) listener(session);
  }

  function subscribeAdapter(adapter) {
    unsubscribe.push(adapter.subscribeSession(emitSession));
  }

  adapterEntries.forEach(([, adapter]) => subscribeAdapter(adapter));

  function finishNamedConnectorPreparation(
    key,
    adapter,
    { authenticateConnector = "" } = {}
  ) {
    const session = adapter.session();
    let authentication;
    if (session.authenticationRequired && !session.authenticated) {
      if (authenticateConnector !== key) {
        return Promise.reject(connectorAuthenticationError(key));
      }
      try {
        // This call must stay synchronous with the Settings save gesture so
        // the adapter can open its OAuth popup before the first await.
        authentication = adapter.login();
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return Promise.resolve(authentication)
      .then(() => {
        const authenticatedSession = adapter.session();
        if (
          authenticatedSession.authenticationRequired &&
          !authenticatedSession.authenticated
        ) {
          throw connectorAuthenticationError(key);
        }
        return adapter.config();
      })
      .then((config) => {
        preparedAdapters.delete(key);
        adapters.set(key, adapter);
        adapterEntries.push([key, adapter]);
        subscribeAdapter(adapter);
        emitSession();
        return { adapter, config };
      });
  }

  function prepareNamedConnector(key, options = {}) {
    if (adapters.has(key)) {
      return Promise.resolve({
        adapter: adapters.get(key),
        config: null
      });
    }
    if (activations.has(key)) return activations.get(key);
    const connector = trustedConnectors[key];
    if (!connector) {
      throw new Error(
        `Connector "${key}" was added in Settings. Save it without remote aliases, reload miniCMS, and then add the aliases.`
      );
    }
    registerGithubTarget(runtimeGithubTargets, key, connector);
    const prepared = preparedAdapters.get(key);
    const activation = (
      prepared
        ? finishNamedConnectorPreparation(key, prepared, options)
        : Promise.resolve()
            .then(() =>
              connectorFactory({
                key,
                connector,
                sourceConfig: trustedSourceConfig,
                fetchImpl,
                options: connectorOptions[key] ?? {},
                active: false
              })
            )
            .then(async (adapter) => {
              preparedAdapters.set(key, adapter);
              try {
                await deploymentTail;
                await applyDeploymentPreference(adapter, skipDeployments, {
                  resume: false
                });
              } catch (error) {
                preparedAdapters.delete(key);
                throw error;
              }
              return finishNamedConnectorPreparation(key, adapter, options);
            })
    ).finally(() => activations.delete(key));
    activations.set(key, activation);
    return activation;
  }

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

  function assertTrustedReferences(config) {
    const referenced = referencedConnectorNames(config);
    for (const key of referenced) {
      if (
        !trustedConnectors[key] ||
        !sameValue(config.connectors[key], trustedConnectors[key])
      ) {
        throw new Error(
          `Connector "${key}" was added or changed in Settings. Save it without remote aliases, reload miniCMS, and then add the aliases.`
        );
      }
    }
    return referenced;
  }

  async function preflightRemoteConfigs(
    referenced,
    { authenticateConnector = "" } = {}
  ) {
    const nextRemoteConfigs = { ...(remoteConfigs ?? {}) };
    for (const key of referenced) {
      if (Object.hasOwn(nextRemoteConfigs, key)) continue;
      if (adapters.has(key)) {
        nextRemoteConfigs[key] = await adapters.get(key).config();
        remoteConfigs = { ...nextRemoteConfigs };
        continue;
      }
      const prepared = await prepareNamedConnector(key, {
        authenticateConnector
      });
      nextRemoteConfigs[key] = prepared.config;
      remoteConfigs = { ...nextRemoteConfigs };
      if (authenticateConnector === key) authenticateConnector = "";
    }
    return nextRemoteConfigs;
  }

  function materialize(nextSource, nextRemoteConfigs = remoteConfigs ?? {}) {
    const result = materializeConfig({
      sourceConfig: withTrustedConnectors(nextSource),
      remoteConfigs: nextRemoteConfigs
    });
    routes = result.routes;
    currentSourceConfig = result.sourceConfig;
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
    return clone(await configPromise);
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

  async function saveConfig(config, { authenticateConnector = "" } = {}) {
    if (!currentSourceConfig) await loadConfig();
    const collapsed = collapseConfig(config);
    const referenced = assertTrustedReferences(collapsed);
    const nextRemoteConfigs = await preflightRemoteConfigs(referenced, {
      authenticateConnector
    });
    const plan = planConfigWrites({
      effectiveConfig: config,
      sourceConfig: currentSourceConfig,
      ownershipSourceConfig:
        provisionalOwnershipSourceConfig ?? currentSourceConfig,
      remoteConfigs: nextRemoteConfigs
    });
    const savedConnectors = [];
    const savedRemoteConfigs = { ...nextRemoteConfigs };
    for (const connector of plan.changedConnectors) {
      try {
        const result = await adapters
          .get(connector)
          .saveConfig(plan.remoteConfigs[connector]);
        savedRemoteConfigs[connector] =
          result?.config ?? plan.remoteConfigs[connector];
        savedConnectors.push(connector);
        remoteConfigs = { ...savedRemoteConfigs };
        provisionalOwnershipSourceConfig = rememberConnectorOwnership(
          provisionalOwnershipSourceConfig ?? currentSourceConfig,
          plan.sourceConfig,
          connector
        );
      } catch (error) {
        const message = String(error.message || error).replace(/\.+$/, "");
        const partial = savedConnectors.length
          ? ` Connector${savedConnectors.length === 1 ? "" : "s"} ${savedConnectors.map((name) => `"${name}"`).join(", ")} saved successfully; retry Settings to finish the remaining writes.`
          : "";
        error.message = `Could not save connector "${connector}": ${message}.${partial}`;
        throw error;
      }
    }

    let result = { saved: true, config: currentSourceConfig };
    if (plan.sourceChanged) {
      try {
        result = await adapters.get("default").saveConfig(plan.sourceConfig);
      } catch (error) {
        const message = String(error.message || error).replace(/\.+$/, "");
        const partial = savedConnectors.length
          ? ` Connector${savedConnectors.length === 1 ? "" : "s"} ${savedConnectors.map((name) => `"${name}"`).join(", ")} already saved; retry Settings to publish the local aliases.`
          : "";
        error.message = `Could not save the default connector: ${message}.${partial}`;
        throw error;
      }
    }

    const savedSourceConfig = plan.sourceChanged
      ? result?.config ?? plan.sourceConfig
      : currentSourceConfig;
    const materialized = materializeConfig({
      sourceConfig: savedSourceConfig,
      remoteConfigs: savedRemoteConfigs
    });
    routes = materialized.routes;
    currentSourceConfig = materialized.sourceConfig;
    provisionalOwnershipSourceConfig = null;
    remoteConfigs = savedRemoteConfigs;
    configPromise = Promise.resolve(materialized.config);
    return { ...result, config: materialized.config };
  }

  const composite = {
    name: "connectors",
    label:
      adapterEntries.length === 1
        ? adapterEntries[0][1].label
        : `${adapterEntries.length} connectors`,
    deployment: Object.freeze({
      supportsSkip: githubConnectors.length > 0,
      storageKey: deploymentStorageKey,
      get skip() {
        return skipDeployments;
      },
      setSkip(value, options) {
        return enqueueDeploymentUpdate(value, options);
      }
    }),
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
