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
  configuredCollectionMediaAccept,
  imageAsset,
  imageAssetMediaPath,
  mediaAcceptErrorMessage,
  mediaFileMatchesAccept,
  mediaFilenameWithSuffix,
  normalizedMediaFilename,
  recordMediaStoragePaths,
  sha256Hex
} from "../../../core/media.js";
import { isRemoteCollection } from "../../../core/connectors.js";
import { createGitHubAuth } from "./github-auth.js";

const API_VERSION = "2026-03-10";
const CI_SKIP_MARKER = "[ci skip]";
const CI_SKIP_PATTERN = /\[ci skip\]/i;

function normalizeMediaRepositoryPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\")) {
    throw contentError(400, "Invalid media path.");
  }
  const normalized = value.replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/");
  const filename = normalizedMediaFilename(segments.at(-1));
  if (
    segments.length < 2 ||
    !filename ||
    filename !== segments.at(-1) ||
    segments.slice(0, -1).some(
      (segment) => !segment || !/^[a-z0-9._-]+$/i.test(segment)
    )
  ) {
    throw contentError(400, "Invalid media path.");
  }
  return [...segments.slice(0, -1), filename].join("/");
}

function deploymentCommitMessage(message, skipDeployments) {
  const value = String(message);
  return skipDeployments && !CI_SKIP_PATTERN.test(value)
    ? `${value} ${CI_SKIP_MARKER}`
    : value;
}

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

function collectionFolderMoves(currentConfig, nextConfig) {
  const moves = [];
  for (const [name, nextCollection] of Object.entries(
    nextConfig.collections ?? {}
  )) {
    const currentCollection = currentConfig.collections?.[name];
    if (
      !currentCollection ||
      isRemoteCollection(currentCollection) ||
      isRemoteCollection(nextCollection)
    ) {
      continue;
    }
    const from = normalizeRepositoryPath(
      currentCollection.folder,
      `Collection "${name}" folder`
    );
    const to = normalizeRepositoryPath(
      nextCollection.folder,
      `Collection "${name}" folder`
    );
    if (from === to) continue;
    if (from.startsWith(`${to}/`) || to.startsWith(`${from}/`)) {
      throw contentError(
        400,
        `Collection "${name}" folder cannot move into or contain its previous folder.`
      );
    }
    moves.push({ collection: name, from, to });
  }
  return moves;
}

function pathWithin(path, directory) {
  return path === directory || path.startsWith(`${directory}/`);
}

