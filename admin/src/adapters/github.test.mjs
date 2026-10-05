import test from "node:test";
import assert from "node:assert/strict";
import { dumpYaml } from "../../../core/content.js";
import { recordFileStem } from "../../../core/slug.js";
import { buildInlineReferenceUrl } from "../../../core/inline-reference.js";
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
const HOME_ID = "pagehome0000001";
const HOME_STEM = `home-${HOME_ID}`;
const recordStem = (record) =>
  recordFileStem(record.id, { slug: "{{title}}" }, { fields: record.properties });
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
    },
    node_types: {
      page: {
        label: "Page",
        fields: {
          title: { widget: "string" },
          copy: { widget: "markdown" },
          image: { widget: "image", media_folder: "content/media", accept: ["image/png", "image/svg+xml"] },
          attachment: { widget: "file", media_folder: "content/media", accept: ["*/*"] }
        },
        slots: { content: { allowed_types: ["image_block"] } }
      },
      image_block: {
        fields: {
          image: { widget: "image", media_folder: "content/media", accept: ["image/png", "image/svg+xml"] }
        }
      }
    },
    collections: {
      pages: {
        label: "Pages",
        label_singular: "Page",
        folder: "content/pages",
        extension: "yml",
        slug: "{{title}}",
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
  additionalRecords = [],
  suppliedRecord,
  blobSourcesBySha = {},
  configureConfig
} = {}) {
  const config = fixtureConfig();
  configureConfig?.(config);
  const record = suppliedRecord ?? {
    id: HOME_ID,
    type: "page",
    order: 0,
    properties: {
      title: "Home",
      copy: "",
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
    { path: `content/pages/${HOME_STEM}.yml`, mode: "100644", type: "blob", sha: `${HOME_STEM}-sha` },
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
          name: `${recordStem(entry)}.yml`,
          path: `content/pages/${recordStem(entry)}.yml`,
          sha: `${recordStem(entry)}-sha`
        })));
    }
    if (
      method === "GET" &&
      url.pathname.includes("/contents/content/pages/")
    ) {
      const filename = decodeURIComponent(url.pathname.split("/").at(-1))
        .replace(/\.yml$/, "");
      const found = records.find((entry) => recordStem(entry) === filename);
      return found
        ? json(repositoryFile(
            `content/pages/${filename}.yml`,
            dumpYaml(found),
            `${filename}-sha`
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
      if (Object.hasOwn(blobSourcesBySha, sha)) {
        return json({
          encoding: "base64",
          content: encodeBase64(
            new TextEncoder().encode(blobSourcesBySha[sha])
          )
        });
      }
      const recordEntry = records.find((candidate) => `${recordStem(candidate)}-sha` === sha);
      if (recordEntry) {
        return json({
          encoding: "base64",
          content: encodeBase64(
            new TextEncoder().encode(dumpYaml(recordEntry))
          )
        });
      }
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
  assert.equal(list.items[0].id, HOME_ID);
  assert.equal(list.items[0].filename, HOME_STEM);
  assert.equal(list.items[0].title, "Home");
  assert.equal(list.items[0].updated_at, "2026-07-31T10:00:00.000Z");
  assert.match(
    adapter.resolveMediaUrl("content/media/hero image.png"),
    /^https:\/\/raw\.githubusercontent\.com\/signalwerk\/example\/main\/content\/media\/hero%20image\.png/
  );
  assert.equal(
    adapter.resolveImageUrl({ hash: RECORD_HASH, filename: "hero image.png" }, {
      width: 320,
      height: 320,
      fit: "inside",
      format: "webp",
      quality: 70,
      mediaFolder: "content/media"
    }),
    `https://raw.githubusercontent.com/signalwerk/example/main/content/media/${RECORD_HASH}/hero%20image.png`
  );
  assert.equal(
    adapter.resolveImageUrl(
      { hash: RECORD_HASH, filename: "hero.png" },
      { collection: "pages" }
    ),
    `https://raw.githubusercontent.com/signalwerk/example/main/content/media/${RECORD_HASH}/hero.png`
  );
  assert.equal(
    adapter.resolveImageUrl({ hash: RECORD_HASH, filename: "hero.png" }),
    ""
  );
});

test("writes YAML through one atomic Git commit transaction", async () => {
  const { adapter, calls, trees } = makeGitHubFixture();
  await adapter.config();
  const record = await adapter.record("pages", HOME_ID);
  record.properties.title = "Changed";

  const saved = await adapter.save("pages", record);
  assert.equal(saved.item.title, "Changed");
  assert.equal(trees.length, 1);
  assert.equal(trees[0][0].path, `content/pages/${HOME_STEM}.yml`);
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

test("names created files <slug>-<id> and renames only when the slug changes", async () => {
  const { adapter, trees } = makeGitHubFixture();
  await adapter.config();
  const created = await adapter.create("pages", {
    id: "pagefresh000001",
    type: "page",
    order: 1,
    properties: { title: "Fresh Page", copy: "" },
    slots: {}
  });
  assert.equal(trees.at(-1)[0].path, "content/pages/fresh-page-pagefresh000001.yml");
  assert.equal(created.item.filename, "fresh-page-pagefresh000001");
  await assert.rejects(
    adapter.create("pages", {
      id: HOME_ID,
      type: "page",
      order: 2,
      properties: { title: "Other" },
      slots: {}
    }),
    /already exists/
  );

  const commits = trees.length;
  const unchanged = await adapter.rename("pages", HOME_ID);
  assert.equal(unchanged.saved, false);
  assert.equal(unchanged.item.filename, HOME_STEM);
  assert.equal(trees.length, commits);
});

test("skips GitHub deployments and resumes them with the current tree", async () => {
  const { adapter, calls } = makeGitHubFixture();
  await adapter.config();
  const record = await adapter.record("pages", HOME_ID);

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
    `Update Page ${HOME_STEM} [ci skip]`,
    "Resume deployments",
    `Update Page ${HOME_STEM}`
  ]);
  assert.equal(commits[1].body.tree, commits[0].body.tree);
});

test("synchronizes another tab without publishing a second resume commit", async () => {
  const { adapter, calls } = makeGitHubFixture();
  await adapter.config();
  const record = await adapter.record("pages", HOME_ID);

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
    [`Update Page ${HOME_STEM} [ci skip]`]
  );
});

