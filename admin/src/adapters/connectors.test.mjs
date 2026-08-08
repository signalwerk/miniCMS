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

function fakeConnector(
  key,
  config,
  calls,
  sessionOverrides = {},
  behavior = {}
) {
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
      if (behavior.loginError) throw behavior.loginError;
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
      const saveConfigError = behavior.saveConfigErrors?.length
        ? behavior.saveConfigErrors.shift()
        : behavior.saveConfigError;
      if (saveConfigError) throw saveConfigError;
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
    },
    ...(behavior.deployment
      ? {
          setSkipDeployments(value, options) {
            call("setSkipDeployments", value, options);
            const deploymentError = behavior.deploymentError?.(value, options);
            if (deploymentError) throw deploymentError;
          }
        }
      : {})
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

test("rejects duplicate GitHub repository branches before creating adapters", async () => {
  const bootstrap = sourceConfig();
  bootstrap.connectors.archive = {
    ...bootstrap.connectors.default
  };
  bootstrap.node_types.archive_image = {
    connector: "archive",
    remote_type: "image"
  };
  bootstrap.collections.archive_images = {
    connector: "archive",
    remote_collection: "images"
  };

  await assert.rejects(
    createConnectorAdapter({
      sourceConfig: bootstrap,
      connectorFactory() {
        throw new Error("must not instantiate duplicate targets");
      }
    }),
    /target the same repository branch/
  );
});

test("rejects a duplicate GitHub repository branch during lazy activation", async () => {
  const calls = [];
  const created = [];
  const bootstrap = sourceConfig();
  bootstrap.connectors.archive = {
    ...bootstrap.connectors.default
  };
  const adapter = await createConnectorAdapter({
    sourceConfig: bootstrap,
    connectorFactory: async ({ key }) => {
      created.push(key);
      return fakeConnector(
        key,
        key === "central" ? remoteConfig() : bootstrap,
        calls
      );
    }
  });
  const effective = await adapter.config();
  effective.node_types.archive_image = {
    connector: "archive",
    remote_type: "image"
  };
  effective.collections.archive_images = {
    connector: "archive",
    remote_collection: "images"
  };

  await assert.rejects(
    adapter.saveConfig(effective),
    /target the same repository branch/
  );
  assert.equal(created.includes("archive"), false);
});

test("exposes and propagates GitHub deployment skipping to lazy connectors", async () => {
  const calls = [];
  const storageCalls = [];
  const bootstrap = sourceConfig();
  bootstrap.connectors.archive = {
    name: "github",
    repo: "signalwerk/archive",
    branch: "main",
    base_url: "https://auth.example.com"
  };
  const adapter = await createConnectorAdapter({
    sourceConfig: bootstrap,
    deploymentStorage: {
      getItem(key) {
        storageCalls.push(["getItem", key]);
        return "true";
      },
      setItem(key, value) {
        storageCalls.push(["setItem", key, value]);
      },
      removeItem(key) {
        storageCalls.push(["removeItem", key]);
      }
    },
    connectorFactory: async ({ key, connector }) =>
      fakeConnector(
        key,
        ["central", "archive"].includes(key)
          ? remoteConfig()
          : bootstrap,
        calls,
        {},
        { deployment: connector.name === "github" }
      )
  });

  assert.equal(adapter.deployment.supportsSkip, true);
  assert.equal(adapter.deployment.skip, true);
  assert.equal(
    adapter.deployment.storageKey,
    "minicms:skip-deployments:v1:https://api.github.com|signalwerk/project@main"
  );

  const effective = await adapter.config();
  effective.node_types.archive_image = {
    connector: "archive",
    remote_type: "image"
  };
  effective.collections.archive_images = {
    connector: "archive",
    remote_collection: "images"
  };
  await adapter.saveConfig(effective);
  await adapter.deployment.setSkip(false);

  assert.deepEqual(
    calls
      .filter((entry) => entry.method === "setSkipDeployments")
      .map((entry) => [entry.key, ...entry.args]),
    [
      ["default", true, { resume: false }],
      ["archive", true, { resume: false }],
      ["default", false, { resume: true }],
      ["archive", false, { resume: true }]
    ]
  );
  assert.deepEqual(storageCalls, [
    [
      "getItem",
      "minicms:skip-deployments:v1:https://api.github.com|signalwerk/project@main"
    ],
    [
      "removeItem",
      "minicms:skip-deployments:v1:https://api.github.com|signalwerk/project@main"
    ]
  ]);
});

