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

test("accepts the API backend and normalizes the legacy Node name", () => {
  const apiConfig = fixtureConfig();
  apiConfig.backend = {
    name: "api",
    api_url: "https://content.example.com"
  };
  assert.equal(validateConfig(apiConfig).backend.name, "api");

  const legacyConfig = fixtureConfig();
  legacyConfig.backend = { name: "node", api_url: "" };
  assert.deepEqual(validateConfig(legacyConfig).backend, {
    name: "api",
    api_url: ""
  });

  const invalidConfig = fixtureConfig();
  invalidConfig.backend = { name: "api", api_url: 42 };
  assert.throws(
    () => validateConfig(invalidConfig, 400),
    /miniCMS API URL must be a string/
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

test("accepts generated ID fields and normalizes the legacy UUID widget", () => {
  const config = fixtureConfig();
  config.node_types.page.fields.content_id = { widget: "id" };
  config.node_types.page.fields.legacy_id = { widget: "uuid" };

  const validated = validateConfig(config);
  assert.equal(validated.node_types.page.fields.content_id.widget, "id");
  assert.equal(validated.node_types.page.fields.legacy_id.widget, "id");
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

test("validates target-published reference selections", () => {
  const config = fixtureConfig();
  config.node_types.image = {
    fields: {
      uuid: { widget: "uuid" },
      file: { widget: "image" }
    }
  };
  config.collections.images = {
    folder: "content/images",
    extension: "yml",
    node_type: "image",
    views: {
      reference: {
        value: "uuid",
        image: "file",
        selections: {
          crop: {
            label: "Crop region",
            kind: "image_region",
            options: {
              field: "file",
              path: "regions",
              value: "id",
              label: "label"
            }
          },
          focus: {
            label: "Focus point",
            kind: "image_point",
            options: {
              field: "file",
              path: "points",
              value: "id",
              label: "label"
            }
          }
        }
      }
    }
  };
  config.node_types.page.fields.hero = {
    widget: "reference",
    collection: "images",
    selections: ["crop", "focus"]
  };

  assert.deepEqual(
    validateConfig(config).node_types.page.fields.hero.selections,
    ["crop", "focus"]
  );

  const unknownSelection = structuredClone(config);
  unknownSelection.node_types.page.fields.hero.selections.push("missing");
  assert.throws(
    () => validateConfig(unknownSelection, 400),
    /unknown selection "missing"/
  );

  const invalidSource = structuredClone(config);
  invalidSource.collections.images.views.reference.selections.crop.options.field =
    "uuid";
  assert.throws(
    () => validateConfig(invalidSource, 400),
    /must use an image field/
  );

  const invalidKind = structuredClone(config);
  invalidKind.collections.images.views.reference.selections.crop.kind =
    "rectangle";
  assert.throws(
    () => validateConfig(invalidKind, 400),
    /unsupported kind "rectangle"/
  );

  const labelValue = structuredClone(config);
  labelValue.collections.images.views.reference.selections.crop.options.value =
    "label";
  assert.throws(
    () => validateConfig(labelValue, 400),
    /must use annotation IDs/
  );

  const mixedSources = structuredClone(config);
  mixedSources.node_types.image.fields.alternate = { widget: "image" };
  mixedSources.collections.images.views.reference.selections.focus.options.field =
    "alternate";
  assert.throws(
    () => validateConfig(mixedSources, 400),
    /must use the same source field/
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
