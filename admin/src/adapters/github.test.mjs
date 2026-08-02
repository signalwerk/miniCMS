import test from "node:test";
import assert from "node:assert/strict";
import { dumpYaml } from "../../../core/content.js";
import {
  createGitHubAdapter,
  encodeBase64
} from "./github.js";
import { parseAuthorizationMessage } from "./github-auth.js";
import { createAdapter } from "./index.js";

function fixtureConfig() {
  return {
    backend: {
      name: "github",
      repo: "signalwerk/example",
      base_url: "https://auth.example.com",
      branch: "main"
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

function makeGitHubFixture() {
  const config = fixtureConfig();
  const record = {
    id: "home",
    type: "page",
    order: 0,
    properties: { title: "Home", image: "/media/hero.png" },
    slots: {}
  };
  const calls = [];
  const trees = [];
  let commitIndex = 0;

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
      return json(repositoryFile("cms.config.yml", dumpYaml(config), "config-sha"));
    }
    if (method === "GET" && url.pathname.endsWith("/contents/content/pages")) {
      return json([
        {
          type: "file",
          name: "home.yml",
          path: "content/pages/home.yml",
          sha: "home-sha"
        }
      ]);
    }
    if (
      method === "GET" &&
      url.pathname.endsWith("/contents/content/pages/home.yml")
    ) {
      return json(repositoryFile("content/pages/home.yml", dumpYaml(record), "home-sha"));
    }
    if (
      method === "GET" &&
      url.pathname.endsWith("/contents/content/media/hero.png")
    ) {
      return json(repositoryFile("content/media/hero.png", "image", "hero-sha"));
    }
    if (method === "GET" && url.pathname.endsWith("/contents/content/media")) {
      return json([]);
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
    if (method === "GET" && url.pathname.includes("/git/ref/heads/main")) {
      return json({ object: { sha: `parent-${commitIndex}` } });
    }
    if (method === "GET" && url.pathname.includes("/git/commits/parent-")) {
      return json({ tree: { sha: `tree-${commitIndex}` } });
    }
    if (method === "POST" && url.pathname.endsWith("/git/blobs")) {
      return json({ sha: "uploaded-blob" }, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/git/trees")) {
      trees.push(body.tree);
      return json({ sha: `next-tree-${commitIndex}` }, 201);
    }
    if (method === "POST" && url.pathname.endsWith("/git/commits")) {
      commitIndex += 1;
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
    adapter: createGitHubAdapter({ config, fetchImpl, auth }),
    calls,
    trees
  };
}

test("reads repository configuration and collection records", async () => {
  const { adapter } = makeGitHubFixture();
  const config = await adapter.config();
  const list = await adapter.list("pages");

  assert.equal(config.backend.repo, "signalwerk/example");
  assert.equal(list.items[0].id, "home");
  assert.equal(list.items[0].title, "Home");
  assert.equal(list.items[0].updated_at, "2026-07-31T10:00:00.000Z");
  assert.match(
    adapter.resolveMediaUrl("/media/hero image.png"),
    /^https:\/\/raw\.githubusercontent\.com\/signalwerk\/example\/main\/content\/media\/hero%20image\.png/
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

test("deletes a record and its configured upload in one Git commit", async () => {
  const { adapter, trees } = makeGitHubFixture();
  await adapter.config();

  await adapter.remove("pages", "home");

  assert.equal(trees.length, 1);
  assert.deepEqual(
    trees[0].map(({ path, sha }) => ({ path, sha })),
    [
      { path: "content/pages/home.yml", sha: null },
      { path: "content/media/hero.png", sha: null }
    ]
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

  const result = await adapter.uploadMedia(file);
  assert.equal(result.path, "/media/hero-image.png");
  assert.equal(trees[0][0].path, "content/media/hero-image.png");
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

  assert.equal((await adapter.uploadMedia(svg)).path, "/media/diagram.svg");
  assert.equal(trees[0][0].path, "content/media/diagram.svg");

  await assert.rejects(
    () => adapter.uploadMedia({ ...svg, name: "Photo.jpg", type: "image/jpeg" }),
    /configured accepted file type.*Received MIME type: image\/jpeg\./
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
    githubOptions: { auth },
    fetchImpl: async () => json({ message: "unused" }, 500)
  });
  assert.equal(githubAdapter.name, "github");
});
