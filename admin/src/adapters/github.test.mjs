import test from "node:test";
import assert from "node:assert/strict";
import { dumpYaml } from "../../../core/content.js";
import {
  createGitHubAdapter,
  encodeBase64
} from "./github.js";
import {
  createGitHubAuth,
  parseAuthorizationMessage
} from "./github-auth.js";
import { createAdapter } from "./index.js";

const RECORD_HASH = "a".repeat(64);
const BINARY_HASH =
  "054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8";
const SVG_HASH =
  "d4dc56669143034f31aa309635d4113d9ad76a02b1739da22c965ed2049be9e6";

function fixtureConfig() {
  return {
    connectors: {
      default: {
        name: "github",
        repo: "signalwerk/example",
        base_url: "https://auth.example.com",
        branch: "main"
      }
    },
    site: {
      media_folder: "content/media",
      public_folder: "/media"
    },
    node_types: {
      page: {
        label: "Page",
        fields: {
          title: { widget: "string" },
          image: { widget: "image", accept: ["image/png", "image/svg+xml"] },
          attachment: { widget: "file", accept: ["*/*"] }
        },
        slots: { content: { allowed_types: ["image_block"] } }
      },
      image_block: {
        fields: {
          image: { widget: "image", accept: ["image/png", "image/svg+xml"] }
        }
      }
    },
    collections: {
      pages: {
        label: "Pages",
        label_singular: "Page",
        folder: "content/pages",
        extension: "yml",
        node_type: "page",
        allowed_types: ["page"],
        delete_files_with_record: true
      }
    }
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function repositoryFile(path, source, sha = "blob-sha") {
  return {
    type: "file",
    path,
    sha,
    encoding: "base64",
    content: encodeBase64(new TextEncoder().encode(source))
  };
}

function makeGitHubFixture({
  treeEntries,
  loadedConfigSha = "config-sha",
  mediaEntriesByHash = {},
  additionalRecords = []
} = {}) {
  const config = fixtureConfig();
  const record = {
    id: "home",
    type: "page",
    order: 0,
    properties: {
      title: "Home",
      image: { hash: RECORD_HASH, filename: "hero.png" }
    },
    slots: {}
  };
  const calls = [];
  const trees = [];
  const records = [record, ...additionalRecords];
  const repositoryTree = treeEntries ?? [
    { path: "cms.config.yml", mode: "100644", type: "blob", sha: "config-sha" },
    { path: "content", mode: "040000", type: "tree", sha: "content-tree" },
    { path: "content/pages", mode: "040000", type: "tree", sha: "pages-tree" },
    { path: "content/pages/home.yml", mode: "100644", type: "blob", sha: "home-sha" },
    { path: "content/pages/archive", mode: "040000", type: "tree", sha: "archive-tree" },
    { path: "content/pages/archive/note.txt", mode: "100644", type: "blob", sha: "note-sha" }
  ];
  let commitIndex = 0;
  let headMessage = "Initial commit";
  let headTreeSha = "tree-0";

  async function fetchImpl(input, options = {}) {
    const url = new URL(input);
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({
      method,
      path: url.pathname,
      search: url.search,
      headers: options.headers,
      body
    });

    if (method === "GET" && url.pathname.endsWith("/contents/cms.config.yml")) {
      return json(
        repositoryFile("cms.config.yml", dumpYaml(config), loadedConfigSha)
      );
    }
    if (method === "GET" && url.pathname.endsWith("/contents/content/pages")) {
      return json(records.map((entry) => ({
          type: "file",
          name: `${entry.id}.yml`,
          path: `content/pages/${entry.id}.yml`,
          sha: `${entry.id}-sha`
        })));
    }
    if (
      method === "GET" &&
      url.pathname.includes("/contents/content/pages/")
    ) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1))
        .replace(/\.yml$/, "");
      const found = records.find((entry) => entry.id === id);
      return found
        ? json(repositoryFile(
            `content/pages/${id}.yml`,
            dumpYaml(found),
            `${id}-sha`
          ))
        : json({ message: "Not Found" }, 404);
    }
    if (
      method === "GET" &&
      url.pathname.endsWith(
        `/contents/content/media/${RECORD_HASH}/hero.png`
      )
    ) {
      return json(
        repositoryFile(
          `content/media/${RECORD_HASH}/hero.png`,
          "image",
          "hero-sha"
        )
      );
    }
    if (method === "GET" && url.pathname.endsWith("/contents/content/media")) {
      return json([]);
    }
    if (
      method === "GET" &&
      url.pathname.includes("/contents/content/media/")
    ) {
      const hash = url.pathname.split("/").at(-1);
      return Object.hasOwn(mediaEntriesByHash, hash)
        ? json(mediaEntriesByHash[hash])
        : json({ message: "Not Found" }, 404);
    }
    if (method === "GET" && url.pathname.endsWith("/commits")) {
      return json([
        {
          commit: {
            author: { date: "2026-07-31T10:00:00Z" }
          }
        }
      ]);
    }
    if (method === "GET" && url.pathname.includes("/git/blobs/")) {
      const sha = decodeURIComponent(url.pathname.split("/").at(-1));
      const entry = Object.values(mediaEntriesByHash)
        .flat()
        .find((candidate) => candidate.sha === sha);
      const bytes = entry?.bytes ?? Uint8Array.from([0, 1, 2, 3]);
      return entry
        ? json({ encoding: "base64", content: encodeBase64(bytes) })
        : json({ message: "Not Found" }, 404);
    }
    if (method === "GET" && url.pathname.includes("/git/ref/heads/main")) {
      return json({ object: { sha: `parent-${commitIndex}` } });
    }
    if (method === "GET" && url.pathname.includes("/git/commits/parent-")) {
      return json({
        tree: { sha: headTreeSha },
        message: headMessage
      });
    }
    if (method === "GET" && url.pathname.includes("/git/trees/tree-")) {
      return json({ tree: repositoryTree, truncated: false });
    }
    if (method === "POST" && url.pathname.endsWith("/git/blobs")) {
      return json(
        {
          sha:
            body.encoding === "utf-8"
              ? "next-config-sha"
              : "uploaded-blob"
        },
        201
      );
    }
    if (method === "POST" && url.pathname.endsWith("/git/trees")) {
      trees.push(body.tree);
      return json({ sha: `next-tree-${commitIndex}` }, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/git/commits")) {
      commitIndex += 1;
      headMessage = body.message;
      headTreeSha = body.tree;
      return json(
        {
          sha: `next-commit-${commitIndex}`,
          author: { date: "2026-07-31T12:00:00Z" }
        },
        201
      );
    }
    if (method === "PATCH" && url.pathname.includes("/git/refs/heads/main")) {
      return json({ object: { sha: body.sha } });
    }
    return json({ message: `Unhandled ${method} ${url.pathname}` }, 500);
  }

  const auth = {
    getToken: () => "github-token",
    async login() {
      return { token: "github-token" };
    },
    logout() {}
  };

  return {
    adapter: createGitHubAdapter({
      config,
      connector: config.connectors.default,
      fetchImpl,
      auth
    }),
    calls,
    trees
  };
}

