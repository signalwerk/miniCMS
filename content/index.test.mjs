import assert from "node:assert/strict";
import test from "node:test";
import { createContentAdapter } from "./index.js";

const config = {
  site: { name: "Adapter fixture" },
  node_types: {
    page: {
      fields: {
        title: { widget: "string" },
        hero: {
          widget: "reference",
          collection: "images",
          selections: ["crop", "focus"]
        },
        hero_by_id: {
          widget: "reference",
          collection: "images",
          value_field: "$id"
        },
        hero_by_title: {
          widget: "reference",
          collection: "images",
          value_field: "title"
        },
        missing: { widget: "reference", collection: "images" },
        peer: {
          widget: "reference",
          collection: "pages",
          value_field: "$id"
        },
        download: { widget: "file" },
        poster: { widget: "image" }
      },
      slots: { content: { allowed_types: ["image"] } }
    },
    image: {
      fields: {
        asset: { widget: "reference", collection: "images" }
      }
    },
    media_image: {
      fields: {
        uuid: { widget: "uuid" },
        title: { widget: "string" },
        file: { widget: "image" }
      }
    }
  },
  collections: {
    pages: {
      folder: "content/pages",
      node_type: "page",
      views: { reference: { value: "id" } }
    },
    images: {
      folder: "content/images",
      node_type: "media_image",
      views: {
        reference: {
          value: "uuid",
          selections: {
            crop: {
              kind: "image_region",
              options: {
                field: "file",
                path: "regions",
                value: "id",
                label: "label"
              }
            },
            focus: {
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
    }
  }
};

const image = {
  id: "hero-file",
  type: "media_image",
  order: 0,
  properties: {
    uuid: "hero-uuid",
    title: "Hero",
    file: {
      src: "/media/hero.jpg",
      width: 1200,
      height: 800,
      regions: [
        {
          id: "crop-wide",
          label: "Wide",
          x: 10,
          y: 20,
          width: 900,
          height: 500
        }
      ],
      points: [{ id: "focus-face", label: "Face", x: 450, y: 260 }]
    }
  },
  slots: {}
};

const home = {
  id: "home",
  type: "page",
  order: 0,
  properties: {
    title: "Home",
    hero: {
      ref: "hero-uuid",
      selections: {
        focus: "missing-focus",
        crop: "crop-wide",
        legacy: "old-selection"
      }
    },
    hero_by_id: "hero-file",
    hero_by_title: "Hero",
    missing: {
      ref: "missing-uuid",
      selections: { crop: "missing-crop" }
    },
    download: "/media/research.pdf",
    poster: {
      src: "/media/poster.png",
      width: 640,
      height: 480,
      regions: []
    }
  },
  slots: {
    content: [
      {
        id: "nested-image",
        type: "image",
        properties: { asset: "hero-uuid" },
        slots: {}
      }
    ]
  }
};

function sourceAdapter(
  records = { pages: [home], images: [image] },
  options = {}
) {
  const counters = { list: new Map(), get: new Map() };
  const byCollection = new Map(
    Object.entries(records).map(([name, entries]) => [
      name,
      new Map(entries.map((record) => [record.id, record]))
    ])
  );
  const adapter = createContentAdapter({
    config: options.config ?? config,
    listRaw(collectionName) {
      counters.list.set(
        collectionName,
        (counters.list.get(collectionName) ?? 0) + 1
      );
      return {
        collection: collectionName,
        items: [...(byCollection.get(collectionName)?.values() ?? [])].map(
          (record) => ({
            id: record.id,
            type: record.type,
            order: record.order,
            title: record.properties?.title || record.id,
            properties: record.properties
          })
        )
      };
    },
    getRaw(collectionName, id) {
      const key = `${collectionName}:${id}`;
      counters.get.set(key, (counters.get.get(key) ?? 0) + 1);
      return byCollection.get(collectionName)?.get(id) ?? null;
    },
    resolveMediaUrl(value) {
      return /^(?:https?:|data:|blob:)/i.test(value)
        ? value
        : `/project${value}`;
    }
  });
  return { adapter, counters };
}

test("returns one stable data envelope with deeply resolved content", async () => {
  const originalHome = structuredClone(home);
  const originalImage = structuredClone(image);
  const { adapter, counters } = sourceAdapter();
  const data = await adapter.get("pages", "home");

  assert.equal(data.config.site.name, "Adapter fixture");
  assert.equal(data.collection.name, "pages");
  assert.equal(data.item.id, "home");
  assert.ok(Object.isFrozen(data));
  assert.ok(Object.isFrozen(data.item));

  const hero = data.item.properties.hero;
  assert.equal(hero.ref, "hero-uuid");
  assert.equal(hero.record.id, "hero-file");
  assert.equal(hero.record.properties.file.src, "/project/media/hero.jpg");
  assert.deepEqual(Object.keys(hero.selections), ["crop", "focus", "legacy"]);
  assert.equal(hero.selections.crop.ref, "crop-wide");
  assert.deepEqual(hero.selections.crop.value, image.properties.file.regions[0]);
  assert.deepEqual(hero.selections.focus, {
    ref: "missing-focus",
    value: null
  });
  assert.deepEqual(hero.selections.legacy, {
    ref: "old-selection",
    value: null
  });

  assert.equal(data.item.properties.hero_by_id.record.id, "hero-file");
  assert.deepEqual(data.item.properties.hero_by_id.selections, {});
  assert.equal(data.item.properties.hero_by_title.record.id, "hero-file");
  assert.deepEqual(data.item.properties.missing, {
    ref: "missing-uuid",
    record: null,
    selections: { crop: { ref: "missing-crop", value: null } }
  });
  assert.equal(data.item.properties.download, "/project/media/research.pdf");
  assert.deepEqual(data.item.properties.poster, {
    src: "/project/media/poster.png",
    width: 640,
    height: 480,
    regions: []
  });
  assert.equal(
    data.item.slots.content[0].properties.asset.record.id,
    "hero-file"
  );

  await adapter.get("pages", "home");
  assert.equal(counters.get.get("pages:home"), 1);
  assert.equal(counters.get.get("images:hero-file"), 1);
  assert.equal(counters.list.get("images"), 1);
  assert.deepEqual(home, originalHome);
  assert.deepEqual(image, originalImage);
});

test("list returns resolved records in the same envelope shape as get", async () => {
  const { adapter, counters } = sourceAdapter();
  const listed = await adapter.list("pages");
  const selected = await adapter.get("pages", "home");

  assert.equal(listed.config, adapter.config());
  assert.equal(listed.collection.name, "pages");
  assert.deepEqual(listed.items, [selected.item]);
  assert.equal(counters.list.get("pages"), 1);
  assert.equal(counters.get.get("pages:home"), 1);
});

test("get accepts an unsaved record without caching over later drafts", async () => {
  const { adapter } = sourceAdapter();
  const first = await adapter.get("pages", {
    ...structuredClone(home),
    properties: { ...structuredClone(home.properties), title: "First draft" }
  });
  const second = await adapter.get("pages", {
    ...structuredClone(home),
    properties: { ...structuredClone(home.properties), title: "Second draft" }
  });

  assert.equal(first.item.properties.title, "First draft");
  assert.equal(second.item.properties.title, "Second draft");
});

test("accepts a storage source object and preserves its method receiver", async () => {
  const records = new Map([[home.id, home]]);
  const source = {
    prefix: "/source",
    list() {
      return [...records.values()];
    },
    record(_collectionName, id) {
      return records.get(id) ?? null;
    },
    resolveMediaUrl(value) {
      return `${this.prefix}${value}`;
    }
  };
  const adapter = createContentAdapter({ config, source });
  const data = await adapter.get("pages", "home");

  assert.equal(data.item.properties.download, "/source/media/research.pdf");
});

test("configured reference values do not fall back to colliding record IDs", async () => {
  const collision = {
    ...structuredClone(image),
    id: "hero-uuid",
    properties: {
      ...structuredClone(image.properties),
      uuid: "different-uuid",
      title: "Wrong record"
    }
  };
  const { adapter } = sourceAdapter({
    pages: [home],
    images: [collision, image]
  });
  const data = await adapter.get("pages", "home");

  assert.equal(data.item.properties.hero.record.id, "hero-file");
});

test("treats explicit null record envelopes as missing", async () => {
  const adapter = createContentAdapter({
    config,
    listRaw: () => [],
    getRaw: () => ({ item: null })
  });

  assert.equal(await adapter.get("pages", "missing"), null);
});

test("guards recursive references while preserving the reference value", async () => {
  const first = {
    id: "first",
    type: "page",
    order: 0,
    properties: { title: "First", peer: "second" },
    slots: {}
  };
  const second = {
    id: "second",
    type: "page",
    order: 1,
    properties: { title: "Second", peer: "first" },
    slots: {}
  };
  const { adapter } = sourceAdapter({ pages: [first, second], images: [] });
  const data = await adapter.get("pages", "first");

  assert.equal(data.item.properties.peer.record.id, "second");
  assert.deepEqual(data.item.properties.peer.record.properties.peer, {
    ref: "first",
    record: null,
    selections: {}
  });
  assert.equal(await adapter.get("pages", "unknown"), null);
});

test("validates the core source contract and unknown collections", async () => {
  assert.throws(() => createContentAdapter(), /configuration mapping/);
  assert.throws(
    () => createContentAdapter({ config, listRaw() {} }),
    /listRaw and getRaw/
  );
  const { adapter } = sourceAdapter();
  await assert.rejects(adapter.list("unknown"), /does not exist/);
});

test("publishes one project-facing content entry", async () => {
  const content = await import("@signalwerk/minicms/content");

  assert.deepEqual(Object.keys(content), ["createContentAdapter"]);
});