function movedTreeChanges(entries, moves) {
  const sourceFolders = moves.map(({ from }) => from);
  const targetPaths = new Set();
  const additions = [];
  const deletions = [];

  for (const move of moves) {
    for (const entry of entries) {
      if (!pathWithin(entry.path, move.from) || entry.type === "tree") continue;
      if (entry.type !== "blob") {
        throw contentError(
          409,
          `Collection "${move.collection}" folder contains unsupported Git entry "${entry.path}".`
        );
      }
      const suffix = entry.path.slice(move.from.length);
      const targetPath = `${move.to}${suffix}`;
      if (targetPaths.has(targetPath)) {
        throw contentError(409, `Collection folder moves collide at "${targetPath}".`);
      }
      targetPaths.add(targetPath);
      additions.push({
        path: targetPath,
        mode: entry.mode,
        type: "blob",
        sha: entry.sha
      });
      deletions.push({
        path: entry.path,
        mode: entry.mode,
        type: "blob",
        delete: true
      });
    }
  }

  for (const move of moves) {
    const collision = entries.find((entry) => {
      const destinationOverlap =
        pathWithin(entry.path, move.to) ||
        (entry.type !== "tree" && pathWithin(move.to, entry.path));
      if (!destinationOverlap) return false;
      return !sourceFolders.some((source) => pathWithin(entry.path, source));
    });
    if (collision) {
      throw contentError(
        409,
        `Collection "${move.collection}" folder destination conflicts with "${collision.path}".`
      );
    }
  }

  const changes = new Map(
    deletions.map((change) => [change.path, change])
  );
  for (const addition of additions) changes.set(addition.path, addition);
  return [...changes.values()];
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
  let currentConfigBlobSha;
  let lastCommitSha = "";
  let skipDeployments = false;
  let writeTail = Promise.resolve();
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

  function enqueueWrite(operation) {
    const result = writeTail.then(operation, operation);
    writeTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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

  async function readRepositoryFile(path, { media = false } = {}) {
    const normalized = media
      ? normalizeMediaRepositoryPath(path)
      : normalizeRepositoryPath(path);
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

  async function repositorySnapshot() {
    const refPath = `${repositoryApi}/git/ref/heads/${encodePath(branch)}`;
    const reference = await githubRequest(refPath, { authRequired: true });
    const parentSha = reference.object.sha;
    const parentCommit = await githubRequest(
      `${repositoryApi}/git/commits/${encodeURIComponent(parentSha)}`,
      { authRequired: true }
    );
    return { parentSha, parentCommit };
  }

  async function snapshotTree(snapshot, { recursive = false } = {}) {
    const query = recursive ? "?recursive=1" : "";
    const result = await githubRequest(
      `${repositoryApi}/git/trees/${encodeURIComponent(snapshot.parentCommit.tree.sha)}${query}`,
      { authRequired: true }
    );
    if (result?.truncated || !Array.isArray(result?.tree)) {
      throw contentError(
        409,
        "The repository tree is too large to update configuration safely."
      );
    }
    return result.tree;
  }

  function assertCurrentConfigBlob(entries) {
    const entry = entries.find(({ path }) => path === configPath);
    const matches =
      currentConfigBlobSha === null
        ? !entry
        : entry?.type === "blob" && entry.sha === currentConfigBlobSha;
    if (!matches) {
      throw contentError(
        409,
        `The ${branch} configuration changed while you were editing. Reload and try again.`
      );
    }
  }

  async function createTextBlob(source) {
    const blob = await githubRequest(`${repositoryApi}/git/blobs`, {
      method: "POST",
      authRequired: true,
      body: {
        content: source,
        encoding: "utf-8"
      }
    });
    if (typeof blob?.sha !== "string" || !blob.sha) {
      throw contentError(502, "GitHub did not return a configuration blob.");
    }
    return blob.sha;
  }

  async function publishCommit({
    parentSha,
    treeSha,
    message,
    skip = skipDeployments
  }) {
    const nextCommit = await githubRequest(`${repositoryApi}/git/commits`, {
      method: "POST",
      authRequired: true,
      body: {
        message: deploymentCommitMessage(message, skip),
        tree: treeSha,
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

  async function commitChanges(changes, message, suppliedSnapshot) {
    const { parentSha, parentCommit } =
      suppliedSnapshot ?? (await repositorySnapshot());

    const tree = await Promise.all(
      changes.map(async (change) => {
        const path = change.media
          ? normalizeMediaRepositoryPath(change.path)
          : normalizeRepositoryPath(change.path);
        if (change.delete) {
          return {
            path,
            mode: change.mode || "100644",
            type: change.type || "blob",
            sha: null
          };
        }
        if (change.sha) {
          return {
            path,
            mode: change.mode || "100644",
            type: change.type || "blob",
            sha: change.sha
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
    return publishCommit({
      parentSha,
      treeSha: nextTree.sha,
      message
    });
  }

  async function updateDeploymentSkipping(value, { resume = true } = {}) {
    const next = value === true;
    if (next === skipDeployments) return;
    if (next) {
      skipDeployments = true;
      return;
    }
    if (!resume) {
      skipDeployments = false;
      return;
    }

    const snapshot = await repositorySnapshot();
    if (CI_SKIP_PATTERN.test(snapshot.parentCommit.message || "")) {
      await publishCommit({
        parentSha: snapshot.parentSha,
        treeSha: snapshot.parentCommit.tree.sha,
        message: "Resume deployments",
        skip: false
      });
    }
    skipDeployments = false;
  }

  async function loadConfig() {
    try {
      const source = await readRepositoryFile(configPath);
      currentConfig = validateSourceConfig(parseYaml(source.text));
      currentConfigBlobSha = source.sha;
    } catch (error) {
      if (error.status !== 404 || auth.getToken()) throw error;
      currentConfig = validateSourceConfig(bootstrapConfig);
      currentConfigBlobSha = null;
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

  async function mediaPathsUsedByOtherRecords(
    config,
    deletingCollection,
    deletingId,
    loadedDeletingItems
  ) {
    const used = new Set();
    for (const [name, definition] of Object.entries(config.collections ?? {})) {
      if (isRemoteCollection(definition)) continue;
      const result = name === deletingCollection && loadedDeletingItems
        ? loadedDeletingItems
        : await list(name);
      for (const item of result.items ?? []) {
        if (name === deletingCollection && item.id === deletingId) continue;
        const path = recordPath(definition, item.id);
        const record = recordCache.get(path)?.record ??
          await readRecord(definition, item.id);
        for (const mediaPath of recordMediaStoragePaths(record, config, {
          storage: "github",
          collection: name
        })) {
          used.add(mediaPath);
        }
      }
    }
    return used;
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
      ? recordMediaStoragePaths(record, config, {
          storage: "github",
          collection: collectionName
        })
      : [];
    const usedMediaPaths = mediaPaths.length
      ? await mediaPathsUsedByOtherRecords(
          config,
          collectionName,
          id,
          collectionItems
        )
      : new Set();
    const existingMediaPaths = [];
    for (const mediaPath of mediaPaths) {
      if (usedMediaPaths.has(mediaPath)) continue;
      try {
        await readRepositoryFile(mediaPath, { media: true });
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
          media: true,
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
    if (currentConfigBlobSha === undefined) await loadConfig();
    const current = await ensureConfig();
    const moves = collectionFolderMoves(current, validated);
    const snapshot = await repositorySnapshot();
    const entries = await snapshotTree(snapshot, {
      recursive: moves.length > 0
    });
    assertCurrentConfigBlob(entries);
    const folderChanges = moves.length
      ? movedTreeChanges(entries, moves)
      : [];
    const nextConfigBlobSha = await createTextBlob(dumpYaml(validated));
    await commitChanges(
      [
        ...folderChanges,
        {
          path: configPath,
          mode: "100644",
          type: "blob",
          sha: nextConfigBlobSha
        }
      ],
      moves.length === 1
        ? `Move ${moves[0].collection} collection folder`
        : moves.length > 1
          ? "Move collection folders"
          : "Update miniCMS configuration",
      snapshot
    );
    if (moves.length) recordCache.clear();
    currentConfig = validated;
    currentConfigBlobSha = nextConfigBlobSha;
    return { saved: true, config: validated };
  }

  function mediaResult(config, hash, filename) {
    const asset = imageAsset({ hash, filename });
    const mediaFolder = normalizeRepositoryPath(
      config.site?.media_folder || "content/media",
      "media folder"
    );
    return {
      hash: asset.hash,
      filename: asset.filename,
      path: imageAssetMediaPath(asset, {
        storage: "github",
        publicFolder: config.site?.public_folder || "/media"
      }),
      storage_path: `${mediaFolder}/${asset.hash}/${asset.filename}`
    };
  }

  async function uploadMedia(file, collectionName, options = {}) {
    await ensureAuthenticated();
    const { config, collection } = await collectionConfiguration(collectionName);
    if (!["image", "file"].includes(options.widget)) {
      throw contentError(400, 'The upload widget must be "image" or "file".');
    }
    const acceptedTypes = configuredCollectionMediaAccept(
      config,
      collection,
      options.widget
    );
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

    const filename = normalizedMediaFilename(file.name);
    if (!filename) {
      throw contentError(400, "The uploaded filename is not safe to store.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cryptoImplementation = windowObject?.crypto?.subtle
      ? windowObject.crypto
      : globalThis.crypto;
    const hash = await sha256Hex(bytes, cryptoImplementation);

    const mediaFolder = normalizeRepositoryPath(
      config.site?.media_folder || "content/media",
      "media folder"
    );
    const entries = (await listDirectory(`${mediaFolder}/${hash}`))
      .filter((entry) => entry.type === "file")
      .sort((left, right) => left.name.localeCompare(right.name));
    const existingNames = new Set(
      entries.map((entry) => entry.name.toLowerCase())
    );
    const existingEntry =
      entries.find((entry) => entry.name.toLowerCase() === filename.toLowerCase()) ||
      entries[0];
    let storedFilename = filename;
    let suffix = 2;
    while (existingNames.has(storedFilename.toLowerCase())) {
      storedFilename = mediaFilenameWithSuffix(filename, suffix);
      suffix += 1;
    }

    if (existingEntry && options.duplicate === "reuse") {
      return { ...mediaResult(config, hash, existingEntry.name), reused: true };
    }
    if (existingEntry && options.duplicate !== "copy") {
      return {
        duplicate: true,
        existing: mediaResult(config, hash, existingEntry.name),
        copy: mediaResult(config, hash, storedFilename)
      };
    }

    const storagePath = `${mediaFolder}/${hash}/${storedFilename}`;
    await commitChanges(
      [{ path: storagePath, bytes, media: true }],
      `Upload media ${storedFilename}`
    );
    return mediaResult(config, hash, storedFilename);
  }

  function rawRepositoryUrl(repositoryPath) {
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
    let decodedRelativePath;
    try {
      decodedRelativePath = relativeMediaPath
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/");
    } catch {
      throw contentError(400, "Invalid media path.");
    }
    return rawRepositoryUrl(
      normalizeMediaRepositoryPath(`${mediaFolder}/${decodedRelativePath}`)
    );
  }

  function resolveImageUrl(value) {
    const asset = imageAsset(value);
    if (!asset) return "";
    const config = currentConfig || bootstrapConfig;
    const mediaFolder = normalizeRepositoryPath(
      config.site?.media_folder || "content/media",
      "media folder"
    );
    return rawRepositoryUrl(
      normalizeMediaRepositoryPath(
        `${mediaFolder}/${asset.hash}/${asset.filename}`
      )
    );
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
    setSkipDeployments: (value, options) =>
      enqueueWrite(() => updateDeploymentSkipping(value, options)),
    config: loadConfig,
    saveConfig: (...args) => enqueueWrite(() => saveConfig(...args)),
    list,
    record: async (collectionName, id) => {
      const { collection } = await collectionConfiguration(collectionName);
      return readRecord(collection, id);
    },
    save: (...args) => enqueueWrite(() => save(...args)),
    create: (...args) => enqueueWrite(() => create(...args)),
    rename: (...args) => enqueueWrite(() => rename(...args)),
    remove: (...args) => enqueueWrite(() => remove(...args)),
    uploadMedia: (...args) => enqueueWrite(() => uploadMedia(...args))
  };
}

export {
  createGitHubAdapter,
  decodeBase64,
  encodeBase64,
  encodePath
};