test("reads repository configuration and collection records", async () => {
  const { adapter } = makeGitHubFixture();
  const config = structuredClone(await adapter.config());
  const list = await adapter.list("pages");

  assert.equal(config.connectors.default.repo, "signalwerk/example");
  assert.equal(list.items[0].id, "home");
  assert.equal(list.items[0].title, "Home");
  assert.equal(list.items[0].updated_at, "2026-07-31T10:00:00.000Z");
  assert.match(
    adapter.resolveMediaUrl("/media/hero image.png"),
    /^https:\/\/raw\.githubusercontent\.com\/signalwerk\/example\/main\/content\/media\/hero%20image\.png/
  );
  assert.equal(
    adapter.resolveImageUrl({ hash: RECORD_HASH, filename: "hero image.png" }, {
      width: 320,
      height: 320,
      fit: "inside",
      format: "webp",
      quality: 70
    }),
    `https://raw.githubusercontent.com/signalwerk/example/main/content/media/${RECORD_HASH}/hero%20image.png`
  );
});

test("writes YAML through one atomic Git commit transaction", async () => {
  const { adapter, calls, trees } = makeGitHubFixture();
  await adapter.config();
  const record = await adapter.record("pages", "home");
  record.properties.title = "Changed";

  const saved = await adapter.save("pages", record);
  assert.equal(saved.item.title, "Changed");
  assert.equal(trees.length, 1);
  assert.equal(trees[0][0].path, "content/pages/home.yml");
  assert.match(trees[0][0].content, /title: Changed/);
  assert.ok(
    calls.some(
      (call) =>
        call.method === "PATCH" &&
        call.path.endsWith("/git/refs/heads/main") &&
        call.headers.authorization === "Bearer github-token"
    )
  );
});

