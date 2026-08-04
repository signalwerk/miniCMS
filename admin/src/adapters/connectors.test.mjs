import assert from "node:assert/strict";
import test from "node:test";
import { createConnectorAdapter } from "./connectors.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function sourceConfig() {
  return {
    connectors: {
      default: {
        name: "github",
        repo: "signalwerk/project",
        branch: "main",
        base_url: "https://auth.example.com"
      },
      development: { name: "api", api_url: "" },
      central: {
        name: "api",
        api_url: "https://media.example.com",
        auth_url: "https://auth.example.com"
      },
      unused: {
        name: "api",
        api_url: "https://unused.example.com",
        auth_url: "https://auth.example.com"
      }
    },
    site: {},
    node_types: {
      page: {
        fields: {
          title: { widget: "string" },
          image: { widget: "reference", collection: "shared_images" }
        }
      },
      shared_image: { connector: "central", remote_type: "image" }
    },
    collections: {
      pages: {
        folder: "content/pages",
        node_type: "page"
      },
      shared_images: {
        connector: "central",
        remote_collection: "images"
      }
    }
  };
}

function remoteConfig() {
  return {
    connectors: {
      default: {
        name: "api",
        api_url: "https://media.example.com",
        auth_url: "https://auth.example.com"
      }
    },
    site: {},
    node_types: {
      image: {
        fields: {
          title: { widget: "string" },
          file: { widget: "image" }
        }
      }
    },
    collections: {
      images: {
        folder: "content/images",
        node_type: "image",
        views: { reference: { title: "title", image: "file" } }
      }
    }
  };
}

function record(id, type, title = id) {
  return {
    id,
    type,
    order: 0,
    properties: { title, file: "/media/images/hash/image.jpg" },
    slots: {}
  };
}

function fakeConnector(key, config, calls, sessionOverrides = {}) {
  let currentConfig = structuredClone(config);
  let session = {
    authenticated: true,
    authenticationRequired: false,
    provider: "local",
    label: key,
    ...sessionOverrides
  };
  const listeners = new Set();
  const call = (method, ...args) => {
    calls.push({ key, method, args });
  };
  return {
    name: key,
    label: key,
    session: () => session,
    subscribeSession(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async login() {
      call("login");
      session = { ...session, authenticated: true };
      listeners.forEach((listener) => listener(session));
      return session;
    },
    async logout() {
      call("logout");
      session = { ...session, authenticated: false };
      listeners.forEach((listener) => listener(session));
      return session;
    },
    async config() {
      call("config");
      return structuredClone(currentConfig);
    },
    async saveConfig(nextConfig) {
      call("saveConfig", structuredClone(nextConfig));
      currentConfig = structuredClone(nextConfig);
      return { saved: true, config: structuredClone(nextConfig) };
    },
    async list(collection) {
      call("list", collection);
      return {
        collection,
        items: [record("hero", collection === "images" ? "image" : "page")]
      };
    },
    async record(collection, id) {
      call("record", collection, id);
      return record(id, collection === "images" ? "image" : "page");
    },
    async save(collection, value) {
      call("save", collection, structuredClone(value));
      return { saved: true, item: structuredClone(value) };
    },
    async create(collection, value) {
      call("create", collection, structuredClone(value));
      return { saved: true, item: structuredClone(value) };
    },
    async rename(collection, id, nextId) {
      call("rename", collection, id, nextId);
      return { record: record(nextId, collection === "images" ? "image" : "page") };
    },
    async remove(collection, id) {
      call("remove", collection, id);
    },
    async uploadMedia(file, collection) {
      call("uploadMedia", file.name, collection);
      return { path: `/media/${collection}/hash/${file.name}` };
    },
    resolveMediaUrl(path) {
      call("resolveMediaUrl", path);
      return `${key}:raw:${path}`;
    },
    resolveImageUrl(path, options) {
      call("resolveImageUrl", path, options);
      return `${key}:image:${path}`;
    },
    async getImageInfo(path) {
      call("getImageInfo", path);
      return { source: key, width: 100, height: 50 };
    }
  };
}

test("accepts only explicit production and development environments", async () => {
  await assert.rejects(
    createConnectorAdapter({
      sourceConfig: sourceConfig(),
      environment: "preview",
      connectorFactory() {
        throw new Error("must not instantiate");
      }
    }),
    /environment/
  );
});

test("passes the trusted API auth_url to the central popup", async () => {
  let listener = null;
  let openedUrl = "";
  const popup = {
    closed: false,
    postMessage() {},
    close() {
      this.closed = true;
    }
  };
  const windowObject = {
    location: { origin: "https://admin.example.com" },
    sessionStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {}
    },
    open(url) {
      openedUrl = url;
      return popup;
    },
    setInterval: () => 1,
    clearInterval() {},
    addEventListener(_type, nextListener) {
      listener = nextListener;
    },
    removeEventListener(_type, nextListener) {
      if (listener === nextListener) listener = null;
    }
  };
  const adapter = await createConnectorAdapter({
    sourceConfig: {
      connectors: {
        default: {
          name: "api",
          api_url: "https://content.example.com",
          auth_url: "https://auth.example.com"
        }
      },
      site: {},
      node_types: { page: { fields: { title: { widget: "string" } } } },
      collections: {
        pages: { folder: "content/pages", node_type: "page" }
      }
    },
    connectorOptions: { default: { windowObject } },
    fetchImpl: async () =>
      json({
        authenticated: false,
        authenticationRequired: true,
        provider: "github",
        label: "Sign in"
      })
  });

  const login = adapter.login();
  assert.equal(openedUrl, "https://auth.example.com/auth");
  listener({
    origin: "https://auth.example.com",
    source: popup,
    data: 'authorization:github:error:"Denied"'
  });
  await assert.rejects(login, /Denied/);
});

