import {
  buildImageServiceMediaUrl,
  buildImageServiceUrl,
  isExternalImageSource,
  normalizeHttpOrigin
} from "../../../core/image-service.js";

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

function randomNonce(windowObject) {
  const cryptoObject = windowObject.crypto ?? globalThis.crypto;
  if (!cryptoObject?.getRandomValues) {
    throw new Error("Secure random values are unavailable for GitHub sign-in.");
  }
  const bytes = new Uint8Array(24);
  cryptoObject.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    ""
  );
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
  fetchImpl = fetch,
  windowObject,
  storage: suppliedStorage,
  nonceFactory
} = {}) {
  const browser = browserWindow(windowObject);
  const { apiOrigin, pageOrigin } = normalizeApiUrl(apiUrl, {
    windowObject: browser
  });
  const storage = availableSessionStorage(browser, suppliedStorage);
  const storageKey = `minicms:api:${apiOrigin}:session`;
  const listeners = new Set();
  let bearer = storage?.getItem(storageKey) || "";
  let loginPromise = null;
  let currentConfig = null;
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

  async function request(path, options = {}) {
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
    return body;
  }

  async function refreshSession() {
    try {
      return emitSession(await request("/api/auth/session"));
    } catch (error) {
      if (error.status === 401) return currentSession;
      throw error;
    }
  }

  function beginLogin() {
    return new Promise((resolve, reject) => {
      const nonce = (nonceFactory || (() => randomNonce(browser)))();
      if (typeof nonce !== "string" || !nonce) {
        reject(new Error("Could not create a GitHub sign-in nonce."));
        return;
      }
      const authUrl = new URL("/api/auth/github/start", apiOrigin);
      authUrl.searchParams.set("origin", pageOrigin);
      authUrl.searchParams.set("nonce", nonce);
      const popup = browser.open(
        authUrl.toString(),
        "minicms-api-github-oauth",
        "popup=yes,width=700,height=800"
      );
      if (!popup) {
        reject(new Error("Allow popups to sign in with GitHub."));
        return;
      }

      let settled = false;
      const closePoll = browser.setInterval(() => {
        if (settled || !popup.closed) return;
        cleanup(false);
        reject(new Error("GitHub sign-in was closed."));
      }, 400);

      function cleanup(closePopup = true) {
        settled = true;
        browser.clearInterval(closePoll);
        browser.removeEventListener("message", onMessage);
        if (closePopup) {
          try {
            popup.close();
          } catch {
            // A completed cross-origin popup may already be unavailable.
          }
        }
      }

      async function onMessage(event) {
        if (settled || event.origin !== apiOrigin || event.source !== popup) {
          return;
        }
        const message = event.data;
        if (
          !message ||
          typeof message !== "object" ||
          message.type !== "minicms:api-auth" ||
          message.nonce !== nonce
        ) {
          return;
        }

        if (message.status === "error") {
          cleanup();
          reject(
            new Error(
              typeof message.message === "string" && message.message
                ? message.message
                : "GitHub sign-in failed."
            )
          );
          return;
        }
        if (
          message.status !== "success" ||
          typeof message.code !== "string" ||
          !message.code
        ) {
          return;
        }

        cleanup();
        try {
          const exchange = await request("/api/auth/exchange", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              code: message.code,
              origin: pageOrigin,
              nonce
            })
          });
          if (typeof exchange?.token !== "string" || !exchange.token) {
            throw new Error("The miniCMS API returned no session token.");
          }
          storeBearer(exchange.token);
          const session = await refreshSession();
          if (!session.authenticated) {
            throw new Error("The miniCMS API did not establish a session.");
          }
          resolve(session);
        } catch (error) {
          rejectSession();
          reject(error);
        }
      }

      browser.addEventListener("message", onMessage);
    });
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
    const config = await request("/api/config");
    currentConfig = config;
    return config;
  }

  async function saveConfig(config) {
    const result = await request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    });
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

export { createApiAdapter, normalizeApiUrl, normalizeSession };
