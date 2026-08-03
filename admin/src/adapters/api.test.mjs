import assert from "node:assert/strict";
import test from "node:test";
import { buildImageServiceUrl } from "../../../core/image-service.js";
import { createApiAdapter, normalizeApiUrl } from "./api.js";
import { createAdapter } from "./index.js";

const TEST_SHA = "a".repeat(64);
const HERO_SOURCE = `/media/images/${TEST_SHA}/hero.png`;
const HUGE_SOURCE = `/media/images/${TEST_SHA}/huge.jpg`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values
  };
}

function browserFixture(origin = "https://admin.example.com") {
  const listeners = new Map();
  const popups = [];
  const openedUrls = [];
  const storage = memoryStorage();
  const windowObject = {
    location: { origin },
    sessionStorage: storage,
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(7);
        return bytes;
      }
    },
    open(url) {
      openedUrls.push(url);
      const popup = {
        closed: false,
        close() {
          this.closed = true;
        }
      };
      popups.push(popup);
      return popup;
    },
    setInterval(callback) {
      this.closePoll = callback;
      return 1;
    },
    clearInterval() {
      this.closePoll = null;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    }
  };
  return {
    windowObject,
    storage,
    popups,
    openedUrls,
    dispatchMessage(event) {
      listeners.get("message")?.(event);
    }
  };
}

test("validates and normalizes miniCMS API origins", () => {
  const localBrowser = browserFixture("http://127.0.0.1:4321");
  assert.equal(
    normalizeApiUrl("", { windowObject: localBrowser.windowObject }).apiOrigin,
    "http://127.0.0.1:4321"
  );
  assert.equal(
    normalizeApiUrl("http://127.0.0.1:4321/", {
      windowObject: localBrowser.windowObject
    }).apiUrl,
    "http://127.0.0.1:4321"
  );
  assert.equal(
    normalizeApiUrl("https://content.example.com/", {
      windowObject: localBrowser.windowObject
    }).apiOrigin,
    "https://content.example.com"
  );
  for (const apiUrl of [
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://[::1]:8787"
  ]) {
    assert.equal(
      normalizeApiUrl(apiUrl, {
        windowObject: localBrowser.windowObject
      }).apiOrigin,
      apiUrl
    );
  }

  for (const invalidUrl of [
    "http://content.example.com",
    "http://192.168.1.10:8787",
    "https://user:secret@content.example.com",
    "https://content.example.com?project=test",
    "https://content.example.com#session",
    "https://content.example.com/base"
  ]) {
    assert.throws(
      () =>
        normalizeApiUrl(invalidUrl, {
          windowObject: localBrowser.windowObject
        }),
      /miniCMS API URL|remote miniCMS API URL/
    );
  }

  assert.throws(
    () =>
      normalizeApiUrl("http://127.0.0.1:8787", {
        windowObject: browserFixture("https://admin.example.com").windowObject
      }),
    /remote miniCMS API URL/
  );
});

test("uses the direct local API origin for requests and media", async () => {
  const browser = browserFixture("http://127.0.0.1:4321");
  const calls = [];
  const adapter = await createApiAdapter({
    apiUrl: "http://127.0.0.1:8787",
    windowObject: browser.windowObject,
    fetchImpl: async (input, options) => {
      calls.push({ input, options });
      return json({
        authenticated: true,
        authenticationRequired: false,
        provider: "local",
        label: "Local"
      });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].input).origin, "http://127.0.0.1:8787");
  assert.equal(new URL(calls[0].input).pathname, "/api/auth/session");
  assert.equal(adapter.name, "api");
  assert.deepEqual(adapter.session(), {
    authenticated: true,
    authenticationRequired: false,
    provider: "local",
    label: "Local"
  });
  assert.equal(
    adapter.resolveMediaUrl(HERO_SOURCE),
    `http://127.0.0.1:8787${HERO_SOURCE}`
  );
  assert.equal(
    adapter.resolveImageUrl(HERO_SOURCE, {
      width: 640,
      fit: "inside"
    }),
    buildImageServiceUrl(HERO_SOURCE, {
      baseUrl: "http://127.0.0.1:8787",
      config: null,
      width: 640,
      fit: "inside"
    })
  );
});