test("does not resume a prepared connector that has not authenticated", async () => {
  const calls = [];
  const bootstrap = sourceConfig();
  bootstrap.connectors.archive = {
    name: "github",
    repo: "signalwerk/archive",
    branch: "main",
    base_url: "https://auth.example.com"
  };
  const adapter = await createConnectorAdapter({
    sourceConfig: bootstrap,
    connectorFactory: async ({ key, connector }) =>
      fakeConnector(
        key,
        ["central", "archive"].includes(key)
          ? remoteConfig()
          : bootstrap,
        calls,
        key === "archive"
          ? {
              provider: "github",
              authenticationRequired: true,
              authenticated: false
            }
          : {},
        { deployment: connector.name === "github" }
      )
  });
  await adapter.deployment.setSkip(true);
  const effective = await adapter.config();
  effective.node_types.archive_image = {
    connector: "archive",
    remote_type: "image"
  };
  effective.collections.archive_images = {
    connector: "archive",
    remote_collection: "images"
  };

  await assert.rejects(adapter.saveConfig(effective), /requires sign-in/);
  await adapter.deployment.setSkip(false);

  const archiveDeploymentCalls = calls.filter(
    (entry) =>
      entry.key === "archive" && entry.method === "setSkipDeployments"
  );
  assert.deepEqual(
    archiveDeploymentCalls.map((entry) => entry.args),
    [
      [true, { resume: false }],
      [false, { resume: false }]
    ]
  );
  assert.equal(
    calls.some((entry) => entry.key === "archive" && entry.method === "login"),
    false
  );
});

test("restores deployment skipping when one GitHub connector cannot resume", async () => {
  const calls = [];
  let storedValue = null;
  let resumeFails = true;
  const bootstrap = sourceConfig();
  bootstrap.connectors.central = {
    name: "github",
    repo: "signalwerk/media",
    branch: "main",
    base_url: "https://auth.example.com"
  };
  const adapter = await createConnectorAdapter({
    sourceConfig: bootstrap,
    deploymentStorage: {
      getItem() {
        return storedValue;
      },
      setItem(_key, value) {
        storedValue = value;
      },
      removeItem() {
        storedValue = null;
      }
    },
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        key === "central" ? remoteConfig() : bootstrap,
        calls,
        {},
        {
          deployment: true,
          deploymentError(value, options) {
            return resumeFails && key === "central" && !value && options?.resume
              ? new Error("branch changed")
              : null;
          }
        }
      )
  });

  await adapter.deployment.setSkip(true);
  await assert.rejects(adapter.deployment.setSkip(false), /branch changed/);

  assert.equal(adapter.deployment.skip, true);
  assert.equal(storedValue, "true");
  assert.deepEqual(
    calls
      .filter((entry) => entry.method === "setSkipDeployments")
      .slice(-4)
      .map((entry) => [entry.key, ...entry.args]),
    [
      ["default", false, { resume: true }],
      ["central", false, { resume: true }],
      ["default", true, { resume: false }],
      ["central", true, { resume: false }]
    ]
  );

  resumeFails = false;
  await adapter.deployment.setSkip(false);
  assert.equal(adapter.deployment.skip, false);
  assert.equal(storedValue, null);
});