test("skips GitHub deployments and resumes them with the current tree", async () => {
  const { adapter, calls } = makeGitHubFixture();
  await adapter.config();
  const record = await adapter.record("pages", "home");

  await adapter.setSkipDeployments(true);
  record.properties.title = "First change";
  await adapter.save("pages", record);
  await adapter.setSkipDeployments(false);
  record.properties.title = "Second change";
  await adapter.save("pages", record);

  const commits = calls
    .filter(
      (call) =>
        call.method === "POST" && call.path.endsWith("/git/commits")
    );
  assert.deepEqual(commits.map((call) => call.body.message), [
    "Update Page home [ci skip]",
    "Resume deployments",
    "Update Page home"
  ]);
  assert.equal(commits[1].body.tree, commits[0].body.tree);
});

test("synchronizes another tab without publishing a second resume commit", async () => {
  const { adapter, calls } = makeGitHubFixture();
  await adapter.config();
  const record = await adapter.record("pages", "home");

  await adapter.setSkipDeployments(true);
  await adapter.save("pages", record);
  await adapter.setSkipDeployments(false, { resume: false });

  assert.deepEqual(
    calls
      .filter(
        (call) =>
          call.method === "POST" && call.path.endsWith("/git/commits")
      )
      .map((call) => call.body.message),
    ["Update Page home [ci skip]"]
  );
});

test("serializes overlapping writes from one editor", async () => {
  const { adapter, calls } = makeGitHubFixture();
  await adapter.config();
  const record = await adapter.record("pages", "home");
  const first = structuredClone(record);
  const second = structuredClone(record);
  first.properties.title = "First change";
  second.properties.title = "Second change";

  await Promise.all([
    adapter.save("pages", first),
    adapter.save("pages", second)
  ]);

  assert.deepEqual(
    calls
      .filter(
        (call) =>
          call.method === "POST" && call.path.endsWith("/git/commits")
      )
      .map((call) => call.body.parents[0]),
    ["parent-0", "parent-1"]
  );
});

test("moves a collection folder with its config in one Git commit", async () => {
  const { adapter, calls, trees } = makeGitHubFixture();
  const config = structuredClone(await adapter.config());
  config.collections.pages.folder = "content/documents";

  const saved = await adapter.saveConfig(config);
  assert.equal(saved.config.collections.pages.folder, "content/documents");
  assert.equal(trees.length, 1);
  assert.ok(
    trees[0].some(
      (entry) =>
        entry.path === "content/documents/home.yml" &&
        entry.sha === "home-sha" &&
        entry.mode === "100644"
    )
  );
  assert.ok(
    trees[0].some(
      (entry) =>
        entry.path === "content/documents/archive/note.txt" &&
        entry.sha === "note-sha"
    )
  );
  assert.ok(
    trees[0].some(
      (entry) =>
        entry.path === "content/pages/home.yml" && entry.sha === null
    )
  );
  assert.ok(
    trees[0].some(
      (entry) =>
        entry.path === "cms.config.yml" &&
        entry.sha === "next-config-sha"
    )
  );
  assert.equal(
    calls.filter(
      (call) => call.method === "POST" && call.path.endsWith("/git/blobs")
    ).length,
    1
  );
  assert.ok(
    calls.some(
      (call) =>
        call.method === "POST" &&
        call.path.endsWith("/git/blobs") &&
        call.body.encoding === "utf-8" &&
        /folder: content\/documents/.test(call.body.content)
    )
  );
  assert.equal(
    calls.filter(
      (call) => call.method === "PATCH" && call.path.includes("/git/refs/")
    ).length,
    1
  );
});