test("uses the active API capability and its latest config for images and info", async () => {
  const browser = browserFixture("http://127.0.0.1:4321");
  const config = {
    connectors: {
      default: {
        name: "github",
        repo: "signalwerk/example",
        branch: "main",
        base_url: "https://auth.example.com"
      }
    },
    site: {
      public_folder: "/media",
      image_processing: {
        format: "webp",
        quality: 78
      }
    },
    collections: {},
    node_types: {}
  };
  const information = {
    format: "jpeg",
    width: 10000,
    height: 7500,
    channels: 3,
    pages: 1,
    hasAlpha: false,
    hasProfile: true,
    size: 24000000
  };
  const calls = [];
  const adapter = await createApiAdapter({
    windowObject: browser.windowObject,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(input);
      calls.push({ url, options });
      if (url.pathname === "/api/auth/session") {
        return json({
          authenticated: true,
          authenticationRequired: false,
          provider: "local",
          label: "Local"
        });
      }
      if (url.pathname === "/api/config") return json(config);
      return json(information);
    }
  });

  await adapter.config();
  const options = { width: 2048, fit: "inside" };
  assert.equal(
    adapter.resolveImageUrl(HUGE_SOURCE, options),
    buildImageServiceUrl(HUGE_SOURCE, {
      ...options,
      baseUrl: "http://127.0.0.1:4321",
      config
    })
  );
  assert.deepEqual(await adapter.getImageInfo(HUGE_SOURCE), information);
  assert.equal(
    calls.at(-1).url.toString(),
    buildImageServiceUrl(HUGE_SOURCE, {
      baseUrl: "http://127.0.0.1:4321",
      config,
      info: true
    })
  );
  assert.equal(calls.at(-1).options.headers, undefined);
  assert.equal(
    await adapter.getImageInfo("https://images.example/remote.jpg"),
    null
  );
  assert.equal(
    await adapter.getImageInfo("  https://images.example/remote.jpg  "),
    null
  );
  assert.equal(await adapter.getImageInfo("   "), null);
  assert.equal(calls.length, 3);
});

test("maps a configured public media folder to the fixed service namespace", async () => {
  const browser = browserFixture("http://127.0.0.1:4321");
  const config = {
    site: { public_folder: "/assets/library/" },
    collections: {},
    node_types: {}
  };
  const adapter = await createApiAdapter({
    windowObject: browser.windowObject,
    fetchImpl: async (input) =>
      new URL(input).pathname === "/api/config"
        ? json(config)
        : json({
            authenticated: true,
            authenticationRequired: false,
            provider: "local",
            label: "Local"
          })
  });

  await adapter.config();
  assert.equal(
    adapter.resolveMediaUrl(
      `/assets/library/files/${TEST_SHA}/research-draft.pdf?download=1#page=2`
    ),
    `http://127.0.0.1:4321/media/files/${TEST_SHA}/research-draft.pdf?download=1#page=2`
  );
  assert.equal(
    adapter.resolveMediaUrl(
      `assets/library/files/${TEST_SHA}/report.pdf`
    ),
    `http://127.0.0.1:4321/media/files/${TEST_SHA}/report.pdf`
  );
  assert.equal(
    adapter.resolveMediaUrl(
      `/media/files/${TEST_SHA}/already-normalized.pdf`
    ),
    `http://127.0.0.1:4321/media/files/${TEST_SHA}/already-normalized.pdf`
  );
  assert.throws(
    () => adapter.resolveMediaUrl("/downloads/unmanaged.pdf"),
    /<collection>\/<sha256>\/<filename>/
  );
  assert.equal(
    adapter.resolveMediaUrl("https://cdn.example.com/report.pdf"),
    "https://cdn.example.com/report.pdf"
  );
  assert.equal(
    adapter.resolveMediaUrl("//cdn.example.com/report.pdf"),
    "//cdn.example.com/report.pdf"
  );
});