test("selects development and routes collection operations through remote aliases", async () => {
  const calls = [];
  const created = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    environment: "development",
    connectorOptions: {
      development: { marker: "development-options" },
      central: { marker: "central-options" }
    },
    connectorFactory: async ({ key, options }) => {
      created.push({ key, options });
      return fakeConnector(
        key,
        key === "central" ? remoteConfig() : sourceConfig(),
        calls
      );
    }
  });

  assert.deepEqual(created, [
    {
      key: "development",
      options: { marker: "development-options" }
    },
    { key: "central", options: { marker: "central-options" } }
  ]);

  const config = await adapter.config();
  assert.equal(config.node_types.shared_image.fields.file.widget, "image");
  assert.equal(config.collections.shared_images.node_type, "shared_image");

  const remoteList = await adapter.list("shared_images");
  assert.equal(remoteList.collection, "shared_images");
  assert.equal(remoteList.items[0].type, "shared_image");
  assert.deepEqual(
    calls.find((entry) => entry.key === "central" && entry.method === "list")
      .args,
    ["images"]
  );

  const remoteRecord = await adapter.record("shared_images", "hero");
  assert.equal(remoteRecord.type, "shared_image");

  await adapter.create("shared_images", {
    ...remoteRecord,
    id: "created"
  });
  const createCall = calls.find(
    (entry) => entry.key === "central" && entry.method === "create"
  );
  assert.equal(createCall.args[0], "images");
  assert.equal(createCall.args[1].type, "image");

  const saved = await adapter.save("shared_images", remoteRecord);
  assert.equal(saved.item.type, "shared_image");
  await adapter.rename("shared_images", "hero", "renamed");
  await adapter.remove("shared_images", "renamed");
  await adapter.uploadMedia({ name: "new.jpg" }, "shared_images");
  for (const method of ["record", "save", "rename", "remove"]) {
    assert.equal(
      calls.find(
        (entry) => entry.key === "central" && entry.method === method
      ).args[0],
      "images"
    );
  }
  assert.ok(
    calls.some(
      (entry) =>
        entry.key === "central" &&
        entry.method === "uploadMedia" &&
        entry.args[1] === "images"
    )
  );

  assert.equal(
    adapter.resolveImageUrl("/media/example.jpg", {
      collection: "shared_images",
      width: 320
    }),
    "central:image:/media/example.jpg"
  );
  assert.equal(
    adapter.resolveMediaUrl("/media/document.pdf", { collection: "pages" }),
    "development:raw:/media/document.pdf"
  );
  assert.deepEqual(
    await adapter.getImageInfo("/media/example.jpg", {
      collection: "shared_images"
    }),
    { source: "central", width: 100, height: 50 }
  );
  const imageCall = calls.find(
    (entry) => entry.key === "central" && entry.method === "resolveImageUrl"
  );
  assert.deepEqual(imageCall.args[1], { width: 320 });
});

test("saves collapsed source config only through the active default connector", async () => {
  const calls = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        key === "central" ? remoteConfig() : sourceConfig(),
        calls
      )
  });
  const effective = await adapter.config();
  effective.site.name = "Changed";
  const result = await adapter.saveConfig(effective);

  const writes = calls.filter((entry) => entry.method === "saveConfig");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, "default");
  assert.deepEqual(writes[0].args[0].node_types.shared_image, {
    connector: "central",
    remote_type: "image"
  });
  assert.deepEqual(writes[0].args[0].collections.shared_images, {
    connector: "central",
    remote_collection: "images"
  });
  assert.equal(result.config.node_types.shared_image.fields.file.widget, "image");
});

test("preflights remote aliases before writing the default connector", async () => {
  const calls = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        key === "central" ? remoteConfig() : sourceConfig(),
        calls
      )
  });
  const effective = await adapter.config();
  effective.collections.shared_images.remote_collection = "missing";

  await assert.rejects(adapter.saveConfig(effective), /has no collection/);
  assert.equal(
    calls.filter((entry) => entry.method === "saveConfig").length,
    0
  );
  assert.equal((await adapter.list("shared_images")).collection, "shared_images");
});

