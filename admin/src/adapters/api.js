import {
  buildImageServiceMediaUrl,
  buildImageServiceUrl,
  isExternalImageSource,
  normalizeHttpOrigin
} from "../../../core/image-service.js";
import { requestGitHubAuthorization } from "./github-auth.js";

function browserWindow(windowObject) {
  const candidate = windowObject ?? globalThis.window;
  if (!candidate?.location?.origin || candidate.location.origin === "null") {
    throw new Error("The miniCMS API adapter requires a browser origin.");
  }
  return candidate;
}

function loopbackHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const parts = host.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts[0] === 127 &&
    parts.every(
      (part) => Number.isInteger(part) && part >= 0 && part <= 255
    )
  );
}

function normalizeApiUrl(apiUrl = "", { windowObject } = {}) {
  const browser = browserWindow(windowObject);
  const pageOrigin = new URL(browser.location.origin).origin;
  const apiOrigin = normalizeHttpOrigin(
    String(apiUrl || "").trim() || pageOrigin,
    "The miniCMS API URL"
  );
  const parsed = new URL(apiOrigin);
  const directLoopbackDevelopment =
    parsed.protocol === "http:" &&
    loopbackHostname(parsed.hostname) &&
    loopbackHostname(new URL(pageOrigin).hostname);
  if (
    parsed.origin !== pageOrigin &&
    parsed.protocol !== "https:" &&
    !directLoopbackDevelopment
  ) {
    throw new Error("A remote miniCMS API URL must use HTTPS.");
  }

  return Object.freeze({
    apiOrigin,
    apiUrl: apiOrigin,
    pageOrigin
  });
}

function availableSessionStorage(windowObject, suppliedStorage) {
  if (suppliedStorage !== undefined) return suppliedStorage;
  try {
    return windowObject.sessionStorage;
  } catch {
    return null;
  }
}

function normalizeAuthUrl(authUrl = "") {
  const source = String(authUrl || "").trim();
  if (!source) return "";
  const authOrigin = normalizeHttpOrigin(
    source,
    "The miniCMS API authentication URL"
  );
  if (new URL(authOrigin).protocol !== "https:") {
    throw new Error("The miniCMS API authentication URL must use HTTPS.");
  }
  return authOrigin;
}

function normalizeSession(value) {
  const authenticated = Boolean(value?.authenticated);
  const authenticationRequired = value?.authenticationRequired !== false;
  const provider = value?.provider || (authenticationRequired ? "github" : "local");
  return {
    authenticated,
    authenticationRequired,
    provider,
    label:
      value?.label ||
      value?.login ||
      (authenticated && !authenticationRequired ? "Local" : "Sign in"),
    ...(value?.login ? { login: value.login } : {}),
    ...(value?.avatarUrl ? { avatarUrl: value.avatarUrl } : {})
  };
}

function parseResponseBody(response) {
  if (response.status === 204) return Promise.resolve(null);
  return response.text().then((source) => {
    if (!source) return null;
    try {
      return JSON.parse(source);
    } catch {
      return source;
    }
  });
}

