import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertContentPath,
  assertSafeName,
  parseYaml,
  validateSourceConfig,
  validateRecord
} from "../core/content.js";
import {
  isRemoteCollection,
  isRemoteNodeType,
  materializeConfig,
  translateRecord
} from "../core/connectors.js";
import {
  buildImageServiceMediaUrl,
  buildImageServiceUrl,
  normalizeHttpOrigin
} from "../core/image-service.js";
import { createContentAdapter } from "./index.js";

function rootPath(value) {
  if (value instanceof URL) {
    if (value.protocol !== "file:") {
      throw new TypeError("projectRoot must be a filesystem path or file URL.");
    }
    return fileURLToPath(value);
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("projectRoot must be a filesystem path or file URL.");
  }
  return path.resolve(value);
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function assertInside(parent, candidate, label) {
  if (!isInside(parent, candidate)) {
    throw new Error(`${label} must stay inside content/.`);
  }
}

async function missingAsNull(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function externalUrl(value) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}

function publicUrl(value, base) {
  if (!value || externalUrl(value)) return value;
  const suffix = String(value).replace(/^\/+/, "");
  const prefix = String(base ?? "/").trim();
  if (prefix === "." || prefix === "./") return `./${suffix}`;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(prefix)) {
    return `${prefix.replace(/\/+$/, "")}/${suffix}`;
  }
  const normalized = `/${prefix}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return normalized ? `${normalized}/${suffix}` : `/${suffix}`;
}

function connectorError(message, status) {
  const error = new Error(message);
  if (status !== undefined) error.status = status;
  return error;
}

function connectorAuthorization(options = {}) {
  if (typeof options.token === "string" && options.token) {
    return { authorization: `Bearer ${options.token}` };
  }
  return {};
}

function sourceRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (Object.hasOwn(value, "item")) return value.item ?? null;
  if (Object.hasOwn(value, "record")) return value.record ?? null;
  return value;
}

function createApiContentSource({
  connectorName,
  connector,
  fetchImpl,
  options = {}
}) {
  if (!connector.api_url) {
    throw connectorError(
      `Connector "${connectorName}" must define api_url for a filesystem build.`
    );
  }
  const apiOrigin = normalizeHttpOrigin(
    connector.api_url,
    `Connector "${connectorName}" API URL`
  );
  const configuredHeaders = {
    ...connectorAuthorization(options),
    ...(options.headers ?? {})
  };
  let configPromise;

  async function request(pathname) {
    const response = await fetchImpl(new URL(pathname, `${apiOrigin}/`), {
      headers: configuredHeaders
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw connectorError(
        body?.message ||
          `Connector "${connectorName}" request failed with status ${response.status}.`,
        response.status
      );
    }
    return body;
  }

  function config() {
    configPromise ??= request("/api/config");
    return configPromise;
  }

  return {
    config,
    list: (collectionName) =>
      request(`/api/collections/${encodeURIComponent(collectionName)}`),
    async record(collectionName, id) {
      try {
        return await request(
          `/api/collections/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`
        );
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },
    async resolveMediaUrl(value) {
      return buildImageServiceMediaUrl(value, {
        baseUrl: apiOrigin,
        config: await config()
      });
    },
    async resolveImageUrl(value) {
      return buildImageServiceUrl(value, {
        baseUrl: apiOrigin,
        config: await config(),
        fit: "inside"
      });
    }
  };
}

function remoteConnectorNames(config) {
  const names = new Set();
  for (const type of Object.values(config.node_types ?? {})) {
    if (isRemoteNodeType(type)) names.add(type.connector);
  }
  for (const collection of Object.values(config.collections ?? {})) {
    if (isRemoteCollection(collection)) names.add(collection.connector);
  }
  return names;
}

async function createFilesystemContentAdapter({
  projectRoot,
  resolveMediaUrl,
  resolveImageUrl,
  imageServiceBaseUrl,
  publicBase = "/",
  connectorSources = {},
  connectorOptions = {},
  fetchImpl = fetch
} = {}) {
  if (
    resolveMediaUrl !== undefined &&
    typeof resolveMediaUrl !== "function"
  ) {
    throw new TypeError("resolveMediaUrl must be a function.");
  }
  if (
    resolveImageUrl !== undefined &&
    typeof resolveImageUrl !== "function"
  ) {
    throw new TypeError("resolveImageUrl must be a function.");
  }
  if (
    imageServiceBaseUrl !== undefined &&
    typeof imageServiceBaseUrl !== "string"
  ) {
    throw new TypeError("imageServiceBaseUrl must be a string.");
  }
  if (!connectorSources || typeof connectorSources !== "object") {
    throw new TypeError("connectorSources must be a mapping.");
  }
  if (!connectorOptions || typeof connectorOptions !== "object") {
    throw new TypeError("connectorOptions must be a mapping.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }

  const root = await fs.realpath(rootPath(projectRoot));
  if (!(await fs.stat(root)).isDirectory()) {
    throw new Error("projectRoot must point to a directory.");
  }

  const configPath = path.join(root, "cms.config.yml");
  const configMetadata = await fs.lstat(configPath);
  if (configMetadata.isSymbolicLink() || !configMetadata.isFile()) {
    throw new Error("cms.config.yml must be a regular file in projectRoot.");
  }
  const sourceConfig = validateSourceConfig(
    parseYaml(await fs.readFile(configPath, "utf8"))
  );
  const sources = {};
  const remoteConfigs = {};
  for (const connectorName of remoteConnectorNames(sourceConfig)) {
    const connector = sourceConfig.connectors[connectorName];
    const supplied = connectorSources[connectorName];
    const source = supplied ?? (
      connector?.name === "api"
        ? createApiContentSource({
            connectorName,
            connector,
            fetchImpl,
            options: connectorOptions[connectorName]
          })
        : null
    );
    if (
      !source ||
      typeof source.config !== "function" ||
      typeof source.list !== "function" ||
      (typeof source.get !== "function" && typeof source.record !== "function")
    ) {
      throw connectorError(
        `Connector "${connectorName}" needs a complete content source for filesystem builds.`
      );
    }
    sources[connectorName] = source;
    remoteConfigs[connectorName] = await source.config();
  }
  const materialized = materializeConfig({ sourceConfig, remoteConfigs });
  const { config, routes } = materialized;
  const declaredContentRoot = path.join(root, "content");
  let contentRootPromise;

  async function contentRoot() {
    if (!contentRootPromise) {
      contentRootPromise = missingAsNull(async () => {
        const metadata = await fs.lstat(declaredContentRoot);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
          throw new Error("content/ must be a regular directory.");
        }
        return fs.realpath(declaredContentRoot);
      });
    }
    return contentRootPromise;
  }

  function collectionFor(name) {
    assertSafeName(name, "collection name");
    const route = routes.collections[name];
    if (route?.connector && route.connector !== "default") {
      throw new Error(`Collection "${name}" is owned by connector "${route.connector}".`);
    }
    const definition = config.collections?.[name];
    if (!definition) throw new Error(`Collection "${name}" does not exist.`);
    const collection = { name, ...definition };
    const declaredFolder = path.resolve(
      root,
      assertContentPath(
        collection.folder,
        `Collection "${name}" folder`
      )
    );
    assertInside(declaredContentRoot, declaredFolder, "Collection folder");
    return { collection, declaredFolder };
  }

  async function collectionFolder(collectionName) {
    const { collection, declaredFolder } = collectionFor(collectionName);
    const trustedContentRoot = await contentRoot();
    if (!trustedContentRoot) return { collection, folder: null };
    const folder = await missingAsNull(() => fs.realpath(declaredFolder));
    if (!folder) return { collection, folder: null };
    assertInside(trustedContentRoot, folder, "Collection folder");
    if (!(await fs.stat(folder)).isDirectory()) {
      throw new Error(`Collection "${collectionName}" folder is not a directory.`);
    }
    return { collection, folder };
  }

  function extensionFor(collection) {
    return String(collection.extension || "yml").replace(/^\./, "");
  }

  async function readRecordFile(collectionName, collection, folder, id, file) {
    assertSafeName(id, "record id");
    assertInside(folder, file, "Record path");
    const metadata = await missingAsNull(() => fs.lstat(file));
    if (!metadata) return null;
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(
        `Record "${collectionName}/${id}" must be a regular file.`
      );
    }
    const record = validateRecord(
      parseYaml(await fs.readFile(file, "utf8")),
      collection,
      config
    );
    if (record.id !== id) {
      throw new Error(
        `Record file "${collectionName}/${id}" contains id "${record.id}".`
      );
    }
    return record;
  }

  async function readRecord(collectionName, id) {
    assertSafeName(id, "record id");
    const { collection, folder } = await collectionFolder(collectionName);
    if (!folder) return null;
    const file = path.join(folder, `${id}.${extensionFor(collection)}`);
    return readRecordFile(collectionName, collection, folder, id, file);
  }

  async function listRecords(collectionName) {
    const { collection, folder } = await collectionFolder(collectionName);
    if (!folder) return [];
    const suffix = `.${extensionFor(collection)}`;
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.name.endsWith(suffix))
        .map(async (entry) => {
          const id = entry.name.slice(0, -suffix.length);
          assertSafeName(id, "record id");
          if (entry.isSymbolicLink() || !entry.isFile()) {
            throw new Error(
              `Record "${collectionName}/${id}" must be a regular file.`
            );
          }
          return readRecordFile(
            collectionName,
            collection,
            folder,
            id,
            path.join(folder, entry.name)
          );
        })
    );
    return records.sort(
      (left, right) =>
        (Number.isFinite(left.order) ? left.order : 0) -
          (Number.isFinite(right.order) ? right.order : 0) ||
        String(left.properties?.title || left.id).localeCompare(
          String(right.properties?.title || right.id)
        )
    );
  }

  function routeFor(collectionName) {
    assertSafeName(collectionName, "collection name");
    const route = routes.collections[collectionName];
    if (!route) throw new Error(`Collection "${collectionName}" does not exist.`);
    return route;
  }

  async function readRoutedRecord(collectionName, id) {
    const route = routeFor(collectionName);
    if (route.connector === "default") return readRecord(collectionName, id);
    const source = sources[route.connector];
    const getter = source.get ?? source.record;
    const record = sourceRecord(
      await getter.call(source, route.remote_collection, id)
    );
    return record
      ? translateRecord(
          record,
          routes.connectors[route.connector],
          "remote_to_local"
        )
      : null;
  }

  async function listRoutedRecords(collectionName) {
    const route = routeFor(collectionName);
    if (route.connector === "default") return listRecords(collectionName);
    const result = await sources[route.connector].list(route.remote_collection);
    const items = Array.isArray(result) ? result : result?.items ?? [];
    return {
      ...(Array.isArray(result) ? {} : result),
      collection: collectionName,
      items: items.map((item) =>
        translateRecord(
          item,
          routes.connectors[route.connector],
          "remote_to_local"
        )
      )
    };
  }

  const defaultConnector = config.connectors.default;
  const apiBackend = defaultConnector.name === "api";
  const apiUrl = apiBackend ? String(defaultConnector.api_url || "") : "";
  const defaultMediaResolver = apiBackend
    ? (value) =>
        buildImageServiceMediaUrl(value, {
          baseUrl: apiUrl,
          config
        })
    : (value) => publicUrl(value, publicBase);
  async function connectorMediaResolver(value, context = {}) {
    if (resolveMediaUrl) return resolveMediaUrl(value, context);
    const route = context.collection
      ? routeFor(context.collection)
      : { connector: "default" };
    if (route.connector === "default") return defaultMediaResolver(value);
    const source = sources[route.connector];
    if (typeof source.resolveMediaUrl !== "function") {
      throw connectorError(
        `Connector "${route.connector}" does not provide media URL resolution.`
      );
    }
    return source.resolveMediaUrl(value, {
      ...context,
      collection: route.remote_collection
    });
  }
  async function connectorImageResolver(value, context = {}) {
    if (resolveImageUrl) return resolveImageUrl(value, context);
    const route = context.collection
      ? routeFor(context.collection)
      : { connector: "default" };
    if (route.connector !== "default") {
      const source = sources[route.connector];
      if (typeof source.resolveImageUrl !== "function") {
        throw connectorError(
          `Connector "${route.connector}" does not provide image URL resolution.`
        );
      }
      return source.resolveImageUrl(value, {
        ...context,
        collection: route.remote_collection
      });
    }
    if (
      imageServiceBaseUrl !== undefined ||
      (resolveMediaUrl === undefined && apiBackend)
    ) {
      return buildImageServiceUrl(value, {
        baseUrl: imageServiceBaseUrl ?? apiUrl,
        config,
        fit: "inside"
      });
    }
    return connectorMediaResolver(value, context);
  }
  return createContentAdapter({
    config,
    listRaw: listRoutedRecords,
    getRaw: readRoutedRecord,
    resolveMediaUrl: connectorMediaResolver,
    resolveImageUrl: connectorImageResolver
  });
}

export { createFilesystemContentAdapter };