test("sends the stored service bearer with every API operation", async () => {
  const browser = browserFixture();
  const apiOrigin = "https://content.example.com";
  const storageKey = `minicms:api:${apiOrigin}:session`;
  browser.storage.setItem(storageKey, "opaque-service-session");
  const calls = [];
  const adapter = await createApiAdapter({
    apiUrl: apiOrigin,
    windowObject: browser.windowObject,
    fetchImpl: async (input, options = {}) => {
      calls.push({ url: new URL(input), options });
      if (new URL(input).pathname === "/api/auth/session") {
        return json({
          authenticated: true,
          authenticationRequired: true,
          provider: "github",
          label: "signalwer",
          login: "signalwer"
        });
      }
      if ((options.method || "GET") === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return json({ ok: true });
    }
  });

  const record = { id: "home", type: "page", properties: {}, slots: {} };
  await adapter.config();
  await adapter.saveConfig({ collections: {}, node_types: {} });
  await adapter.list("pages");
  await adapter.record("pages", "home");
  await adapter.save("pages", record);
  await adapter.create("pages", record);
  await adapter.rename("pages", "home", "start");
  await adapter.uploadMedia(
    { name: "Hero image.png", type: "image/png" },
    "images"
  );
  await adapter.remove("pages", "home");

  assert.equal(calls.length, 10);
  for (const call of calls) {
    assert.equal(
      call.options.headers.get("authorization"),
      "Bearer opaque-service-session"
    );
  }
  assert.equal(calls.at(-2).options.headers.get("content-type"), "image/png");
  assert.equal(calls.at(-2).url.pathname, "/api/media/images");
  assert.equal(calls.at(-2).url.searchParams.get("filename"), "Hero image.png");
  assert.equal(calls.at(-1).options.method, "DELETE");
});

test("requires collection context for API media uploads", async () => {
  const browser = browserFixture("http://127.0.0.1:4321");
  const adapter = await createApiAdapter({
    windowObject: browser.windowObject,
    fetchImpl: async () =>
      json({
        authenticated: true,
        authenticationRequired: false,
        provider: "local",
        label: "Local"
      })
  });

  assert.throws(
    () => adapter.uploadMedia({ name: "hero.png", type: "image/png" }),
    /collection is required/
  );
});

test("clears and publishes an unauthenticated API session after a 401", async () => {
  const browser = browserFixture();
  const storageKey = "minicms:api:https://content.example.com:session";
  browser.storage.setItem(storageKey, "expired-service-session");
  const adapter = await createApiAdapter({
    apiUrl: "https://content.example.com",
    windowObject: browser.windowObject,
    fetchImpl: async (input) =>
      new URL(input).pathname === "/api/auth/session"
        ? json({
            authenticated: true,
            authenticationRequired: true,
            provider: "github",
            label: "signalwer"
          })
        : json({ message: "Session expired." }, 401)
  });
  const sessions = [];
  adapter.subscribeSession((session) => sessions.push(session));

  await assert.rejects(() => adapter.config(), /Session expired/);
  assert.equal(browser.storage.getItem(storageKey), null);
  assert.equal(adapter.session().authenticated, false);
  assert.equal(adapter.session().authenticationRequired, true);
  assert.equal(sessions.at(-1).provider, "github");
});

test("exchanges only an exact popup message for an opaque API bearer", async () => {
  const browser = browserFixture();
  const apiOrigin = "https://content.example.com";
  const nonce = "fixed-auth-nonce";
  let authenticated = false;
  const calls = [];
  const adapter = await createApiAdapter({
    apiUrl: apiOrigin,
    windowObject: browser.windowObject,
    nonceFactory: () => nonce,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(input);
      calls.push({ url, options });
      if (url.pathname === "/api/auth/session") {
        return json(
          authenticated
            ? {
                authenticated: true,
                authenticationRequired: true,
                provider: "github",
                label: "signalwer",
                login: "signalwer"
              }
            : {
                authenticated: false,
                authenticationRequired: true,
                provider: "github",
                label: "Sign in"
              }
        );
      }
      if (url.pathname === "/api/auth/exchange") {
        authenticated = true;
        return json({ token: "opaque-service-bearer" });
      }
      if (url.pathname === "/api/auth/logout") {
        authenticated = false;
        return new Response(null, { status: 204 });
      }
      return json({ message: "Unexpected request." }, 500);
    }
  });

  const firstLogin = adapter.login();
  const firstPopup = browser.popups[0];
  const successMessage = {
    type: "minicms:api-auth",
    status: "success",
    code: "single-use-code",
    nonce
  };
  browser.dispatchMessage({
    origin: "https://attacker.example.com",
    source: firstPopup,
    data: successMessage
  });
  browser.dispatchMessage({
    origin: apiOrigin,
    source: {},
    data: successMessage
  });
  browser.dispatchMessage({
    origin: apiOrigin,
    source: firstPopup,
    data: { ...successMessage, nonce: "wrong-nonce" }
  });
  assert.equal(
    calls.filter((call) => call.url.pathname === "/api/auth/exchange").length,
    0
  );

  browser.dispatchMessage({
    origin: apiOrigin,
    source: firstPopup,
    data: successMessage
  });
  assert.equal((await firstLogin).login, "signalwer");

  const openedUrl = new URL(browser.openedUrls[0]);
  assert.equal(openedUrl.origin, apiOrigin);
  assert.equal(openedUrl.pathname, "/api/auth/github/start");
  assert.equal(openedUrl.searchParams.get("origin"), "https://admin.example.com");
  assert.equal(openedUrl.searchParams.get("nonce"), nonce);
  const exchange = calls.find(
    (call) => call.url.pathname === "/api/auth/exchange"
  );
  assert.deepEqual(JSON.parse(exchange.options.body), {
    code: "single-use-code",
    origin: "https://admin.example.com",
    nonce
  });
  assert.equal(exchange.options.headers.get("authorization"), null);
  assert.equal(
    browser.storage.getItem(`minicms:api:${apiOrigin}:session`),
    "opaque-service-bearer"
  );
  assert.equal(
    calls.at(-1).options.headers.get("authorization"),
    "Bearer opaque-service-bearer"
  );

  await adapter.logout();
  assert.equal(adapter.session().authenticated, false);
  assert.equal(
    browser.storage.getItem(`minicms:api:${apiOrigin}:session`),
    null
  );
  const logout = calls.find((call) => call.url.pathname === "/api/auth/logout");
  assert.equal(logout.options.method, "POST");
  assert.equal(
    logout.options.headers.get("authorization"),
    "Bearer opaque-service-bearer"
  );

  const deniedLogin = adapter.login();
  browser.dispatchMessage({
    origin: apiOrigin,
    source: browser.popups[1],
    data: {
      type: "minicms:api-auth",
      status: "error",
      message: "This GitHub account is not allowed.",
      nonce
    }
  });
  await assert.rejects(deniedLogin, /GitHub account is not allowed/);

  const secondLogin = adapter.login();
  browser.dispatchMessage({
    origin: apiOrigin,
    source: browser.popups[2],
    data: { ...successMessage, code: "second-single-use-code" }
  });
  assert.equal((await secondLogin).authenticated, true);
});

test("uses the reserved development connector when requested", async () => {
  const browser = browserFixture("http://127.0.0.1:4321");
  const adapter = await createAdapter({
    environment: "development",
    bootstrapConfig: {
      connectors: {
        default: {
          name: "github",
          repo: "signalwerk/example",
          branch: "main",
          base_url: "https://auth.example.com"
        },
        development: { name: "api", api_url: "" }
      },
      site: {},
      node_types: {
        page: { fields: { title: { widget: "string" } } }
      },
      collections: {
        pages: {
          folder: "content/pages",
          node_type: "page"
        }
      }
    },
    connectorOptions: {
      development: { windowObject: browser.windowObject }
    },
    fetchImpl: async () =>
      json({
        authenticated: true,
        authenticationRequired: false,
        provider: "local",
        label: "Local"
      })
  });

  assert.equal(adapter.name, "connectors");
  assert.match(adapter.label, /127\.0\.0\.1:4321/);
});