test("serializes overlapping writes from one editor", async () => {
  const { adapter, calls } = makeGitHubFixture();
  await adapter.config();
  const record = await adapter.record("pages", HOME_ID);
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
        entry.path === `content/documents/${HOME_STEM}.yml` &&
        entry.sha === `${HOME_STEM}-sha` &&
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
        entry.path === `content/pages/${HOME_STEM}.yml` && entry.sha === null
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

test("atomically rekeys schema, moves its folder, and migrates every record", async () => {
  const record = {
    id: HOME_ID,
    type: "page",
    order: 0,
    properties: {
      title: "Home",
      copy: `[Home](${buildInlineReferenceUrl("pages", HOME_ID)})`,
      image: { hash: RECORD_HASH, filename: "hero.png" }
    },
    slots: {}
  };
  const { adapter, calls, trees } = makeGitHubFixture({
    suppliedRecord: record
  });
  const config = structuredClone(await adapter.config());
  config.node_types.article = config.node_types.page;
  delete config.node_types.page;
  config.collections.articles = config.collections.pages;
  delete config.collections.pages;
  config.collections.articles.folder = "content/articles";
  config.collections.articles.node_type = "article";
  config.collections.articles.allowed_types = ["article"];

  const saved = await adapter.saveConfig(config, {
    schemaRenames: {
      node_types: { page: "article" },
      collections: { pages: "articles" }
    }
  });

  assert.equal(saved.config.collections.articles.folder, "content/articles");
  assert.equal(trees.length, 1);
  const migratedEntry = trees[0].find(
    ({ path }) => path === `content/articles/${HOME_STEM}.yml`
  );
  assert.ok(migratedEntry);
  assert.match(migratedEntry.content, /^id: pagehome0000001\ntype: article/m);
  assert.match(
    migratedEntry.content,
    /minicms:\/\/reference\/articles\/pagehome0000001/
  );
  assert.match(migratedEntry.content, /filename: hero\.png/);
  assert.ok(
    trees[0].some(
      ({ path, sha }) => path === `content/pages/${HOME_STEM}.yml` && sha === null
    )
  );
  assert.equal(
    calls.filter(
      ({ method, path }) => method === "POST" && path.endsWith("/git/commits")
    ).length,
    1
  );
});

test("atomically moves a collection folder and retargets its record extension", async () => {
  const { adapter, calls, trees } = makeGitHubFixture();
  const config = structuredClone(await adapter.config());
  config.collections.pages.folder = "content/documents";
  config.collections.pages.extension = "yaml";

  await adapter.saveConfig(config);

  assert.equal(trees.length, 1);
  const migratedEntry = trees[0].find(
    ({ path }) => path === `content/documents/${HOME_STEM}.yaml`
  );
  assert.ok(migratedEntry);
  assert.match(migratedEntry.content, /^id: pagehome0000001\ntype: page/m);
  assert.ok(
    trees[0].some(
      ({ path, sha }) => path === `content/pages/${HOME_STEM}.yml` && sha === null
    )
  );
  assert.ok(
    trees[0].some(
      ({ path, sha }) =>
        path === `content/documents/${HOME_STEM}.yml` && sha === null
    )
  );
  assert.ok(
    trees[0].some(
      ({ path, sha }) =>
        path === "content/documents/archive/note.txt" && sha === "note-sha"
    )
  );
  assert.equal(
    calls.filter(
      ({ method, path }) => method === "POST" && path.endsWith("/git/commits")
    ).length,
    1
  );
});

test("rejects records that a collection extension change would adopt", async () => {
  const { adapter, calls, trees } = makeGitHubFixture({
    treeEntries: [
      {
        path: "cms.config.yml",
        mode: "100644",
        type: "blob",
        sha: "config-sha"
      },
      {
        path: `content/pages/${HOME_STEM}.yml`,
        mode: "100644",
        type: "blob",
        sha: `${HOME_STEM}-sha`
      },
      {
        path: "content/pages/rogue.yaml",
        mode: "100644",
        type: "blob",
        sha: "rogue-sha"
      }
    ]
  });
  const config = structuredClone(await adapter.config());
  config.collections.pages.extension = "yaml";

  await assert.rejects(
    adapter.saveConfig(config),
    /Changing collection "pages" extension would adopt existing record path "content\/pages\/rogue\.yaml"/
  );
  assert.equal(trees.length, 0);
  assert.equal(
    calls.filter(({ method }) => ["POST", "PATCH"].includes(method)).length,
    0
  );
});

test("rewrites local remote-alias links without moving owner storage", async () => {
  const record = {
    id: HOME_ID,
    type: "page",
    order: 0,
    properties: {
      title: "Home",
      copy: `[Asset](${buildInlineReferenceUrl("shared_assets", "asset-1")})`,
      image: { hash: RECORD_HASH, filename: "hero.png" }
    },
    slots: {}
  };
  const { adapter, trees } = makeGitHubFixture({
    suppliedRecord: record,
    configureConfig(config) {
      config.connectors.central = {
        name: "api",
        api_url: "https://media.example.test",
        auth_url: "https://auth.example.test"
      };
      config.node_types.shared_asset = {
        connector: "central",
        remote_type: "asset"
      };
      config.collections.shared_assets = {
        connector: "central",
        remote_collection: "assets"
      };
    }
  });
  const config = structuredClone(await adapter.config());
  config.collections.library_assets = config.collections.shared_assets;
  delete config.collections.shared_assets;

  await adapter.saveConfig(config, {
    schemaRenames: {
      node_types: {},
      collections: { shared_assets: "library_assets" }
    }
  });

  const migratedEntry = trees[0].find(
    ({ path }) => path === `content/pages/${HOME_STEM}.yml`
  );
  assert.ok(migratedEntry);
  assert.match(
    migratedEntry.content,
    /minicms:\/\/reference\/library_assets\/asset-1/
  );
  assert.equal(
    trees[0].some(({ path }) => path.startsWith("content/shared_assets")),
    false
  );
});

test("rejects duplicate configured collection folders before Git writes", async () => {
  const { adapter, calls, trees } = makeGitHubFixture();
  const config = structuredClone(await adapter.config());
  config.collections.pages_copy = {
    ...structuredClone(config.collections.pages),
    label: "Pages copy"
  };

  await assert.rejects(
    adapter.saveConfig(config),
    /collection folders|overlap|same folder/i
  );
  assert.equal(trees.length, 0);
  assert.equal(
    calls.filter(({ method }) => ["POST", "PATCH"].includes(method)).length,
    0
  );
});

test("rejects a new collection that would adopt an unconfigured physical folder", async () => {
  const { adapter, calls, trees } = makeGitHubFixture({
    treeEntries: [
      {
        path: "cms.config.yml",
        mode: "100644",
        type: "blob",
        sha: "config-sha"
      },
      {
        path: `content/pages/${HOME_STEM}.yml`,
        mode: "100644",
        type: "blob",
        sha: `${HOME_STEM}-sha`
      },
      {
        path: "content/pages-copy/orphan.yml",
        mode: "100644",
        type: "blob",
        sha: "orphan-sha"
      }
    ]
  });
  const config = structuredClone(await adapter.config());
  config.collections.pages_copy = {
    ...structuredClone(config.collections.pages),
    label: "Pages copy",
    folder: "content/pages-copy"
  };

  await assert.rejects(
    adapter.saveConfig(config),
    /folder destination conflicts with "content\/pages-copy\/orphan.yml"/
  );
  assert.equal(trees.length, 0);
  assert.equal(
    calls.filter(({ method }) => ["POST", "PATCH"].includes(method)).length,
    0
  );
});

test("validates migrated records against the next schema before Git writes", async () => {
  const { adapter, calls, trees } = makeGitHubFixture({
    suppliedRecord: {
      id: HOME_ID,
      type: "page",
      order: 0,
      properties: {
        title: "Home",
        copy: "not an absolute URL",
        image: { hash: RECORD_HASH, filename: "hero.png" }
      },
      slots: {}
    }
  });
  const config = structuredClone(await adapter.config());
  config.node_types.article = config.node_types.page;
  config.node_types.article.fields.copy = { widget: "url" };
  delete config.node_types.page;
  config.collections.articles = config.collections.pages;
  delete config.collections.pages;
  config.collections.articles.folder = "content/articles";
  config.collections.articles.node_type = "article";
  config.collections.articles.allowed_types = ["article"];

  await assert.rejects(
    adapter.saveConfig(config, {
      schemaRenames: {
        node_types: { page: "article" },
        collections: { pages: "articles" }
      }
    }),
    /URL field/
  );
  assert.equal(trees.length, 0);
  assert.equal(
    calls.filter(({ method }) => ["POST", "PATCH"].includes(method)).length,
    0
  );
});

test("migrates the exact record blobs from the verified snapshot", async () => {
  const staleRecord = dumpYaml({
    id: HOME_ID,
    type: "missing",
    order: 0,
    properties: {},
    slots: {}
  });
  const { adapter, calls, trees } = makeGitHubFixture({
    treeEntries: [
      {
        path: "cms.config.yml",
        mode: "100644",
        type: "blob",
        sha: "config-sha"
      },
      {
        path: `content/pages/${HOME_STEM}.yml`,
        mode: "100644",
        type: "blob",
        sha: "snapshot-home-sha"
      }
    ],
    blobSourcesBySha: { "snapshot-home-sha": staleRecord }
  });
  const config = structuredClone(await adapter.config());
  config.node_types.article = config.node_types.page;
  delete config.node_types.page;
  config.collections.articles = config.collections.pages;
  delete config.collections.pages;
  config.collections.articles.folder = "content/articles";
  config.collections.articles.node_type = "article";
  config.collections.articles.allowed_types = ["article"];

  await assert.rejects(
    adapter.saveConfig(config, {
      schemaRenames: {
        node_types: { page: "article" },
        collections: { pages: "articles" }
      }
    }),
    /Record type "missing"|Unknown node type "missing"/
  );
  assert.equal(trees.length, 0);
  assert.ok(
    calls.some(
      ({ method, path }) =>
        method === "GET" && path.endsWith("/git/blobs/snapshot-home-sha")
    )
  );
  assert.equal(
    calls.filter(({ method }) => ["POST", "PATCH"].includes(method)).length,
    0
  );
});

test("rejects a Git tree at an exact migrated record destination", async () => {
  const { adapter, calls, trees } = makeGitHubFixture({
    treeEntries: [
      {
        path: "cms.config.yml",
        mode: "100644",
        type: "blob",
        sha: "config-sha"
      },
      {
        path: `content/pages/${HOME_STEM}.yml`,
        mode: "100644",
        type: "blob",
        sha: `${HOME_STEM}-sha`
      },
      {
        path: `content/pages/${HOME_STEM}.yaml`,
        mode: "040000",
        type: "tree",
        sha: "collision-tree-sha"
      },
      {
        path: `content/pages/${HOME_STEM}.yaml/kept.txt`,
        mode: "100644",
        type: "blob",
        sha: "kept-sha"
      }
    ]
  });
  const config = structuredClone(await adapter.config());
  config.collections.pages.extension = "yaml";

  await assert.rejects(
    adapter.saveConfig(config),
    /Schema migration destination conflicts with "content\/pages\/home-pagehome0000001\.yaml"/
  );
  assert.equal(trees.length, 0);
  assert.equal(
    calls.filter(({ method }) => ["POST", "PATCH"].includes(method)).length,
    0
  );
});

test("rejects collection folder destination collisions before Git writes", async () => {
  const treeEntries = [
    { path: "cms.config.yml", mode: "100644", type: "blob", sha: "config-sha" },
    { path: `content/pages/${HOME_STEM}.yml`, mode: "100644", type: "blob", sha: `${HOME_STEM}-sha` },
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
        path: `content/pages/${HOME_STEM}.yml`,
        mode: "100644",
        type: "blob",
        sha: `${HOME_STEM}-sha`
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

  await adapter.remove("pages", HOME_ID);

  assert.equal(trees.length, 1);
  assert.deepEqual(
    trees[0].map(({ path, sha }) => ({ path, sha })),
    [
      { path: `content/pages/${HOME_STEM}.yml`, sha: null },
      { path: `content/media/${RECORD_HASH}/hero.png`, sha: null }
    ]
  );
});

test("preserves an upload referenced only by nested content in another record", async () => {
  const nestedRecord = {
    id: "nesteduser00001",
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

  await adapter.remove("pages", HOME_ID);

  assert.deepEqual(
    trees[0].map(({ path, sha }) => ({ path, sha })),
    [{ path: `content/pages/${HOME_STEM}.yml`, sha: null }]
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

  const result = await adapter.uploadMedia(file, "pages", { widget: "image", mediaFolder: "content/media" });
  assert.deepEqual(result, {
    hash: BINARY_HASH,
    filename: "Hero Image.png",
    path: `content/media/${BINARY_HASH}/Hero%20Image.png`,
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
    (await adapter.uploadMedia(svg, "pages", { widget: "image", mediaFolder: "content/media" })).path,
    `content/media/${SVG_HASH}/Diagram.svg`
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
      { widget: "image", mediaFolder: "content/media" }
    ),
    /configured accepted file type.*Received MIME type: image\/jpeg\./
  );
  await assert.rejects(
    () => adapter.uploadMedia(svg, "pages", {
      widget: "image",
      mediaFolder: "content/other"
    }),
    /No image field in collection "pages" stores media in "content\/other"/
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

  assert.deepEqual(await adapter.uploadMedia(file, "pages", { widget: "image", mediaFolder: "content/media" }), {
    duplicate: true,
    existing: {
      hash: BINARY_HASH,
      filename: "Existing.png",
      path: `content/media/${BINARY_HASH}/Existing.png`,
      storage_path: `content/media/${BINARY_HASH}/Existing.png`
    },
    copy: {
      hash: BINARY_HASH,
      filename: "Existing-2.png",
      path: `content/media/${BINARY_HASH}/Existing-2.png`,
      storage_path: `content/media/${BINARY_HASH}/Existing-2.png`
    }
  });
  assert.equal(trees.length, 0);

  assert.equal(
    (await adapter.uploadMedia(file, "pages", {
      widget: "image",
      mediaFolder: "content/media",
      duplicate: "reuse"
    })).reused,
    true
  );
  assert.equal(trees.length, 0);

  const copied = await adapter.uploadMedia(file, "pages", {
    widget: "image",
    mediaFolder: "content/media",
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
    () => decomposed.uploadMedia(file, "pages", { widget: "image", mediaFolder: "content/media" }),
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
    () => mismatched.uploadMedia(file, "pages", { widget: "image", mediaFolder: "content/media" }),
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