async function createApiAdapter({
  apiUrl = "",
  authUrl = "",
  fetchImpl = fetch,
  windowObject,
  storage: suppliedStorage
} = {}) {
  const browser = browserWindow(windowObject);
  const { apiOrigin } = normalizeApiUrl(apiUrl, {
    windowObject: browser
  });
  const authOrigin = normalizeAuthUrl(authUrl);
  const storage = availableSessionStorage(browser, suppliedStorage);
  const storageKey = `minicms:api:${apiOrigin}:session`;
  const listeners = new Set();
  let bearer = storage?.getItem(storageKey) || "";
  let loginPromise = null;
  let currentConfig = null;
  let currentConfigEtag = "";
  let currentSession = normalizeSession({
    authenticated: false,
    authenticationRequired: true,
    provider: "github",
    label: "Sign in"
  });

  function storeBearer(nextBearer) {
    bearer = typeof nextBearer === "string" ? nextBearer : "";
    if (!storage) return;
    if (bearer) storage.setItem(storageKey, bearer);
    else storage.removeItem(storageKey);
  }

  function emitSession(nextSession) {
    currentSession = normalizeSession(nextSession);
    for (const listener of listeners) listener(currentSession);
    return currentSession;
  }

  function rejectSession() {
    storeBearer("");
    return emitSession({
      authenticated: false,
      authenticationRequired: true,
      provider: "github",
      label: "Sign in"
    });
  }

  async function request(path, options = {}, { includeResponse = false } = {}) {
    const headers = new Headers(options.headers || {});
    if (bearer && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${bearer}`);
    }
    const response = await fetchImpl(new URL(path, `${apiOrigin}/`).toString(), {
      ...options,
      headers
    });
    const body = await parseResponseBody(response);
    if (!response.ok) {
      if (response.status === 401) rejectSession();
      const error = new Error(
        body?.message || `Request failed with status ${response.status}.`
      );
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return includeResponse ? { body, response } : body;
  }

  async function refreshSession() {
    try {
      return emitSession(await request("/api/auth/session"));
    } catch (error) {
      if (error.status === 401) return currentSession;
      throw error;
    }
  }

  async function exchangeGitHubToken(token) {
    const response = await fetchImpl(
      new URL("/api/auth/github", `${apiOrigin}/`).toString(),
      {
        method: "POST",
        headers: new Headers({ "content-type": "application/json" }),
        body: JSON.stringify({ token })
      }
    );
    const body = await parseResponseBody(response);
    if (!response.ok) {
      const error = new Error(
        body?.message || `Request failed with status ${response.status}.`
      );
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async function beginLogin() {
    if (!authOrigin) {
      throw new Error(
        "This miniCMS API connector requires an HTTPS auth_url to sign in."
      );
    }
    let githubToken = "";
    try {
      githubToken = (
        await requestGitHubAuthorization({
          baseUrl: authOrigin,
          windowObject: browser,
          popupName: "minicms-api-github-oauth"
        })
      ).token;
      if (typeof githubToken !== "string" || !githubToken) {
        throw new Error("GitHub authorization returned no token.");
      }
      const exchange = await exchangeGitHubToken(githubToken);
      if (typeof exchange?.token !== "string" || !exchange.token) {
        throw new Error("The miniCMS API returned no session token.");
      }
      storeBearer(exchange.token);
      const session = await refreshSession();
      if (!session.authenticated) {
        throw new Error("The miniCMS API did not establish a session.");
      }
      return session;
    } catch (error) {
      rejectSession();
      throw error;
    } finally {
      githubToken = "";
    }
  }

  function login() {
    if (currentSession.authenticated || !currentSession.authenticationRequired) {
      return Promise.resolve(currentSession);
    }
    if (!loginPromise) {
      loginPromise = beginLogin().finally(() => {
        loginPromise = null;
      });
    }
    return loginPromise;
  }

  async function logout() {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } finally {
      rejectSession();
    }
    return currentSession;
  }

  async function loadConfig() {
    const { body: config, response } = await request(
      "/api/config",
      {},
      { includeResponse: true }
    );
    currentConfigEtag = response.headers.get("etag") || "";
    currentConfig = config;
    return config;
  }

  async function saveConfig(config) {
    if (!currentConfigEtag) {
      throw new Error(
        "The miniCMS API returned no configuration version. Reload Settings and try again."
      );
    }
    const { body: result, response } = await request(
      "/api/config",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": currentConfigEtag
        },
        body: JSON.stringify(config)
      },
      { includeResponse: true }
    );
    currentConfigEtag = response.headers.get("etag") || currentConfigEtag;
    currentConfig = result?.config ?? config;
    return result;
  }

  function resolveImageUrl(source, options = {}) {
    return buildImageServiceUrl(source, {
      ...options,
      baseUrl: apiOrigin,
      config: currentConfig
    });
  }

  async function getImageInfo(source) {
    const normalizedSource = typeof source === "string" ? source.trim() : "";
    if (!normalizedSource || isExternalImageSource(normalizedSource)) {
      return null;
    }
    const response = await fetchImpl(
      buildImageServiceUrl(normalizedSource, {
        baseUrl: apiOrigin,
        config: currentConfig,
        info: true
      })
    );
    const body = await parseResponseBody(response);
    if (!response.ok) {
      const error = new Error(
        body?.message ||
          `Image information failed with status ${response.status}.`
      );
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function uploadMedia(file, collectionName) {
    if (typeof collectionName !== "string" || !collectionName) {
      throw new Error("A collection is required when uploading media.");
    }
    return request(
      `/api/media/${encodeURIComponent(collectionName)}?filename=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream"
        },
        body: file
      }
    );
  }

  const adapter = {
    name: "api",
    label: `miniCMS API · ${apiOrigin}`,
    session: () => currentSession,
    subscribeSession(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    login,
    logout,
    resolveMediaUrl(path) {
      return buildImageServiceMediaUrl(path, {
        baseUrl: apiOrigin,
        config: currentConfig
      });
    },
    resolveImageUrl,
    getImageInfo,
    config: loadConfig,
    saveConfig,
    list: (collection) =>
      request(`/api/collections/${encodeURIComponent(collection)}`),
    record: (collection, id) =>
      request(
        `/api/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`
      ),
    save: (collection, record) =>
      request(
        `/api/collections/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(record)
        }
      ),
    create: (collection, record) =>
      request(`/api/collections/${encodeURIComponent(collection)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record)
      }),
    rename: (collection, id, nextId) =>
      request(
        `/api/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/rename`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: nextId })
        }
      ),
    uploadMedia,
    remove: (collection, id) =>
      request(
        `/api/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      )
  };

  await refreshSession();
  return adapter;
}

export {
  createApiAdapter,
  normalizeApiUrl,
  normalizeAuthUrl,
  normalizeSession
};