test("activates a trusted unused connector when a draft first references it", async () => {
  const calls = [];
  const created = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) => {
      created.push(key);
      return fakeConnector(
        key,
        ["central", "unused"].includes(key) ? remoteConfig() : sourceConfig(),
        calls,
        key === "unused"
          ? {
              authenticated: false,
              authenticationRequired: true,
              provider: "github",
              label: "Unused sign in"
            }
          : {}
      );
    }
  });
  const effective = await adapter.config();

  assert.deepEqual(created, ["default", "central"]);
  assert.equal(adapter.session().authenticated, true);

  effective.node_types.library_image = {
    connector: "unused",
    remote_type: "image"
  };
  effective.collections.library_images = {
    connector: "unused",
    remote_collection: "images"
  };
  const result = await adapter.saveConfig(effective);

  assert.deepEqual(created, ["default", "central", "unused"]);
  assert.equal(result.config.node_types.library_image.fields.file.widget, "image");
  assert.equal(result.config.collections.library_images.node_type, "library_image");
  assert.equal(adapter.session().pendingConnector, "unused");
  await adapter.login();
  const listed = await adapter.list("library_images");
  assert.equal(listed.collection, "library_images");
  assert.equal(listed.items[0].type, "library_image");
  assert.ok(
    calls.some(
      (entry) =>
        entry.key === "unused" &&
        entry.method === "list" &&
        entry.args[0] === "images"
    )
  );
});

test("keeps newly added and changed connectors after an unreferenced save", async () => {
  const calls = [];
  const created = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) => {
      created.push(key);
      return fakeConnector(
        key,
        key === "central" ? remoteConfig() : sourceConfig(),
        calls
      );
    }
  });
  const effective = await adapter.config();
  effective.connectors.unused.api_url = "https://changed.example.com";
  effective.connectors.later = {
    name: "api",
    api_url: "https://later.example.com",
    auth_url: "https://auth.example.com"
  };

  const result = await adapter.saveConfig(effective);
  assert.equal(
    result.config.connectors.unused.api_url,
    "https://changed.example.com"
  );
  assert.deepEqual(result.config.connectors.later, {
    name: "api",
    api_url: "https://later.example.com",
    auth_url: "https://auth.example.com"
  });
  assert.deepEqual(created, ["default", "central"]);
  assert.equal(
    calls.filter((entry) => entry.method === "saveConfig").length,
    1
  );
});

test("rejects a new referenced connector before writing", async () => {
  const calls = [];
  const created = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) => {
      created.push(key);
      return fakeConnector(
        key,
        key === "central" ? remoteConfig() : sourceConfig(),
        calls
      );
    }
  });
  const effective = await adapter.config();
  effective.connectors.new_media = {
    name: "api",
    api_url: "https://new-media.example.com",
    auth_url: "https://auth.example.com"
  };
  effective.node_types.new_image = {
    connector: "new_media",
    remote_type: "image"
  };
  effective.collections.new_images = {
    connector: "new_media",
    remote_collection: "images"
  };

  await assert.rejects(
    adapter.saveConfig(effective),
    /added or changed.*reload miniCMS/
  );
  assert.deepEqual(created, ["default", "central"]);
  assert.equal(
    calls.filter((entry) => entry.method === "saveConfig").length,
    0
  );
});

test("aggregates authentication only across connectors used by the project", async () => {
  const calls = [];
  const created = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) => {
      created.push(key);
      return fakeConnector(
        key,
        key === "central" ? remoteConfig() : sourceConfig(),
        calls,
        key === "central"
          ? {
              authenticated: false,
              authenticationRequired: true,
              provider: "github",
              label: "Central sign in"
            }
          : {}
      );
    }
  });

  assert.deepEqual(created, ["default", "central"]);
  assert.equal(adapter.session().authenticated, false);
  assert.equal(adapter.session().pendingConnector, "central");
  assert.equal((await adapter.login()).authenticated, true);
  assert.deepEqual(
    calls.filter((entry) => entry.method === "login").map((entry) => entry.key),
    ["central"]
  );
});

test("opens only one connector login per user action", async () => {
  const calls = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        key === "central" ? remoteConfig() : sourceConfig(),
        calls,
        {
          authenticated: false,
          authenticationRequired: true,
          provider: "github",
          label: `${key} sign in`
        }
      )
  });

  assert.equal((await adapter.login()).authenticated, false);
  assert.equal(adapter.session().pendingConnector, "central");
  assert.deepEqual(
    calls.filter((entry) => entry.method === "login").map((entry) => entry.key),
    ["default"]
  );

  assert.equal((await adapter.login()).authenticated, true);
  assert.deepEqual(
    calls.filter((entry) => entry.method === "login").map((entry) => entry.key),
    ["default", "central"]
  );
});

test("keeps connector origins locked to the bootstrap configuration", async () => {
  const bootstrap = sourceConfig();
  const live = sourceConfig();
  live.connectors.central.api_url = "https://redirect.example.com";
  live.connectors.central.auth_url = "https://redirect-auth.example.com";
  const adapter = await createConnectorAdapter({
    sourceConfig: bootstrap,
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        key === "central" ? remoteConfig() : live,
        []
      )
  });

  const config = await adapter.config();
  assert.equal(
    config.connectors.central.api_url,
    "https://media.example.com"
  );
  assert.equal(
    config.connectors.central.auth_url,
    "https://auth.example.com"
  );
});
