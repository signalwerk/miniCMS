import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { createApp } from "./app.mjs";

async function makeFixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "minicms-"));
  await fs.mkdir(path.join(rootDir, "content", "pages"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "cms.config.yml"),
    `site:
  media_folder: content/media
  public_folder: /media
node_types:
  page:
    kind: document
    fields:
      uuid: { widget: uuid }
      title: { widget: string }
    views:
      detail:
        panels:
          inspector:
            groups:
              content:
                fields: [title]
    slots:
      content:
        allowed_types: [text]
  text:
    kind: content
    fields:
      text: { widget: text }
collections:
  pages:
    folder: content/pages
    extension: yml
    slug: "{{title}}"
    node_type: page
    allowed_types: [page]
    hierarchy:
      enabled: true
      id_field: uuid
      parent_field: parent_uuid
      allowed_child_types: [page]
    views:
      list:
        type: tree
`,
    "utf8"
  );
  await fs.writeFile(
    path.join(rootDir, "content", "pages", "home.yml"),
    `id: home
type: page
order: 0
properties:
  uuid: 84a3ef27-cdce-477b-863f-c1f418037685
  parent_uuid: null
  title: Home
slots:
  content: []
`,
    "utf8"
  );
  return rootDir;
}

async function withServer(run) {
  const rootDir = await makeFixture();
  const server = createApp({ rootDir }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, rootDir);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

test("serves configuration and collection summaries", async () => {
  await withServer(async (baseUrl) => {
    const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
    assert.equal(config.collections.pages.slug, "{{title}}");
    assert.deepEqual(
      config.node_types.page.views.detail.panels.inspector.groups.content.fields,
      ["title"]
    );

    const collections = await fetch(`${baseUrl}/api/collections`).then((response) =>
      response.json()
    );
    assert.equal(collections.collections.pages.slug, "{{title}}");
    assert.equal(collections.collections.pages.views.list.type, "tree");

    const list = await fetch(`${baseUrl}/api/collections/pages`).then((response) =>
      response.json()
    );
    assert.deepEqual(list.items.map((item) => item.id), ["home"]);
    assert.equal(list.items[0].hierarchy_id, "84a3ef27-cdce-477b-863f-c1f418037685");
    assert.equal(list.items[0].hidden, false);
    assert.equal(list.items[0].properties.title, "Home");
    assert.match(list.items[0].created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(list.items[0].updated_at, /^\d{4}-\d{2}-\d{2}T/);

    const record = await fetch(`${baseUrl}/api/collections/pages/home`).then((response) =>
      response.json()
    );
    assert.equal(record.properties.title, "Home");
  });
});

test("validates and atomically saves the guided configuration", async () => {
  await withServer(async (baseUrl, rootDir) => {
    const config = await fetch(`${baseUrl}/api/config`).then((response) =>
      response.json()
    );
    config.site.name = "Edited project";
    config.node_types.page.fields.layout = {
      label: "Page layout",
      widget: "select",
      required: false,
      options: [
        { label: "Default", value: "default" },
        { label: "Wide", value: "wide" }
      ]
    };

    const saved = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).config.site.name, "Edited project");

    const source = await fs.readFile(
      path.join(rootDir, "cms.config.yml"),
      "utf8"
    );
    assert.match(source, /name: Edited project/);
    assert.match(source, /label: Page layout/);
    assert.match(source, /value: wide/);

    const invalid = structuredClone(config);
    invalid.node_types.page.fields.layout.widget = "object";
    const rejected = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invalid)
    });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).message, /unsupported widget "object"/);

    const current = await fetch(`${baseUrl}/api/config`).then((response) =>
      response.json()
    );
    assert.equal(current.site.name, "Edited project");
    assert.equal(current.node_types.page.fields.layout.widget, "select");
  });
});

test("rejects unknown detail field references in configuration", async () => {
  await withServer(async (baseUrl, rootDir) => {
    const configPath = path.join(rootDir, "cms.config.yml");
    const source = await fs.readFile(configPath, "utf8");
    await fs.writeFile(
      configPath,
      source.replace("fields: [title]", "fields: [missing_field]"),
      "utf8"
    );

    const response = await fetch(`${baseUrl}/api/config`);
    assert.equal(response.status, 500);
    assert.match((await response.json()).message, /unknown field "missing_field"/);
  });
});

