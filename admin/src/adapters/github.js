import {
  assertSafeName,
  contentError,
  dumpYaml,
  hierarchyValue,
  normalizeRepositoryPath,
  parseYaml,
  summarizeRecord,
  validateSourceConfig,
  validateRecord
} from "../../../core/content.js";
import {
  configuredMediaAccept,
  mediaAcceptErrorMessage,
  mediaFileMatchesAccept,
  recordMediaStoragePaths
} from "../../../core/media.js";
import { sanitizeFilenameStem } from "../../../core/slug.js";
import { createGitHubAuth } from "./github-auth.js";

const API_VERSION = "2026-03-10";

function encodePath(value) {
  return String(value)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeBase64(value) {
  const binary = atob(String(value).replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0)
  );
  return new TextDecoder().decode(bytes);
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function recordTimestamp(commit) {
  return (
    commit?.commit?.author?.date ||
    commit?.commit?.committer?.date ||
    commit?.author?.date ||
    commit?.committer?.date ||
    null
  );
}

function createGitHubAdapter({
  config: bootstrapConfig,
  connector,
  fetchImpl = fetch,
  auth: suppliedAuth,
  windowObject,
  storage
}) {
  validateSourceConfig(bootstrapConfig);
  const [owner, repository] = connector.repo.split("/");
  const branch = connector.branch || "main";
  const configPath = "cms.config.yml";
  const apiRoot = String(
    connector.api_root || "https://api.github.com"
  ).replace(/\/+$/, "");
  const repositoryApi = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const auth =
    suppliedAuth ||
    createGitHubAuth({
      baseUrl: connector.base_url,
      repository: connector.repo,
      ...(windowObject ? { windowObject } : {}),
      ...(storage ? { storage } : {})
    });
  const listeners = new Set();
  const recordCache = new Map();
  let currentConfig = bootstrapConfig;
  let lastCommitSha = "";
  let loginPromise = null;
  let currentSession = {
    authenticated: Boolean(auth.getToken()),
    authenticationRequired: true,
    label: auth.getToken() ? "GitHub" : "Sign in",
    provider: "github",
    repository: connector.repo,
    branch
  };

  function emitSession(nextSession) {
    currentSession = nextSession;
    for (const listener of listeners) listener(currentSession);
  }

  async function login() {
    if (loginPromise) return loginPromise;
    loginPromise = (async () => {
      await auth.login();
      let user = null;
      try {
        user = await githubRequest("/user", { authRequired: true });
      } catch (error) {
        if (!auth.getToken()) throw error;
        // The repository token remains useful if profile loading is unavailable.
      }
      const session = {
        authenticated: true,
        authenticationRequired: true,
        label: user?.login || "GitHub",
        login: user?.login,
        avatarUrl: user?.avatar_url,
        provider: "github",
        repository: connector.repo,
        branch
      };
      emitSession(session);
      return session;
    })();
    try {
      return await loginPromise;
    } finally {
      loginPromise = null;
    }
  }

  function logout() {
    auth.logout();
    emitSession({
      authenticated: false,
      authenticationRequired: true,
      label: "Sign in",
      provider: "github",
      repository: connector.repo,
      branch
    });
  }

  async function ensureAuthenticated() {
    if (!auth.getToken()) await login();
  }

  async function githubRequest(
    path,
    { method = "GET", body, authRequired = false, headers = {} } = {}
  ) {
    let token = auth.getToken();
    if (authRequired && !token) {
      await login();
      token = auth.getToken();
    }
    const response = await fetchImpl(`${apiRoot}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": API_VERSION,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (response.status === 204) return null;
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && token) logout();
      const error = contentError(
        response.status,
        result?.message || `GitHub request failed with status ${response.status}.`
      );
      error.github = result;
      throw error;
    }
    return result;
  }

  async function readRepositoryFile(path) {
    const normalized = normalizeRepositoryPath(path);
    const query = new URLSearchParams({ ref: branch });
    const result = await githubRequest(
      `${repositoryApi}/contents/${encodePath(normalized)}?${query}`
    );
    if (Array.isArray(result) || result?.type !== "file") {
      throw contentError(404, `Repository file "${normalized}" does not exist.`);
    }
    if (result.encoding !== "base64" || typeof result.content !== "string") {
      const blob = await githubRequest(
        `${repositoryApi}/git/blobs/${encodeURIComponent(result.sha)}`
      );
      return {
        path: normalized,
        sha: result.sha,
        text: decodeBase64(blob.content)
      };
    }
    return {
      path: normalized,
      sha: result.sha,
      text: decodeBase64(result.content)
    };
  }

  async function listDirectory(path) {
    const normalized = normalizeRepositoryPath(path);
    const query = new URLSearchParams({ ref: branch });
    try {
      const result = await githubRequest(
        `${repositoryApi}/contents/${encodePath(normalized)}?${query}`
      );
      return Array.isArray(result) ? result : [];
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
  }

  async function lastCommitForPath(path) {
    const query = new URLSearchParams({
      sha: branch,
      path,
      per_page: "1"
    });
    try {
      const commits = await githubRequest(
        `${repositoryApi}/commits?${query.toString()}`
      );
      return commits?.[0] || null;
    } catch {
      return null;
    }
  }

  async function commitChanges(changes, message) {
    const refPath = `${repositoryApi}/git/ref/heads/${encodePath(branch)}`;
    const reference = await githubRequest(refPath, { authRequired: true });
    const parentSha = reference.object.sha;
    const parentCommit = await githubRequest(
      `${repositoryApi}/git/commits/${encodeURIComponent(parentSha)}`,
      { authRequired: true }
    );

    const tree = await Promise.all(
      changes.map(async (change) => {
        const path = normalizeRepositoryPath(change.path);
        if (change.delete) {
          return {
            path,
            mode: "100644",
            type: "blob",
            sha: null
          };
        }
        if (change.bytes) {
          const blob = await githubRequest(`${repositoryApi}/git/blobs`, {
            method: "POST",
            authRequired: true,
            body: {
              content: encodeBase64(change.bytes),
              encoding: "base64"
            }
          });
          return {
            path,
            mode: "100644",
            type: "blob",
            sha: blob.sha
          };
        }
        return {
          path,
          mode: "100644",
          type: "blob",
          content: String(change.text ?? "")
        };
      })
    );

    const nextTree = await githubRequest(`${repositoryApi}/git/trees`, {
      method: "POST",
      authRequired: true,
      body: {
        base_tree: parentCommit.tree.sha,
        tree
      }
    });
    const nextCommit = await githubRequest(`${repositoryApi}/git/commits`, {
      method: "POST",
      authRequired: true,
      body: {
        message,
        tree: nextTree.sha,
        parents: [parentSha]
      }
    });
    try {
      await githubRequest(
        `${repositoryApi}/git/refs/heads/${encodePath(branch)}`,
        {
          method: "PATCH",
          authRequired: true,
          body: {
            sha: nextCommit.sha,
            force: false
          }
        }
      );
    } catch (error) {
      if ([409, 422].includes(error.status)) {
        throw contentError(
          409,
          `The ${branch} branch changed while you were editing. Reload and try again.`
        );
      }
      throw error;
    }
    lastCommitSha = nextCommit.sha;
    return {
      sha: nextCommit.sha,
      updatedAt: recordTimestamp(nextCommit) || new Date().toISOString()
    };
  }

  async function loadConfig() {
    try {
      const source = await readRepositoryFile(configPath);
      currentConfig = validateSourceConfig(parseYaml(source.text));
    } catch (error) {
      if (error.status !== 404 || auth.getToken()) throw error;
      currentConfig = validateSourceConfig(bootstrapConfig);
    }
    return currentConfig;
  }

  async function ensureConfig() {
    return currentConfig || loadConfig();
  }

  async function collectionConfiguration(name) {
    assertSafeName(name, "collection name");
    const config = await ensureConfig();
    const configured = config.collections?.[name];
    if (!configured) {
      throw contentError(404, `Collection "${name}" does not exist.`);
    }
    return {
      config,
      collection: {
        name,
        ...configured,
        folder: normalizeRepositoryPath(
          configured.folder,
          `Collection "${name}" folder`
        )
      }
    };
  }

  function recordPath(collection, id) {
    assertSafeName(id, "record id");
    const extension = String(collection.extension || "yml").replace(/^\./, "");
    return `${collection.folder}/${id}.${extension}`;
  }

  async function readRecord(collection, id) {
    const path = recordPath(collection, id);
    try {
      const source = await readRepositoryFile(path);
      const record = parseYaml(source.text);
      recordCache.set(path, {
        ...(recordCache.get(path) ?? {}),
        record,
        sha: source.sha
      });
      return record;
    } catch (error) {
      if (error.status === 404) {
        throw contentError(404, `Record "${id}" does not exist.`);
      }
      throw error;
    }
  }

  async function list(collectionName) {
    const { collection } = await collectionConfiguration(collectionName);
    const entries = (await listDirectory(collection.folder)).filter(
      (entry) =>
        entry.type === "file" && /\.(?:ya?ml)$/i.test(entry.name)
    );
    const items = await Promise.all(
      entries.map(async (entry) => {
        const [source, commit] = await Promise.all([
          readRepositoryFile(entry.path),
          lastCommitForPath(entry.path)
        ]);
        const record = parseYaml(source.text);
        const updatedAt = recordTimestamp(commit);
        const metadata = {
          created_at: null,
          updated_at: updatedAt
        };
        recordCache.set(entry.path, {
          record,
          sha: source.sha,
          ...metadata
        });
        return summarizeRecord(record, metadata, collection);
      })
    );
    items.sort((left, right) =>
      left.order - right.order || left.title.localeCompare(right.title)
    );
    return { collection: collection.name, items };
  }

  async function save(collectionName, record) {
    await ensureAuthenticated();
    const { config, collection } =
      await collectionConfiguration(collectionName);
    validateRecord(record, collection, config);
    const path = recordPath(collection, record.id);
    const cached = recordCache.get(path);
    const commit = await commitChanges(
      [{ path, text: dumpYaml(record) }],
      `Update ${collection.label_singular || collection.name} ${record.id}`
    );
    const metadata = {
      created_at: cached ? cached.created_at : commit.updatedAt,
      updated_at: commit.updatedAt
    };
    recordCache.set(path, { record, ...metadata });
    return {
      saved: true,
      item: summarizeRecord(record, metadata, collection)
    };
  }

  async function create(collectionName, record) {
    await ensureAuthenticated();
    const { config, collection } =
      await collectionConfiguration(collectionName);
    validateRecord(record, collection, config);
    const path = recordPath(collection, record.id);
    try {
      await readRepositoryFile(path);
      throw contentError(409, `Record "${record.id}" already exists.`);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const commit = await commitChanges(
      [{ path, text: dumpYaml(record) }],
      `Create ${collection.label_singular || collection.name} ${record.id}`
    );
    const metadata = {
      created_at: commit.updatedAt,
      updated_at: commit.updatedAt
    };
    recordCache.set(path, { record, ...metadata });
    return {
      saved: true,
      item: summarizeRecord(record, metadata, collection)
    };
  }

  async function rename(collectionName, oldId, nextId) {
    await ensureAuthenticated();
    assertSafeName(nextId, "record id");
    if (oldId === nextId) {
      throw contentError(400, "The new record id must be different.");
    }
    const { config, collection } =
      await collectionConfiguration(collectionName);
    const oldPath = recordPath(collection, oldId);
    const nextPath = recordPath(collection, nextId);
    const record = await readRecord(collection, oldId);
    try {
      await readRepositoryFile(nextPath);
      throw contentError(409, `Record "${nextId}" already exists.`);
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    if (collection.hierarchy?.enabled && !collection.hierarchy?.id_field) {
      const collectionItems = await list(collectionName);
      if (collectionItems.items.some((item) => item.parent === oldId)) {
        throw contentError(
          409,
          `Record "${oldId}" has child records and its hierarchy uses the filename as its id.`
        );
      }
    }

    const renamedRecord = { ...record, id: nextId };
    validateRecord(renamedRecord, collection, config);
    const commit = await commitChanges(
      [
        { path: nextPath, text: dumpYaml(renamedRecord) },
        { path: oldPath, delete: true }
      ],
      `Rename ${collection.label_singular || collection.name} ${oldId} to ${nextId}`
    );
    const oldMetadata = recordCache.get(oldPath);
    const metadata = {
      created_at: oldMetadata ? oldMetadata.created_at : commit.updatedAt,
      updated_at: commit.updatedAt
    };
    recordCache.delete(oldPath);
    recordCache.set(nextPath, { record: renamedRecord, ...metadata });
    return {
      saved: true,
      record: renamedRecord,
      item: summarizeRecord(renamedRecord, metadata, collection)
    };
  }

  async function remove(collectionName, id) {
    await ensureAuthenticated();
    const { config, collection } = await collectionConfiguration(collectionName);
    const path = recordPath(collection, id);
    const record = await readRecord(collection, id);
    const deletingHierarchyId = hierarchyValue(
      record,
      collection,
      "id_field",
      record.id
    );
    const collectionItems = await list(collectionName);
    if (
      collectionItems.items.some(
        (item) => item.id !== id && item.parent === deletingHierarchyId
      )
    ) {
      throw contentError(
        409,
        `Record "${id}" still has child records. Move or delete them first.`
      );
    }
    const mediaPaths = collection.delete_files_with_record
      ? recordMediaStoragePaths(record, config)
      : [];
    const existingMediaPaths = [];
    for (const mediaPath of mediaPaths) {
      try {
        await readRepositoryFile(mediaPath);
        existingMediaPaths.push(mediaPath);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    await commitChanges(
      [
        { path, delete: true },
        ...existingMediaPaths.map((mediaPath) => ({
          path: mediaPath,
          delete: true
        }))
      ],
      `Delete ${collection.label_singular || collection.name} ${id}`
    );
    recordCache.delete(path);
  }

  async function saveConfig(config) {
    await ensureAuthenticated();
    const validated = validateSourceConfig(config, 400);
    await commitChanges(
      [{ path: configPath, text: dumpYaml(validated) }],
      "Update miniCMS configuration"
    );
    currentConfig = validated;
    return { saved: true, config: validated };
  }

  async function uploadMedia(file) {
    await ensureAuthenticated();
    const config = await ensureConfig();
    const extension = file.name
      .slice(file.name.lastIndexOf("."))
      .toLowerCase();
    const acceptedTypes = configuredMediaAccept(config);
    if (!mediaFileMatchesAccept(file, acceptedTypes)) {
      throw contentError(
        400,
        mediaAcceptErrorMessage(file, acceptedTypes)
      );
    }
    if (!file.size) throw contentError(400, "The uploaded file is empty.");
    if (file.size > 20 * 1024 * 1024) {
      throw contentError(413, "Uploads must be smaller than 20 MB.");
    }

    const mediaFolder = normalizeRepositoryPath(
      config.site?.media_folder || "content/media",
      "media folder"
    );
    const entries = await listDirectory(mediaFolder);
    const existingNames = new Set(
      entries.map((entry) => entry.name.toLowerCase())
    );
    const base = sanitizeFilenameStem(
      extension ? file.name.slice(0, -extension.length) : file.name,
      "image"
    );
    let filename = `${base}${extension}`;
    let suffix = 2;
    while (existingNames.has(filename.toLowerCase())) {
      filename = `${base}-${suffix}${extension}`;
      suffix += 1;
    }
    const storagePath = `${mediaFolder}/${filename}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await commitChanges(
      [{ path: storagePath, bytes }],
      `Upload media ${filename}`
    );
    const publicFolder = String(
      config.site?.public_folder || "/media"
    ).replace(/\/+$/, "");
    return {
      filename,
      path: `${publicFolder}/${filename}`,
      storage_path: storagePath
    };
  }

  function resolveMediaUrl(path) {
    if (!path) return "";
    if (/^(?:https?:|blob:|data:)/i.test(path)) return path;
    const config = currentConfig || bootstrapConfig;
    const publicFolder = String(
      config.site?.public_folder || "/media"
    ).replace(/\/+$/, "");
    const normalizedPath = String(path).split(/[?#]/)[0];
    const prefix = `${publicFolder}/`;
    const relativeMediaPath = normalizedPath.startsWith(prefix)
      ? normalizedPath.slice(prefix.length)
      : normalizedPath.replace(/^\/?media\//, "").replace(/^\/+/, "");
    const mediaFolder = normalizeRepositoryPath(
      config.site?.media_folder || "content/media",
      "media folder"
    );
    const repositoryPath = `${mediaFolder}/${relativeMediaPath}`;
    const rawPath = [
      owner,
      repository,
      ...branch.split("/"),
      ...repositoryPath.split("/")
    ]
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const cacheKey = lastCommitSha
      ? `?minicms=${encodeURIComponent(lastCommitSha)}`
      : "";
    return `https://raw.githubusercontent.com/${rawPath}${cacheKey}`;
  }

  function resolveImageUrl(path) {
    return resolveMediaUrl(path);
  }

  return {
    name: "github",
    label: `${connector.repo} · ${branch}`,
    session: () => currentSession,
    subscribeSession(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    login,
    logout,
    resolveMediaUrl,
    resolveImageUrl,
    config: loadConfig,
    saveConfig,
    list,
    record: async (collectionName, id) => {
      const { collection } = await collectionConfiguration(collectionName);
      return readRecord(collection, id);
    },
    save,
    create,
    rename,
    remove,
    uploadMedia
  };
}

export {
  createGitHubAdapter,
  decodeBase64,
  encodeBase64,
  encodePath
};