test("rejects collection folder destination collisions before Git writes", async () => {
  const treeEntries = [
    { path: "cms.config.yml", mode: "100644", type: "blob", sha: "config-sha" },
    { path: "content/pages/home.yml", mode: "100644", type: "blob", sha: "home-sha" },
    { path: "content/documents/taken.yml", mode: "100644", type: "blob", sha: "taken-sha" }
  ];
  const { adapter, calls, trees } = makeGitHubFixture({ treeEntries });
  const config = structuredClone(await adapter.config());
  config.collections.pages.folder = "content/documents";

  await assert.rejects(adapter.saveConfig(config), /destination conflicts/);
  assert.equal(trees.length, 0);
  assert.equal(
    calls.filter((call) => ["POST", "PATCH"].includes(call.method)).length,
    0
  );
});

test("moves an empty GitHub collection with a config-only commit", async () => {
  const { adapter, trees } = makeGitHubFixture({
    treeEntries: [
      { path: "cms.config.yml", mode: "100644", type: "blob", sha: "config-sha" }
    ]
  });
  const config = structuredClone(await adapter.config());
  config.collections.pages.folder = "content/empty-pages";

  await adapter.saveConfig(config);
  assert.equal(trees.length, 1);
  assert.deepEqual(trees[0].map((entry) => entry.path), ["cms.config.yml"]);
});

test("rejects a stale config-only save before creating Git objects", async () => {
  const { adapter, calls, trees } = makeGitHubFixture({
    treeEntries: [
      {
        path: "cms.config.yml",
        mode: "100644",
        type: "blob",
        sha: "newer-config-sha"
      }
    ]
  });
  const config = structuredClone(await adapter.config());
  config.site.name = "Stale edit";

  await assert.rejects(
    adapter.saveConfig(config),
    (error) => error.status === 409 && /configuration changed/.test(error.message)
  );
  assert.equal(trees.length, 0);
  assert.equal(
    calls.filter((call) => ["POST", "PATCH"].includes(call.method)).length,
    0
  );
});

test("rejects a stale collection folder move before creating Git objects", async () => {
  const { adapter, calls, trees } = makeGitHubFixture({
    treeEntries: [
      {
        path: "cms.config.yml",
        mode: "100644",
        type: "blob",
        sha: "newer-config-sha"
      },
      {
        path: "content/pages/home.yml",
        mode: "100644",
        type: "blob",
        sha: "home-sha"
      }
    ]
  });
  const config = structuredClone(await adapter.config());
  config.collections.pages.folder = "content/documents";

  await assert.rejects(
    adapter.saveConfig(config),
    (error) => error.status === 409 && /configuration changed/.test(error.message)
  );
  assert.equal(trees.length, 0);
  assert.equal(
    calls.filter((call) => ["POST", "PATCH"].includes(call.method)).length,
    0
  );
});

test("deletes a record and its configured upload in one Git commit", async () => {
  const { adapter, trees } = makeGitHubFixture();
  await adapter.config();

  await adapter.remove("pages", "home");

  assert.equal(trees.length, 1);
  assert.deepEqual(
    trees[0].map(({ path, sha }) => ({ path, sha })),
    [
      { path: "content/pages/home.yml", sha: null },
      { path: `content/media/${RECORD_HASH}/hero.png`, sha: null }
    ]
  );
});

test("preserves an upload referenced only by nested content in another record", async () => {
  const nestedRecord = {
    id: "nested-user",
    type: "page",
    order: 1,
    properties: { title: "Nested user", image: "" },
    slots: {
      content: [{
        id: "nested-image",
        type: "image_block",
        properties: {
          image: { hash: RECORD_HASH, filename: "hero.png" }
        },
        slots: {}
      }]
    }
  };
  const { adapter, trees } = makeGitHubFixture({
    additionalRecords: [nestedRecord]
  });
  await adapter.config();

  await adapter.remove("pages", "home");

  assert.deepEqual(
    trees[0].map(({ path, sha }) => ({ path, sha })),
    [{ path: "content/pages/home.yml", sha: null }]
  );
});

