import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertContentPath,
  assertSafeName,
  parseYaml,
  validateConfig,
  validateRecord
} from "../core/content.js";
import {
  buildImageServiceMediaUrl,
  buildImageServiceUrl
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

async function createFilesystemContentAdapter({
  projectRoot,
  resolveMediaUrl,
  resolveImageUrl,
  imageServiceBaseUrl,
  publicBase = "/"
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

  const root = await fs.realpath(rootPath(projectRoot));
  if (!(await fs.stat(root)).isDirectory()) {
    throw new Error("projectRoot must point to a directory.");
  }

  const configPath = path.join(root, "cms.config.yml");
  const configMetadata = await fs.lstat(configPath);
  if (configMetadata.isSymbolicLink() || !configMetadata.isFile()) {
    throw new Error("cms.config.yml must be a regular file in projectRoot.");
  }
  const config = validateConfig(
    parseYaml(await fs.readFile(configPath, "utf8"))
  );
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

  const backendName = config.backend?.name;
  const apiBackend = backendName === "api" || backendName === "node";
  const apiUrl = apiBackend ? String(config.backend?.api_url || "") : "";
  const defaultMediaResolver = apiBackend
    ? (value) =>
        buildImageServiceMediaUrl(value, {
          baseUrl: apiUrl,
          config
        })
    : (value) => publicUrl(value, publicBase);
  const mediaResolver = resolveMediaUrl ?? defaultMediaResolver;
  const imageResolver =
    resolveImageUrl ??
    (imageServiceBaseUrl !== undefined || (resolveMediaUrl === undefined && apiBackend)
      ? (value) =>
          buildImageServiceUrl(value, {
            baseUrl: imageServiceBaseUrl ?? apiUrl,
            config,
            fit: "inside"
          })
      : mediaResolver);
  return createContentAdapter({
    config,
    listRaw: listRecords,
    getRaw: readRecord,
    resolveMediaUrl: mediaResolver,
    resolveImageUrl: imageResolver
  });
}

export { createFilesystemContentAdapter };