test("does not mistake GitHub authentication for GitHub storage", async () => {
  const calls = [];
  const bootstrap = sourceConfig();
  bootstrap.connectors.default = {
    name: "api",
    api_url: "https://content.example.com",
    auth_url: "https://auth.example.com"
  };
  const adapter = await createConnectorAdapter({
    sourceConfig: bootstrap,
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        key === "central" ? remoteConfig() : bootstrap,
        calls,
        {
          provider: "github",
          authenticationRequired: true,
          authenticated: true
        }
      )
  });

  assert.equal(adapter.session().provider, "github");
  assert.equal(adapter.deployment.supportsSkip, false);
  assert.equal(adapter.deployment.storageKey, null);
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

test("saves edited remote schema only through its owner", async () => {
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
  effective.node_types.shared_image.label = "Edited image";
  effective.collections.shared_images.folder = "content/library-images";

  const result = await adapter.saveConfig(effective);
  const writes = calls.filter((entry) => entry.method === "saveConfig");
  assert.deepEqual(writes.map((entry) => entry.key), ["central"]);
  assert.equal(writes[0].args[0].node_types.image.label, "Edited image");
  assert.equal(
    writes[0].args[0].collections.images.folder,
    "content/library-images"
  );
  assert.equal(writes[0].args[0].node_types.image.connector, undefined);
  assert.equal(
    result.config.collections.shared_images.folder,
    "content/library-images"
  );
});

test("creates new remote schema before publishing its local aliases", async () => {
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
  effective.node_types.shared_quote = {
    connector: "central",
    remote_type: "quote",
    label: "Quote",
    fields: { text: { widget: "text" } }
  };
  effective.collections.shared_quotes = {
    connector: "central",
    remote_collection: "quotes",
    label: "Quotes",
    folder: "content/quotes",
    node_type: "shared_quote",
    allowed_types: ["shared_quote"]
  };

  const result = await adapter.saveConfig(effective);
  const writes = calls.filter((entry) => entry.method === "saveConfig");
  assert.deepEqual(writes.map((entry) => entry.key), ["central", "default"]);
  assert.equal(writes[0].args[0].collections.quotes.node_type, "quote");
  assert.deepEqual(writes[1].args[0].collections.shared_quotes, {
    connector: "central",
    remote_collection: "quotes"
  });
  assert.equal(result.config.node_types.shared_quote.fields.text.widget, "text");
});

test("retries default publication without rewriting a successful remote owner", async () => {
  const calls = [];
  const defaultBehavior = {
    saveConfigErrors: [new Error("Default unavailable"), null]
  };
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        key === "central" ? remoteConfig() : sourceConfig(),
        calls,
        {},
        key === "default" ? defaultBehavior : {}
      )
  });
  const effective = await adapter.config();
  effective.node_types.shared_quote = {
    connector: "central",
    remote_type: "quote",
    label: "Quote",
    fields: { text: { widget: "text" } }
  };
  effective.collections.shared_quotes = {
    connector: "central",
    remote_collection: "quotes",
    label: "Quotes",
    folder: "content/quotes",
    node_type: "shared_quote",
    allowed_types: ["shared_quote"]
  };

  await assert.rejects(
    adapter.saveConfig(effective),
    /Could not save the default connector: Default unavailable/
  );
  assert.deepEqual(
    calls
      .filter((entry) => entry.method === "saveConfig")
      .map((entry) => entry.key),
    ["central", "default"]
  );
  assert.equal((await adapter.config()).node_types.shared_quote, undefined);
  await assert.rejects(
    adapter.list("shared_quotes"),
    /Collection "shared_quotes" does not exist/
  );

  const result = await adapter.saveConfig(effective);
  assert.deepEqual(
    calls
      .filter((entry) => entry.method === "saveConfig")
      .map((entry) => entry.key),
    ["central", "default", "default"]
  );
  assert.equal(result.config.node_types.shared_quote.fields.text.widget, "text");
});