test("uploads binary media through a blob and commit", async () => {
  const { adapter, calls, trees } = makeGitHubFixture();
  await adapter.config();
  const file = {
    name: "Hero Image.png",
    size: 4,
    type: "image/png",
    async arrayBuffer() {
      return Uint8Array.from([0, 1, 2, 3]).buffer;
    }
  };

  const result = await adapter.uploadMedia(file, "pages", { widget: "image" });
  assert.deepEqual(result, {
    hash: BINARY_HASH,
    filename: "Hero Image.png",
    path: `/media/${BINARY_HASH}/Hero%20Image.png`,
    storage_path: `content/media/${BINARY_HASH}/Hero Image.png`
  });
  assert.equal(
    trees[0][0].path,
    `content/media/${BINARY_HASH}/Hero Image.png`
  );
  assert.equal(trees[0][0].sha, "uploaded-blob");
  assert.ok(calls.some((call) => call.path.endsWith("/git/blobs")));
});

test("uses configured image types for GitHub media uploads", async () => {
  const { adapter, trees } = makeGitHubFixture();
  await adapter.config();
  const svg = {
    name: "Diagram.svg",
    size: 6,
    type: "image/svg+xml",
    async arrayBuffer() {
      return new TextEncoder().encode("<svg/>").buffer;
    }
  };

  assert.equal(
    (await adapter.uploadMedia(svg, "pages", { widget: "image" })).path,
    `/media/${SVG_HASH}/Diagram.svg`
  );
  assert.equal(trees[0][0].path, `content/media/${SVG_HASH}/Diagram.svg`);

  await assert.rejects(
    () => adapter.uploadMedia(svg, "pages"),
    /upload widget must be "image" or "file"/
  );
  await assert.rejects(
    () => adapter.uploadMedia(svg, "pages", { widget: "video" }),
    /upload widget must be "image" or "file"/
  );

  await assert.rejects(
    () => adapter.uploadMedia(
      { ...svg, name: "Photo.jpg", type: "image/jpeg" },
      "pages",
      { widget: "image" }
    ),
    /configured accepted file type.*Received MIME type: image\/jpeg\./
  );
});

test("requires a duplicate-hash choice before reusing or copying GitHub media", async () => {
  const existing = {
    type: "file",
    name: "Existing.png",
    path: `content/media/${BINARY_HASH}/Existing.png`,
    sha: "existing-blob"
  };
  const { adapter, trees } = makeGitHubFixture({
    mediaEntriesByHash: { [BINARY_HASH]: [existing] }
  });
  await adapter.config();
  const file = {
    name: "Existing.png",
    size: 4,
    type: "image/png",
    async arrayBuffer() {
      return Uint8Array.from([0, 1, 2, 3]).buffer;
    }
  };

  assert.deepEqual(await adapter.uploadMedia(file, "pages", { widget: "image" }), {
    duplicate: true,
    existing: {
      hash: BINARY_HASH,
      filename: "Existing.png",
      path: `/media/${BINARY_HASH}/Existing.png`,
      storage_path: `content/media/${BINARY_HASH}/Existing.png`
    },
    copy: {
      hash: BINARY_HASH,
      filename: "Existing-2.png",
      path: `/media/${BINARY_HASH}/Existing-2.png`,
      storage_path: `content/media/${BINARY_HASH}/Existing-2.png`
    }
  });
  assert.equal(trees.length, 0);

  assert.equal(
    (await adapter.uploadMedia(file, "pages", {
      widget: "image",
      duplicate: "reuse"
    })).reused,
    true
  );
  assert.equal(trees.length, 0);

  const copied = await adapter.uploadMedia(file, "pages", {
    widget: "image",
    duplicate: "copy"
  });
  assert.equal(copied.filename, "Existing-2.png");
  assert.equal(
    trees.at(-1)[0].path,
    `content/media/${BINARY_HASH}/Existing-2.png`
  );
});