test("uploads media with safe collision-resistant filenames", async () => {
  await withServer(async (baseUrl, rootDir) => {
    const upload = () =>
      fetch(`${baseUrl}/api/media?filename=${encodeURIComponent("Hero Image.png")}`, {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: Buffer.from("fake-png")
      });

    const first = await upload();
    assert.equal(first.status, 201);
    const firstResult = await first.json();
    assert.equal(firstResult.filename, "hero-image.png");
    assert.equal(firstResult.path, "/media/hero-image.png");

    const second = await upload();
    assert.equal(second.status, 201);
    const secondResult = await second.json();
    assert.equal(secondResult.filename, "hero-image-2.png");

    const stored = await fs.readFile(
      path.join(rootDir, "content", "media", "hero-image.png"),
      "utf8"
    );
    assert.equal(stored, "fake-png");
  });
});

test("persists a complete record as YAML and reads it back", async () => {
  await withServer(async (baseUrl, rootDir) => {
    const record = {
      id: "new-page",
      type: "page",
      order: 1,
      properties: {
        uuid: "d54b10eb-88ec-4ac8-937f-e1126f999a93",
        parent_uuid: "84a3ef27-cdce-477b-863f-c1f418037685",
        title: "New page",
        layout: "wide"
      },
      slots: {
        content: [
          { id: "intro", type: "text", properties: { text: "Hello" } }
        ]
      }
    };

    const created = await fetch(`${baseUrl}/api/collections/pages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record)
    });
    assert.equal(created.status, 201);

    record.properties.title = "Changed";
    const saved = await fetch(`${baseUrl}/api/collections/pages/new-page`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record)
    });
    assert.equal(saved.status, 200);

    const source = await fs.readFile(
      path.join(rootDir, "content", "pages", "new-page.yml"),
      "utf8"
    );
    assert.match(source, /title: Changed/);
    assert.match(source, /layout: wide/);
  });
});

test("renames a record file and updates its stored id", async () => {
  await withServer(async (baseUrl, rootDir) => {
    const renamed = await fetch(`${baseUrl}/api/collections/pages/home/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "renamed-home" })
    });
    assert.equal(renamed.status, 200);
    const result = await renamed.json();
    assert.equal(result.record.id, "renamed-home");
    assert.equal(result.item.id, "renamed-home");

    const oldRecord = await fetch(`${baseUrl}/api/collections/pages/home`);
    assert.equal(oldRecord.status, 404);
    const newRecord = await fetch(
      `${baseUrl}/api/collections/pages/renamed-home`
    ).then((response) => response.json());
    assert.equal(newRecord.id, "renamed-home");

    const source = await fs.readFile(
      path.join(rootDir, "content", "pages", "renamed-home.yml"),
      "utf8"
    );
    assert.match(source, /^id: renamed-home$/m);

    await fs.writeFile(
      path.join(rootDir, "content", "pages", "taken.yml"),
      source.replace("id: renamed-home", "id: taken"),
      "utf8"
    );
    const collision = await fetch(
      `${baseUrl}/api/collections/pages/renamed-home/rename`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "taken" })
      }
    );
    assert.equal(collision.status, 409);
    assert.match((await collision.json()).message, /already exists/);
  });
});

test("rejects child types that are not allowed by a slot", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/collections/pages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "bad-page",
        type: "page",
        properties: { title: "Bad" },
        slots: {
          content: [{ id: "nested-page", type: "page", properties: {} }]
        }
      })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.message, /not allowed/);
  });
});

test("deletes leaf records but refuses to orphan child records", async () => {
  await withServer(async (baseUrl) => {
    const child = {
      id: "child-page",
      type: "page",
      order: 1,
      properties: {
        uuid: "49c0c569-a0e1-4c4c-85c6-14b659aebd2d",
        parent_uuid: "84a3ef27-cdce-477b-863f-c1f418037685",
        title: "Child page",
        hidden: true
      },
      slots: { content: [] }
    };
    const created = await fetch(`${baseUrl}/api/collections/pages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(child)
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).item.hidden, true);

    const parentDelete = await fetch(`${baseUrl}/api/collections/pages/home`, {
      method: "DELETE"
    });
    assert.equal(parentDelete.status, 409);
    assert.match((await parentDelete.json()).message, /child records/);

    const childDelete = await fetch(`${baseUrl}/api/collections/pages/child-page`, {
      method: "DELETE"
    });
    assert.equal(childDelete.status, 204);

    const missing = await fetch(`${baseUrl}/api/collections/pages/child-page`);
    assert.equal(missing.status, 404);
  });
});