test("retries only unfinished owners before publishing aliases", async () => {
  const calls = [];
  const unusedBehavior = {
    saveConfigErrors: [new Error("Later unavailable"), null]
  };
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        ["central", "unused"].includes(key)
          ? remoteConfig()
          : sourceConfig(),
        calls,
        {},
        key === "unused" ? unusedBehavior : {}
      )
  });
  const effective = await adapter.config();
  effective.node_types.shared_quote = {
    connector: "central",
    remote_type: "quote",
    fields: { text: { widget: "text" } }
  };
  effective.collections.shared_quotes = {
    connector: "central",
    remote_collection: "quotes",
    folder: "content/quotes",
    node_type: "shared_quote"
  };
  effective.node_types.library_note = {
    connector: "unused",
    remote_type: "note",
    fields: { text: { widget: "text" } }
  };
  effective.collections.library_notes = {
    connector: "unused",
    remote_collection: "notes",
    folder: "content/notes",
    node_type: "library_note"
  };

  await assert.rejects(
    adapter.saveConfig(effective),
    /Could not save connector "unused": Later unavailable/
  );
  assert.deepEqual(
    calls
      .filter((entry) => entry.method === "saveConfig")
      .map((entry) => entry.key),
    ["central", "unused"]
  );
  const unpublished = await adapter.config();
  assert.equal(unpublished.node_types.shared_quote, undefined);
  assert.equal(unpublished.node_types.library_note, undefined);

  const result = await adapter.saveConfig(effective);
  assert.deepEqual(
    calls
      .filter((entry) => entry.method === "saveConfig")
      .map((entry) => entry.key),
    ["central", "unused", "unused", "default"]
  );
  assert.equal(result.config.node_types.shared_quote.fields.text.widget, "text");
  assert.equal(result.config.node_types.library_note.fields.text.widget, "text");
});

test("does not publish default aliases when an owner config write fails", async () => {
  const calls = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        key === "central" ? remoteConfig() : sourceConfig(),
        calls,
        {},
        key === "central"
          ? { saveConfigError: new Error("Remote unavailable") }
          : {}
      )
  });
  const effective = await adapter.config();
  effective.collections.shared_images.folder = "content/library-images";

  await assert.rejects(
    adapter.saveConfig(effective),
    /Could not save connector "central": Remote unavailable/
  );
  assert.deepEqual(
    calls.filter((entry) => entry.method === "saveConfig").map((entry) => entry.key),
    ["central"]
  );
  assert.equal(
    (await adapter.config()).collections.shared_images.folder,
    "content/images"
  );
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

  await assert.rejects(
    adapter.saveConfig(effective),
    /cannot change.*identity/
  );
  assert.equal(
    calls.filter((entry) => entry.method === "saveConfig").length,
    0
  );
  assert.equal((await adapter.list("shared_images")).collection, "shared_images");
});