test("rejects noncanonical or hash-mismatched existing GitHub media", async () => {
  const file = {
    name: "é.png",
    size: 4,
    type: "image/png",
    async arrayBuffer() {
      return Uint8Array.from([0, 1, 2, 3]).buffer;
    }
  };
  const decomposed = makeGitHubFixture({
    mediaEntriesByHash: {
      [BINARY_HASH]: [{
        type: "file",
        name: "é.png",
        path: `content/media/${BINARY_HASH}/é.png`,
        sha: "decomposed-blob"
      }]
    }
  }).adapter;
  await decomposed.config();
  await assert.rejects(
    () => decomposed.uploadMedia(file, "pages", { widget: "image" }),
    /not canonical NFC/
  );

  const mismatched = makeGitHubFixture({
    mediaEntriesByHash: {
      [BINARY_HASH]: [{
        type: "file",
        name: "Existing.png",
        path: `content/media/${BINARY_HASH}/Existing.png`,
        sha: "mismatched-blob",
        bytes: Uint8Array.from([9, 9, 9, 9])
      }]
    }
  }).adapter;
  await mismatched.config();
  await assert.rejects(
    () => mismatched.uploadMedia(file, "pages", { widget: "image" }),
    /does not match its content-addressed directory/
  );
});

test("parses the auth worker postMessage protocol", () => {
  assert.deepEqual(parseAuthorizationMessage("authorizing:github"), {
    status: "authorizing"
  });
  assert.equal(
    parseAuthorizationMessage(
      'authorization:github:success:{"token":"abc","provider":"github"}'
    ).result.token,
    "abc"
  );
  assert.equal(
    parseAuthorizationMessage('authorization:github:error:"Denied"').error,
    "Denied"
  );
});

test("keeps direct GitHub connector tokens in its established storage", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  let messageListener = null;
  const posted = [];
  const popup = {
    closed: false,
    postMessage(data, targetOrigin) {
      posted.push({ data, targetOrigin });
    },
    close() {
      this.closed = true;
    }
  };
  const windowObject = {
    open: () => popup,
    setInterval: () => 1,
    clearInterval() {},
    addEventListener(_type, listener) {
      messageListener = listener;
    },
    removeEventListener(_type, listener) {
      if (messageListener === listener) messageListener = null;
    }
  };
  const auth = createGitHubAuth({
    baseUrl: "https://auth.example.com",
    repository: "signalwerk/example",
    windowObject,
    storage
  });
  const login = auth.login();
  messageListener({
    origin: "https://auth.example.com",
    source: popup,
    data: "authorizing:github"
  });
  assert.deepEqual(posted, [
    { data: "ready", targetOrigin: "https://auth.example.com" }
  ]);
  messageListener({
    origin: "https://auth.example.com",
    source: popup,
    data: 'authorization:github:success:{"token":"github-token","provider":"github"}'
  });
  assert.equal((await login).token, "github-token");
  assert.equal(popup.closed, true);
  assert.equal(messageListener, null);
  assert.equal(auth.getToken(), "github-token");
  assert.equal(
    values.get("minicms:github:signalwerk/example:token"),
    "github-token"
  );
  auth.logout();
  assert.equal(auth.getToken(), "");
  assert.equal(values.size, 0);
});

test("clears a rejected stored GitHub session", async () => {
  let token = "expired-token";
  const auth = {
    getToken: () => token,
    login: async () => ({ token }),
    logout() {
      token = "";
    }
  };
  const adapter = createGitHubAdapter({
    config: fixtureConfig(),
    connector: fixtureConfig().connectors.default,
    auth,
    fetchImpl: async () => json({ message: "Bad credentials" }, 401)
  });

  await assert.rejects(() => adapter.login(), /Bad credentials/);
  assert.equal(adapter.session().authenticated, false);
  assert.equal(token, "");
});

test("adapter factory uses GitHub configuration", async () => {
  const auth = {
    getToken: () => "token",
    login: async () => ({ token: "token" }),
    logout() {}
  };
  const githubAdapter = await createAdapter({
    bootstrapConfig: fixtureConfig(),
    connectorOptions: { default: { auth } },
    fetchImpl: async () => json({ message: "unused" }, 500)
  });
  assert.equal(githubAdapter.name, "connectors");
  assert.match(githubAdapter.label, /signalwerk\/example/);
});
