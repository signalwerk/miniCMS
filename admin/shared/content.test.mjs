import test from "node:test";
import assert from "node:assert/strict";
import {
  dumpYaml,
  parseYaml,
  summarizeRecord,
  validateConfig
} from "./content.js";

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
        fields: {
          title: { widget: "string" }
        }
      }
    },
    collections: {
      pages: {
        folder: "content/pages",
        extension: "yml",
        node_type: "page",
        allowed_types: ["page"]
      }
    }
  };
}

test("parses and writes deterministic JSON-schema YAML", () => {
  const source = dumpYaml({
    published: "2026-07-31",
    enabled: true
  });
  assert.match(source, /published: "2026-07-31"/);
  assert.equal(parseYaml(source).published, "2026-07-31");
});

test("validates GitHub backend and repository content paths", () => {
  assert.equal(validateConfig(fixtureConfig()).backend.name, "github");

  const invalidRepository = fixtureConfig();
  invalidRepository.backend.repo = "missing-owner";
  assert.throws(
    () => validateConfig(invalidRepository, 400),
    /owner\/repository/
  );

  const escapedFolder = fixtureConfig();
  escapedFolder.collections.pages.folder = "../outside";
  assert.throws(
    () => validateConfig(escapedFolder, 400),
    /Invalid Collection "pages" folder/
  );
});

test("normalizes legacy image accept strings to the array config shape", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.image = {
    widget: "image",
    accept: "image/png,image/svg+xml"
  };

  assert.deepEqual(validateConfig(config).node_types.page.fields.image.accept, [
    "image/png",
    "image/svg+xml"
  ]);
});

test("validates conditional fields and type-restricted references", () => {
  const config = fixtureConfig();
  config.node_types.shortcut = {
    fields: {
      title: { widget: "string" },
      mode: {
        widget: "select",
        options: ["first_child", "selected_target"]
      },
      target: {
        widget: "reference",
        collection: "pages",
        allowed_types: ["page"],
        visible_when: { field: "mode", equals: "selected_target" }
      }
    }
  };
  config.collections.pages.allowed_types.push("shortcut");

  assert.equal(
    validateConfig(config).node_types.shortcut.fields.target.visible_when.equals,
    "selected_target"
  );

  const invalidCondition = structuredClone(config);
  invalidCondition.node_types.shortcut.fields.target.visible_when.field =
    "missing";
  assert.throws(
    () => validateConfig(invalidCondition, 400),
    /unknown controlling field/
  );

  const invalidTargetType = structuredClone(config);
  invalidTargetType.node_types.shortcut.fields.target.allowed_types = [
    "article"
  ];
  assert.throws(
    () => validateConfig(invalidTargetType, 400),
    /outside its target collection/
  );
});

test("summarizes records consistently across storage adapters", () => {
  const summary = summarizeRecord(
    {
      id: "home",
      type: "page",
      order: 2,
      properties: {
        title: "Home",
        hidden: true
      }
    },
    {
      created_at: "2026-07-01T10:00:00Z",
      updated_at: "2026-07-31T11:00:00Z"
    },
    { name: "pages" }
  );
  assert.equal(summary.title, "Home");
  assert.equal(summary.hidden, true);
  assert.equal(summary.order, 2);
  assert.equal(summary.updated_at, "2026-07-31T11:00:00.000Z");
});