test("prepares a trusted unused connector before a synchronous sign-in retry", async () => {
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
  const sessions = [];
  const unsubscribe = adapter.subscribeSession((session) => {
    sessions.push(structuredClone(session));
  });

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
  effective.node_types.library_note = {
    connector: "unused",
    remote_type: "note",
    label: "Note",
    fields: { text: { widget: "text" } }
  };
  effective.collections.library_notes = {
    connector: "unused",
    remote_collection: "notes",
    label: "Notes",
    folder: "content/notes",
    node_type: "library_note",
    allowed_types: ["library_note"]
  };
  await assert.rejects(
    adapter.saveConfig(effective),
    (error) =>
      error.code === "MINICMS_CONNECTOR_AUTHENTICATION_REQUIRED" &&
      error.connector === "unused"
  );

  assert.deepEqual(created, ["default", "central", "unused"]);
  assert.deepEqual(sessions, []);
  assert.deepEqual(
    calls.filter((entry) => entry.key === "unused"),
    []
  );

  const saving = adapter.saveConfig(effective, {
    authenticateConnector: "unused"
  });
  assert.deepEqual(
    calls
      .filter((entry) => entry.key === "unused")
      .map((entry) => entry.method),
    ["login"]
  );
  const result = await saving;

  assert.equal(result.config.node_types.library_image.fields.file.widget, "image");
  assert.equal(result.config.collections.library_images.node_type, "library_image");
  assert.equal(result.config.node_types.library_note.fields.text.widget, "text");
  assert.equal(adapter.session().authenticated, true);
  assert.equal(adapter.session().pendingConnector, undefined);
  assert.ok(sessions.length > 0);
  assert.ok(sessions.every((session) => session.authenticated));
  assert.deepEqual(
    calls
      .filter((entry) => entry.key === "unused")
      .map((entry) => entry.method),
    ["login", "config", "saveConfig"]
  );
  unsubscribe();
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

test("keeps a failed lazy connector login private from the editor session", async () => {
  const calls = [];
  const adapter = await createConnectorAdapter({
    sourceConfig: sourceConfig(),
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        ["central", "unused"].includes(key)
          ? remoteConfig()
          : sourceConfig(),
        calls,
        key === "unused"
          ? {
              authenticated: false,
              authenticationRequired: true,
              provider: "github",
              label: "Unused sign in"
            }
          : {},
        key === "unused"
          ? { loginError: new Error("Sign-in cancelled") }
          : {}
      )
  });
  const effective = await adapter.config();
  const sessions = [];
  adapter.subscribeSession((session) => sessions.push(structuredClone(session)));
  effective.node_types.library_image = {
    connector: "unused",
    remote_type: "image"
  };
  effective.collections.library_images = {
    connector: "unused",
    remote_collection: "images"
  };

  await assert.rejects(
    adapter.saveConfig(effective),
    (error) =>
      error.code === "MINICMS_CONNECTOR_AUTHENTICATION_REQUIRED" &&
      error.connector === "unused"
  );
  assert.deepEqual(
    calls.filter((entry) => entry.key === "unused"),
    []
  );
  await assert.rejects(
    adapter.saveConfig(effective, { authenticateConnector: "unused" }),
    /Sign-in cancelled/
  );
  assert.equal(adapter.session().authenticated, true);
  assert.equal(adapter.session().pendingConnector, undefined);
  assert.deepEqual(sessions, []);
  assert.deepEqual(
    calls
      .filter((entry) => entry.key === "unused")
      .map((entry) => entry.method),
    ["login"]
  );
  assert.equal(
    calls.filter((entry) => entry.method === "saveConfig").length,
    0
  );
});

test("opens at most one prepared connector login per Settings gesture", async () => {
  const calls = [];
  const bootstrap = sourceConfig();
  bootstrap.connectors.archive = {
    name: "api",
    api_url: "https://archive.example.com",
    auth_url: "https://auth.example.com"
  };
  const adapter = await createConnectorAdapter({
    sourceConfig: bootstrap,
    connectorFactory: async ({ key }) =>
      fakeConnector(
        key,
        ["central", "unused", "archive"].includes(key)
          ? remoteConfig()
          : bootstrap,
        calls,
        ["unused", "archive"].includes(key)
          ? {
              authenticated: false,
              authenticationRequired: true,
              provider: "github",
              label: `${key} sign in`
            }
          : {}
      )
  });
  const effective = await adapter.config();
  effective.node_types.library_image = {
    connector: "unused",
    remote_type: "image"
  };
  effective.collections.library_images = {
    connector: "unused",
    remote_collection: "images"
  };
  effective.node_types.archive_image = {
    connector: "archive",
    remote_type: "image"
  };
  effective.collections.archive_images = {
    connector: "archive",
    remote_collection: "images"
  };

  await assert.rejects(
    adapter.saveConfig(effective),
    (error) =>
      error.code === "MINICMS_CONNECTOR_AUTHENTICATION_REQUIRED" &&
      error.connector === "unused"
  );
  assert.deepEqual(
    calls.filter((entry) => entry.method === "login"),
    []
  );

  await assert.rejects(
    adapter.saveConfig(effective, { authenticateConnector: "unused" }),
    (error) =>
      error.code === "MINICMS_CONNECTOR_AUTHENTICATION_REQUIRED" &&
      error.connector === "archive"
  );
  assert.deepEqual(
    calls.filter((entry) => entry.method === "login").map((entry) => entry.key),
    ["unused"]
  );
  assert.equal(adapter.session().authenticated, true);

  const saving = adapter.saveConfig(effective, {
    authenticateConnector: "archive"
  });
  assert.deepEqual(
    calls.filter((entry) => entry.method === "login").map((entry) => entry.key),
    ["unused", "archive"]
  );
  const result = await saving;
  assert.equal(result.config.collections.archive_images.node_type, "archive_image");
  assert.equal(adapter.session().authenticated, true);
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
